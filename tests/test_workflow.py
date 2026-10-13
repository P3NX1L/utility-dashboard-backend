from copy import deepcopy
from datetime import date, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from postgrest.exceptions import APIError

import main
from deviation_logic import evaluate, analyze
from workflow import ReviewUpdate, persist_analysis, rpc, review_queue


@pytest.fixture
def rows():
    out=[]
    for i in range(8):
        start=date(2025,1,1)+timedelta(days=30*i)
        end=start+timedelta(days=30)
        out.append(dict(id=str(uuid4()),bill_id=str(uuid4()),property_id='00000000-0000-0000-0000-000000000001',
            property_name='Test property',account_id='a',account_number='123',category='water_sewer',
            transaction_type='service_candidate',due_date=(end+timedelta(days=5)).isoformat(),paid_date=None,
            paid_amount='300.00' if i<7 else '600.00',unpaid_amount='0.00',description='Water actual service',
            reading_type='actual',service_start=start.isoformat(),service_end=end.isoformat(),duration_days=30,
            period_status='explicit',period_evidence='test source',quality_issues=[],source_sheet='Ledger',source_row=i+1))
    return out


def test_no_lookahead_and_spike(rows):
    result=evaluate(rows)
    assert result[3]['assessment']=='needs_review'
    assert result[4]['expected_amount_cents']==30000
    assert result[7]['expected_amount_cents']==30000
    assert result[7]['deviation_percent']==100
    assert result[7]['is_spike']
    rows[7]['paid_amount']='1200.00'
    assert evaluate(rows)[4]==result[4]


def test_decrease(rows):
    rows[-1]['paid_amount']='150.00'
    last=evaluate(rows)[-1]
    assert last['direction']=='decrease'
    assert last['deviation_percent']==-50
    assert not last['is_spike']


@pytest.mark.parametrize('field,value,reason',[
    ('period_status','ambiguous','service_period_unavailable'),
    ('reading_type','unspecified','reading_type_unspecified'),
    ('transaction_type','credit','separate_credit'),
    ('paid_amount','0.00','nonpositive_service_charge'),
    ('quality_issues',['identical_rows_review'],'duplicate_candidate'),
])
def test_ineligible_not_normal(rows,field,value,reason):
    rows[-1][field]=value
    last=evaluate(rows)[-1]
    assert last['assessment']=='needs_review'
    assert last['expected_amount_cents'] is None
    assert reason in last['reason_codes']


def test_filter_does_not_destroy_baseline(rows):
    data=analyze(rows,date(2025,8,1),None,'due_date')
    last=data['assessments'][0]
    assert last['baseline_count']==6
    points=[p for s in data['charts']['invoice_amount'] for p in s['points']]
    point=next(p for p in points if p['bill_version_id']==last['bill_version_id'])
    assert point['expected_amount_cents']==last['expected_amount_cents']
    assert point['deviation_percent']==last['deviation_percent']


def test_inferred_remains_review(rows):
    rows[0]['period_status']='inferred'
    r=evaluate(rows)[4]
    assert r['comparison_is_provisional'] and r['needs_review']
    assert r['assessment']=='matches_baseline'


@pytest.mark.parametrize('kwargs',[{}, {'status':'resolved'}, {'status':'dismissed','note':'  '}, {'note':'x'*4001}, {'expected_revision':-1}])
def test_review_validation(kwargs):
    data={'bill_version_id':str(uuid4()),'expected_revision':0,**kwargs}
    with pytest.raises(ValidationError):ReviewUpdate(**data)


def test_note_trimmed():
    r=ReviewUpdate(bill_version_id=uuid4(),expected_revision=0,note='  checked  ')
    assert r.note=='checked'


@pytest.fixture
def client():
    main.app.dependency_overrides[main.get_db]=lambda:SimpleNamespace()
    with TestClient(main.app,raise_server_exceptions=False) as c:
        yield c
    main.app.dependency_overrides.clear()


def test_anonymous_blocked(client):
    assert client.get('/api/v1/overview').status_code==401
    assert client.post('/api/v1/analysis-runs').status_code==401
    assert client.patch(f'/api/v1/bills/{uuid4()}/investigation',json={}).status_code==401


@pytest.mark.parametrize('role',['viewer','reviewer'])
def test_non_admin_cannot_save(client,rows,role):
    main.app.dependency_overrides[main.require_member]=lambda:{'role':role,'active':True,'user_id':str(uuid4())}
    main.app.dependency_overrides[main.get_dataset]=lambda:({'id':str(uuid4())},rows)
    assert client.post('/api/v1/analysis-runs').status_code==403


def test_viewer_cannot_review(client):
    main.app.dependency_overrides[main.require_member]=lambda:{'role':'viewer','active':True,'user_id':str(uuid4())}
    r=client.patch(f'/api/v1/bills/{uuid4()}/investigation',json={'bill_version_id':str(uuid4()),'expected_revision':0,'note':'test'})
    assert r.status_code==403


def test_actor_is_server_identity(client):
    uid=str(uuid4());captured={}
    main.app.dependency_overrides[main.require_member]=lambda:{'role':'reviewer','active':True,'user_id':uid}
    def call(name,payload):
        captured.update(payload)
        return SimpleNamespace(execute=lambda:SimpleNamespace(data={'revision':1}))
    main.app.dependency_overrides[main.get_db]=lambda:SimpleNamespace(rpc=call)
    response=client.patch(f'/api/v1/bills/{uuid4()}/investigation',json={'bill_version_id':str(uuid4()),'expected_revision':0,'note':'test'})
    assert response.status_code==200 and captured['p_actor_id']==uid
    response=client.patch(f'/api/v1/bills/{uuid4()}/investigation',json={'bill_version_id':str(uuid4()),'expected_revision':0,'note':'test','p_actor_id':str(uuid4())})
    assert response.status_code==422


