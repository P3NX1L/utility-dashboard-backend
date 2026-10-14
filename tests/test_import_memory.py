import ssl
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

import http_transport
import main
from import_workflow import public_preview


def test_verified_clients_share_trust_configuration_but_not_headers(monkeypatch):
    created = []
    def create(**kwargs):
        created.append(kwargs)
        return SimpleNamespace(headers={}, cookies={})
    monkeypatch.setattr(http_transport.httpx, 'Client', create)
    one = http_transport.verified_client(timeout=30)
    two = http_transport.verified_client(timeout=25)
    one.headers['Authorization'] = 'test-only'
    assert two.headers == {} and one.cookies is not two.cookies
    assert created[0]['verify'] is created[1]['verify']
    assert created[0]['verify'].verify_mode == ssl.CERT_REQUIRED
    assert created[0]['verify'].check_hostname is True


def test_flat_projection_preserves_preview_and_missing_metadata_defaults():
    common = {'id': str(uuid4()), 'filename': 'test.xlsx', 'status': 'needs_review',
              'validation_report': {'transaction_count': 1643, 'property_count': 68,
                                    'totals_cents': {'total_cents': 72776980}}}
    scope = {'revision': 3, 'base_import_id': str(uuid4()), 'pending_matches': [{'source_row_id': 's'}]}
    assert public_preview({**common, **scope}) == public_preview({**common, 'scope': scope})
    p = public_preview({**common, 'revision': None, 'pending_matches': None})
    assert p['revision'] == 0 and p['pending_matches'] == []


def test_history_and_preview_do_not_request_staged_payloads():
    pid = str(uuid4())
    row = {'id': pid, 'filename': 'test.xlsx', 'status': 'needs_review',
           'revision': 0, 'base_import_id': None, 'pending_matches': [], 'validation_report': {}}
    selections = []
    class Query:
        def select(self, cols):
            selections.append(cols)
            assert cols != '*' and ',scope,' not in ',' + cols + ','
            assert 'payload' not in cols
            return self
        def eq(self, *args): return self
        def order(self, *args, **kwargs): return self
        def limit(self, *args): return self
        def execute(self): return SimpleNamespace(data=[row])
    main.app.dependency_overrides[main.get_db] = lambda: SimpleNamespace(table=lambda _: Query())
    main.app.dependency_overrides[main.require_member] = lambda: {'role': 'viewer', 'active': True}
    try:
        with TestClient(main.app) as client:
            assert client.get('/api/v1/imports').status_code == 200
            response = client.get('/api/v1/imports/' + pid)
            assert response.status_code == 200 and 'payload' not in response.text
            assert len(selections) == 2
    finally:
        main.app.dependency_overrides.clear()


def test_active_dataset_reads_only_storage_bucket_from_scope():
    pid = str(uuid4())
    selections = []
    class Query:
        def select(self, cols):
            selections.append(cols)
            assert ',scope,' not in ',' + cols + ',' and 'payload' not in cols
            return self
        def eq(self, *args): return self
        def limit(self, *args): return self
        def execute(self):
            return SimpleNamespace(data=[{'id': pid, 'filename': 'test.xlsx', 'bucket': 'source-bucket'}])
    import time
    with main._dataset_cache_lock:
        previous = dict(main._dataset_cache)
        main._dataset_cache[pid] = (time.monotonic(), [])
    try:
        active, rows = main.get_dataset(member={'role': 'viewer'}, db=SimpleNamespace(table=lambda _: Query()))
        assert active['scope'] == {'bucket': 'source-bucket'} and rows == []
        assert 'bucket:scope->bucket' in selections[0]
    finally:
        with main._dataset_cache_lock:
            main._dataset_cache.clear()
            main._dataset_cache.update(previous)
