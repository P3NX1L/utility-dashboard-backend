from datetime import date
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

import data_chat as chat
import main


P1, P2, IMPORT = str(uuid4()), str(uuid4()), str(uuid4())


def row(p=P1, amount='100.00', due='2026-01-15', category='water_sewer', bill=None):
    return dict(id=str(uuid4()), bill_id=bill or str(uuid4()), property_id=p,
                property_name='Alpha' if p == P1 else 'Beta', due_date=due, category=category,
                paid_amount=amount, unpaid_amount='0.00', duration_days=30,
                period_status='explicit', transaction_type='service_candidate',
                account_id='account', account_number='123', source_sheet='Sheet1', source_row=10)


def body(**overrides):
    return chat.ChatRequest(import_id=IMPORT, question=overrides.pop('question', 'Compare spending'),
        start_date=overrides.pop('start_date', '2026-01-01'),
        end_date=overrides.pop('end_date', '2026-03-31'), **overrides)


def plan(intent='summary', **overrides):
    return chat.QuestionPlan(intent=intent, category=overrides.pop('category', None),
        start_date=overrides.pop('start_date', None), end_date=overrides.pop('end_date', None),
        bill_due_date=overrides.pop('bill_due_date', None), comparison=overrides.pop('comparison', 'none'),
        issue=overrides.pop('issue', 'none'), **overrides)


@pytest.fixture(autouse=True)
def reset_budget():
    chat._requests.clear()
    chat._busy.clear()
    yield
    chat._requests.clear()
    chat._busy.clear()
    main.app.dependency_overrides.clear()


def ask(monkeypatch, question_plan, rows, request=None, queue=None):
    monkeypatch.setattr(chat, 'parse_question', lambda *_: question_plan)
    if queue is not None:
        monkeypatch.setattr(chat, 'review_queue', lambda *a, **kw: queue)
    return chat.answer_question(None, {'user_id': 'viewer'}, ({'id': IMPORT, 'filename': 'source.xlsx'}, rows), request or body())


def test_multi_building_comparison_exact_cents_and_credits(monkeypatch):
    r = ask(monkeypatch, plan('property_comparison'), [row(amount='0.10'), row(amount='0.20'), row(amount='-0.05'), row(P2, '2.00')], body(property_ids=[P1, P2]))
    assert [x['values']['total'] for x in r['rows']] == [200, 25]
    assert set(r['scope']['property_ids']) == {P1, P2}
    assert r['rows'][0]['property_id'] == P2
    assert not r['scope']['all_properties']


def test_summary_filters_building_category_and_dates(monkeypatch):
    r = ask(monkeypatch, plan(), [row(), row(P2, '900'), row(amount='200', category='trash'), row(amount='300', due='2025-12-01')], body(property_ids=[P1], category='water_sewer'))
    assert r['rows'][0]['values']['total'] == 10000
    assert r['rows'][0]['values']['count'] == 1
    assert '$100.00' in r['answer'] and '$900' not in r['answer']


def test_empty_selection_rejected_not_expanded_to_portfolio():
    with pytest.raises(ValidationError): body(property_ids=[])


@pytest.mark.parametrize('kwargs', [{'question': '  '}, {'question': 'x'*1201},
    {'start_date': '2026-04-01'}, {'start_date': '2000-01-01'}, {'category': 'electricity'}])
def test_input_bounds(kwargs):
    with pytest.raises(ValidationError): body(**kwargs)


def test_stale_import_and_unknown_building_fail_before_ai(monkeypatch):
    monkeypatch.setattr(chat, 'parse_question', lambda *_: pytest.fail('No model call'))
    dataset = ({'id': str(uuid4())}, [row()])
    with pytest.raises(HTTPException) as e: chat.answer_question(None, {'user_id': 'u'}, dataset, body())
    assert e.value.status_code == 409
    dataset = ({'id': IMPORT}, [row()])
    with pytest.raises(HTTPException) as e: chat.answer_question(None, {'user_id': 'u'}, dataset, body(property_ids=[P2]))
    assert e.value.status_code == 404


def test_model_cannot_emit_sql_or_answer_numbers():
    value = plan().model_dump()
    value['sql'] = 'select * from app_members'
    with pytest.raises(ValidationError): chat.QuestionPlan.model_validate(value)
    value.pop('sql'); value['intent'] = 'delete'
    with pytest.raises(ValidationError): chat.QuestionPlan.model_validate(value)


def test_monthly_gaps_remain_null_and_partial_selection_exact(monkeypatch):
    r = ask(monkeypatch, plan('monthly_trend'), [row(), row(amount='50', due='2026-03-15')])
    assert [x['values']['total'] for x in r['rows']] == [10000, None, 5000]
    assert r['rows'][1]['values']['count'] == 0


def test_no_records_does_not_claim_zero_expense(monkeypatch):
    r = ask(monkeypatch, plan(), [row()], body(start_date='2025-01-01', end_date='2025-12-31'))
    assert r['status'] == 'no_data' and 'does not establish zero' in r['answer']
    assert r['rows'] == []


def test_explicit_question_period_shown_in_effective_scope(monkeypatch):
    r = ask(monkeypatch, plan(start_date='2026-01-01', end_date='2026-01-31'), [row(), row(amount='50', due='2026-03-15')])
    assert r['scope']['end_date'] == '2026-01-31' and r['rows'][0]['values']['total'] == 10000


def test_invalid_or_one_sided_model_dates_rejected(monkeypatch):
    for p in [plan(start_date='2026-01-01'), plan(start_date='2026-03-01', end_date='2025-01-01')]:
        with pytest.raises(HTTPException) as e: ask(monkeypatch, p, [row()])
        assert e.value.status_code == 422