def test_conflict_is_http_409():
    def fail():raise APIError({'message':'REVISION_CONFLICT','code':'P0001','hint':None,'details':None})
    db=SimpleNamespace(rpc=lambda *args:SimpleNamespace(execute=fail))
    with pytest.raises(HTTPException) as e:rpc(db,'save_investigation',{})
    assert e.value.status_code==409


def test_no_secret_in_public_config(client,monkeypatch):
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY','sb_secret_do_not_publish')
    r=client.get('/api/v1/public-config')
    assert r.status_code==503 and 'do_not_publish' not in r.text


def test_ui_and_headers(client):
    r=client.get('/')
    assert r.status_code==200 and 'Utility Desk' in r.text
    assert r.headers['x-frame-options']=='DENY'
    assert client.get('/static/app.js').status_code==200
    assert client.get('/.env').status_code==404
    assert client.get('/api/v1/me').headers['cache-control']=='no-store'


def test_snapshot_canonical_order(rows):
    payloads=[]
    db=SimpleNamespace(rpc=lambda name,p: (payloads.append(p) or SimpleNamespace(execute=lambda:SimpleNamespace(data={}))))
    member={'role':'admin','active':True,'user_id':str(uuid4())}
    persist_analysis(db,member,({'id':'x'},rows))
    persist_analysis(db,member,({'id':'x'},list(reversed(rows))))
    assert payloads[0]==payloads[1]


def test_unapproved_and_anonymous_users_blocked(client):
    class Query:
        def select(self,*a,**k):return self
        def eq(self,*a,**k):return self
        def limit(self,*a,**k):return self
        def execute(self):return SimpleNamespace(data=[])
    user=SimpleNamespace(id=str(uuid4()),is_anonymous=False)
    db=SimpleNamespace(auth=SimpleNamespace(get_user=lambda t:SimpleNamespace(user=user)),table=lambda t:Query())
    main.app.dependency_overrides[main.get_db]=lambda:db
    assert client.get('/api/v1/me',headers={'Authorization':'Bearer valid-but-unapproved'}).status_code==403
    user.is_anonymous=True
    assert client.get('/api/v1/me',headers={'Authorization':'Bearer anonymous'}).status_code==401


def test_invalid_token_blocked(client):
    from supabase_auth.errors import AuthApiError
    def fail(token):raise AuthApiError('Invalid JWT',401,'bad_jwt')
    main.app.dependency_overrides[main.get_db]=lambda:SimpleNamespace(auth=SimpleNamespace(get_user=fail))
    assert client.get('/api/v1/me',headers={'Authorization':'Bearer invalid'}).status_code==401


def test_active_viewer_can_read(client,rows):
    main.app.dependency_overrides[main.require_member]=lambda:{'role':'viewer','active':True,'user_id':str(uuid4())}
    main.app.dependency_overrides[main.get_dataset]=lambda:({'id':'test','activated_at':None,'validation_report':{}},rows)
    result=client.get('/api/v1/overview')
    assert result.status_code==200 and result.json()['bill_count']==8


def test_public_config_rejects_legacy_service_role(client,monkeypatch):
    import base64,json
    claims=base64.urlsafe_b64encode(json.dumps({'role':'service_role'}).encode()).decode().rstrip('=')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY','header.'+claims+'.signature')
    assert client.get('/api/v1/public-config').status_code==503


def test_lovable_dataset_ranking_and_records(client,rows):
    active={'id':'test','filename':'ledger.xlsx','activated_at':None,'source_exported_at':None,'validation_report':{}}
    main.app.dependency_overrides[main.require_member]=lambda:{'role':'viewer','active':True,'user_id':str(uuid4())}
    main.app.dependency_overrides[main.get_dataset]=lambda:(active,rows)
    dataset=client.get('/api/v1/dataset').json()
    assert dataset['bill_count']==8 and dataset['source_exported_at'] is None
    assert dataset['min_due_date']==min(r['due_date'] for r in rows)
    rank=client.get('/api/v1/ranking').json()['properties']
    assert sum(r['total_cents'] for r in rank)==270000
    first=client.get('/api/v1/records?limit=3').json()
    assert first['count']==8 and first['next_offset']==3 and len(first['records'])==3
    target=rows[4]['id']
    selected=client.get('/api/v1/records',params={'bill_version_ids':target}).json()
    assert selected['count']==1 and selected['records'][0]['bill_version_id']==target
    properties=client.get('/api/v1/properties').json()['properties']
    assert properties[0]['accounts']==['a']


def test_records_filters_are_enforced(client,rows):
    active={'id':'test','activated_at':None,'validation_report':{}}
    main.app.dependency_overrides[main.require_member]=lambda:{'role':'viewer','active':True,'user_id':str(uuid4())}
    main.app.dependency_overrides[main.get_dataset]=lambda:(active,rows)
    assert client.get('/api/v1/records?category=trash').json()['count']==0
    assert client.get('/api/v1/records?start_date=2025-09-01').json()['count']==1
    assert client.get('/api/v1/records?start_date=2025-10-01').json()['count']==0
    assert client.get('/api/v1/ranking?category=trash').json()['properties']==[]
    assert client.get('/api/v1/records?limit=501').status_code==422


def test_new_read_endpoints_reject_anonymous(client):
    for endpoint in ['dataset','ranking','records']:
        assert client.get('/api/v1/'+endpoint).status_code==401
