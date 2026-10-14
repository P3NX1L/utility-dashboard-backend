from copy import deepcopy
from threading import Event, Lock, Thread
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import bill_explanations as ex
import main


class DB:
    def __init__(self):
        self.rows = {}
        self.lock = Lock()

    def table(self, name):
        assert name == 'bill_explanation_cache'
        return Query(self)


class Query:
    def __init__(self, db):
        self.db, self.filters, self.op, self.body = db, [], 'select', None

    def select(self, *args): return self
    def limit(self, *args): return self
    def eq(self, key, value): self.filters.append((key, value, 'eq')); return self
    def lt(self, key, value): self.filters.append((key, value, 'lt')); return self
    def insert(self, body): self.op, self.body = 'insert', body; return self
    def update(self, body): self.op, self.body = 'update', body; return self

    def execute(self):
        with self.db.lock:
            if self.op == 'insert':
                k = self.body['evidence_hash']
                if k in self.db.rows:
                    err = RuntimeError('duplicate'); err.code = '23505'; raise err
                self.db.rows[k] = deepcopy(self.body)
                return SimpleNamespace(data=[deepcopy(self.body)])
            found = [r for r in self.db.rows.values() if all(
                r.get(k) == v if op == 'eq' else r.get(k, '') < v for k, v, op in self.filters)]
            if self.op == 'update':
                for r in found: r.update(self.body)
            return SimpleNamespace(data=deepcopy(found))


@pytest.fixture
def setup(monkeypatch):
    active = {'id': str(uuid4())}
    a = {'bill_id': str(uuid4()), 'bill_version_id': str(uuid4()), 'transaction_type': 'service_candidate',
         'reason_codes': ['service_period_unavailable', 'reading_type_unspecified'], 'priority': 'medium',
         'expected_amount_cents': None, 'baseline_count': 0, 'total_cents': 12000}
    monkeypatch.setattr(ex, 'evaluate', lambda rows: [a])
    monkeypatch.setenv('OPENAI_API_KEY', 'test-only')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    body = ex.ExplanationRequest(import_id=active['id'], bill_version_id=a['bill_version_id'])
    return DB(), (active, []), a, body


def test_cache_reuses_validated_text_without_second_model_call(setup, monkeypatch):
    db, data, a, body = setup
    calls = []
    monkeypatch.setattr(ex, 'generate_ai', lambda clauses, *_: calls.append(clauses) or ' '.join(clauses[:2]))
    first = ex.explain_bill(db, data, a['bill_id'], body)
    second = ex.explain_bill(db, data, a['bill_id'], body)
    assert first['source'] == second['source'] == 'ai'
    assert second['cache_hit'] and len(calls) == 1
    assert a['expected_amount_cents'] is None  # No calculated facts changed.


def test_simple_cases_never_call_ai(setup, monkeypatch):
    db, data, a, body = setup
    a.update(reason_codes=['insufficient_comparable_history'], baseline_count=2)
    monkeypatch.setattr(ex, 'generate_ai', lambda *_: pytest.fail('No AI for a simple case'))
    r = ex.explain_bill(db, data, a['bill_id'], body)
    assert r['text'] == 'Only 2 comparable bills; 4 needed.' and r['source'] == 'template'
    assert not db.rows


def test_changed_comparison_or_import_invalidates_cache(setup, monkeypatch):
    db, data, a, body = setup
    calls = []
    monkeypatch.setattr(ex, 'generate_ai', lambda clauses, *_: calls.append(1) or ' '.join(clauses[:2]))
    one = ex.explain_bill(db, data, a['bill_id'], body)
    a['baseline_bill_ids'] = [str(uuid4())]
    two = ex.explain_bill(db, data, a['bill_id'], body)
    assert one['evidence_hash'] != two['evidence_hash'] and len(calls) == 2
    other = {'id': str(uuid4())}
    assert ex.evidence_hash(other, a, 'test-model') != two['evidence_hash']


def test_failures_fall_back_and_do_not_keep_spending(setup, monkeypatch):
    db, data, a, body = setup
    calls = []
    def fail(*_): calls.append(1); raise RuntimeError('offline')
    monkeypatch.setattr(ex, 'generate_ai', fail)
    first = ex.explain_bill(db, data, a['bill_id'], body)
    second = ex.explain_bill(db, data, a['bill_id'], body)
    assert first['source'] == second['source'] == 'template'
    assert first['status'] == second['status'] == 'unavailable' and len(calls) == 1


def test_parallel_requests_share_claim(setup, monkeypatch):
    db, data, a, body = setup
    entered, release = Event(), Event()
    calls, responses = [], []
    def generate(clauses, *_):
        calls.append(1); entered.set(); assert release.wait(3); return ' '.join(clauses[:2])
    monkeypatch.setattr(ex, 'generate_ai', generate)
    t = Thread(target=lambda: responses.append(ex.explain_bill(db, data, a['bill_id'], body)))
    t.start(); assert entered.wait(3)
    pending = ex.explain_bill(db, data, a['bill_id'], body)
    release.set(); t.join(3)
    assert pending['status'] == 'pending' and len(calls) == 1 and responses[0]['source'] == 'ai'


def test_stale_import_version_and_missing_bill_rejected(setup):
    db, data, a, body = setup
    for target, request in [(a['bill_id'], ex.ExplanationRequest(import_id=uuid4(), bill_version_id=body.bill_version_id)),
                            (a['bill_id'], ex.ExplanationRequest(import_id=body.import_id, bill_version_id=uuid4())),
                            (str(uuid4()), body)]:
        with pytest.raises(HTTPException) as err: ex.explain_bill(db, data, target, request)
        assert err.value.status_code in (404, 409)
    assert not db.rows


@pytest.mark.parametrize('value', [{'clauses': ['A confirmed leak.']}, {'clauses': []},
                                  {'clauses': ['Allowed.', 'Allowed.']}, {'clauses': ['Allowed.'], 'extra': True}])
def test_ai_cannot_invent_or_duplicate_clauses(value):
    with pytest.raises(ValueError): ex.validate_ai(value, ['Allowed.'])


def test_endpoint_requires_authentication():
    main.app.dependency_overrides[main.get_db] = lambda: DB()
    try:
        with TestClient(main.app) as client:
            r = client.post(f'/api/v1/bills/{uuid4()}/explanation', json={
                'import_id': str(uuid4()), 'bill_version_id': str(uuid4())})
            assert r.status_code == 401
    finally: main.app.dependency_overrides.clear()


def test_short_spike_and_threshold_labels():
    assert ex.short_template({'expected_amount_cents': 100, 'deviation_percent': 38,
        'priority': 'high', 'baseline_count': 5}) == '38.0% above expected. Compared with 5 earlier bills.'
    assert ex.short_template({'expected_amount_cents': 100, 'deviation_percent': 1,
        'priority': 'low'}) == 'Within the comparison threshold.'


def test_ai_must_include_a_substantive_finding():
    clauses = ['Compared with 5 earlier bills.', 'Comparison dates are inferred.', '38% above expected.']
    with pytest.raises(ValueError):
        ex.validate_ai({'clauses': clauses[:2]}, clauses)


def test_broad_insights_endpoint_removed():
    with TestClient(main.app) as client:
        assert client.get('/api/v1/insights').status_code == 404