def test_review_priority_uses_saved_status_and_excludes_limited_history(monkeypatch):
    def assessment(priority, status='open', reasons=None, expected=None):
        r = row()
        return {**r, 'priority': priority, 'reason_codes': reasons or [], 'review_status': status,
                'total_cents': 10000, 'expected_amount_cents': expected, 'difference_cents': None}
    items = [assessment('high'), assessment('medium', reasons=['insufficient_comparable_history']),
             assessment('high', 'resolved'), assessment('low', 'in_review', ['duplicate_candidate'])]
    q = {'analysis_run': {'id': 'run'}, 'count': 4, 'items': items}
    r = ask(monkeypatch, plan('review_priorities'), [row()], queue=q)
    assert '2 unresolved' in r['answer'] and len(r['rows']) == 2
    d = ask(monkeypatch, plan('duplicates'), [row()], queue=q)
    assert len(d['rows']) == 1 and 'duplicate' in d['rows'][0]['values']['reason'].lower()


def test_missing_saved_analysis_not_zero_review_count(monkeypatch):
    r = ask(monkeypatch, plan('review_priorities'), [row()], queue={'analysis_run': None})
    assert r['status'] == 'no_data' and 'No review counts' in r['answer']


def test_incomplete_queue_rejected(monkeypatch):
    with pytest.raises(HTTPException) as e:
        ask(monkeypatch, plan('review_priorities'), [row()], queue={'analysis_run': {'id': 'r'}, 'count': 5, 'items': []})
    assert e.value.status_code == 503


def test_bill_explanation_uses_full_history_and_handles_ambiguity(monkeypatch):
    target, prior = row(due='2026-03-15'), row(due='2025-01-01')
    seen = []
    monkeypatch.setattr(chat, 'evaluate', lambda rs: seen.append(rs) or [{'bill_version_id': target['id'], 'total_cents': 10000,
        'expected_amount_cents': 5000, 'difference_cents': 5000, 'deviation_percent': 100, 'priority': 'high', 'baseline_count': 4}])
    r = ask(monkeypatch, plan('bill_explanation', bill_due_date='2026-03-15'), [prior, target], body(property_ids=[P1]))
    assert len(seen[0]) == 2 and '100.0% above' in r['answer']
    assert r['rows'][0]['bill_id'] == target['bill_id']
    r = ask(monkeypatch, plan('bill_explanation', bill_due_date='2026-03-15'), [target, row(due='2026-03-15')], body(property_ids=[P1]))
    assert r['status'] == 'clarification' and len(r['rows']) == 2


def test_yoy_ranking_uses_exact_change_and_capped_months(monkeypatch):
    rows = [row(amount='100', due='2025-01-15'), row(amount='200'),
            row(P2, '20', due='2025-01-15'), row(P2, '40'), row(amount='99999', due='2026-03-15')]
    r = ask(monkeypatch, plan('spending_increases', comparison='year_over_year'), rows)
    assert r['scope']['end_date'] == '2026-02-28'
    assert [x['values']['change'] for x in r['rows']] == [10000, 2000]
    assert r['rows'][0]['values']['percent'] == 100


def test_month_comparison_excludes_missing_previous_and_nonpositive_percent(monkeypatch):
    rows = [row(amount='-100', due='2026-01-15'), row(amount='100', due='2026-02-15'),
            row(P2, '100', due='2026-02-15'), row(amount='20', due='2026-03-15')]
    r = ask(monkeypatch, plan('spending_increases', comparison='previous_month'), rows,
            body(start_date='2026-02-01', end_date='2026-02-28'))
    assert len(r['rows']) == 1 and r['rows'][0]['values']['change'] == 20000
    assert r['rows'][0]['values']['percent'] is None
    assert '1 buildings lack records' in r['notes'][-2]


def test_unsupported_query_returns_clarification_without_financial_data(monkeypatch):
    r = ask(monkeypatch, plan('clarify', issue='unsupported'), [row()])
    assert r['status'] == 'clarification' and r['rows'] == []


def test_rate_limit_and_concurrent_claim_release():
    with chat.question_budget('u'):
        with pytest.raises(HTTPException) as e:
            with chat.question_budget('u'): pass
        assert e.value.status_code == 429
    assert 'u' not in chat._busy
    for _ in range(9):
        with chat.question_budget('u'): pass
    with pytest.raises(HTTPException) as e:
        with chat.question_budget('u'): pass
    assert e.value.status_code == 429


def test_authentication_required_and_viewer_can_use_read_only_endpoint(monkeypatch):
    main.app.dependency_overrides[main.get_db] = lambda: None
    with TestClient(main.app) as client:
        assert client.post('/api/v1/chat', json=body().model_dump(mode='json')).status_code == 401
    member = {'user_id': 'viewer', 'role': 'viewer', 'active': True}
    main.app.dependency_overrides[main.require_member] = lambda: member
    main.app.dependency_overrides[main.get_dataset] = lambda: ({'id': IMPORT}, [row()])
    monkeypatch.setattr(chat, 'parse_question', lambda *_: plan())
    with TestClient(main.app) as client:
        r = client.post('/api/v1/chat', json=body().model_dump(mode='json'))
        assert r.status_code == 200 and r.headers['cache-control'] == 'no-store'


def test_model_timeout_or_refusal_fails_honestly_without_retry(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    calls = []
    def post(*args, **kwargs):
        calls.append(kwargs)
        raise httpx.TimeoutException('Upstream details must not leak')
    import httpx
    monkeypatch.setattr(httpx.Client, 'post', post)
    with pytest.raises(HTTPException) as e: chat.parse_question(body(), [], '2026-03-15')
    assert e.value.status_code == 503 and 'Upstream' not in e.value.detail and len(calls) == 1
    assert calls[0]['json']['store'] is False
