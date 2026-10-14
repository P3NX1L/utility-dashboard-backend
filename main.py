"""Authenticated dashboard and review API for one company's portfolio."""
import logging
import os
import time
from threading import Lock
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import ClientOptions, create_client
from supabase_auth.errors import AuthApiError

from deviation_logic import analyze
from dashboard_logic import bill_detail, building_monthly, monthly, period_overlaps, select_rows, totals, year_comparison
from workflow import (ReviewUpdate, investigation_detail, persist_analysis,
                      require_role, review_queue, rpc, read_all)
from import_workflow import (UploadRequest, ActivateRequest, MatchRequest, stage_upload,
                             public_preview, activate_import, PUBLIC_IMPORT_COLUMNS)
from bill_explanations import ExplanationRequest, explain_bill
from data_chat import ChatRequest, answer_question
from http_transport import verified_client

load_dotenv(Path(__file__).with_name('.env'))
app = FastAPI(title='Utility Dashboard API', version='0.7.1')
logger = logging.getLogger('utility_api')
_dataset_cache = {}
_dataset_cache_lock = Lock()
bearer = HTTPBearer(auto_error=False)
origins = [x.strip().rstrip('/') for x in os.getenv('ALLOWED_ORIGINS', '').split(',') if x.strip()]
if '*' in origins:
    raise RuntimeError('Use explicit ALLOWED_ORIGINS; wildcard is not accepted.')
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                   allow_methods=['GET', 'POST', 'PATCH'], allow_headers=['Authorization', 'Content-Type'])


@app.middleware('http')
async def no_private_cache(request: Request, call_next):
    if request.method == 'POST' and request.url.path == '/api/v1/chat':
        length = request.headers.get('content-length')
        if length is None:
            return JSONResponse(status_code=411, content={'detail': 'Question request must include Content-Length.'})
        try:
            if not 0 <= int(length) <= 16 * 1024:
                return JSONResponse(status_code=413, content={'detail': 'Question request is too large.'})
        except ValueError:
            return JSONResponse(status_code=400, content={'detail': 'Invalid request length.'})
    if request.method == 'POST' and request.url.path == '/api/v1/imports/preview':
        length = request.headers.get('content-length')
        if length is None:
            return JSONResponse(status_code=411, content={'detail': 'Upload request must include Content-Length.'})
        try:
            if int(length) > 7 * 1024 * 1024:
                return JSONResponse(status_code=413, content={'detail': 'Upload exceeds the 5 MB workbook limit.'})
        except ValueError:
            return JSONResponse(status_code=400, content={'detail': 'Invalid upload length.'})
    response = await call_next(request)
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    return response


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception):
    # Do not log raw exception bodies that might contain credentials or records.
    logger.error('Request failed on %s (%s)', request.url.path, type(exc).__name__)
    return JSONResponse(status_code=503, content={'detail': 'Service unavailable. Check backend configuration and connectivity.'})


def get_db():
    url, key = os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SECRET_KEY')
    if not url or not key:
        raise HTTPException(503, 'Supabase configuration is missing.')
    # Each request has an isolated client. Never sign users into this service client.
    with verified_client(timeout=30.0) as transport:
        yield create_client(url, key, options=ClientOptions(
            persist_session=False, auto_refresh_token=False, httpx_client=transport))


def require_member(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
                   db=Depends(get_db)):
    if credentials is None or credentials.scheme.lower() != 'bearer':
        raise HTTPException(401, 'Sign in to continue.', headers={'WWW-Authenticate': 'Bearer'})
    try:
        response = db.auth.get_user(credentials.credentials)
    except AuthApiError as exc:
        if getattr(exc, 'status', None) in (400, 401, 403, 422):
            raise HTTPException(401, 'Invalid or expired login.', headers={'WWW-Authenticate': 'Bearer'}) from None
        raise HTTPException(503, 'Authentication service unavailable.') from None
    user = response.user
    if not user or getattr(user, 'is_anonymous', False):
        raise HTTPException(401, 'A registered user login is required.')
    members = (db.table('app_members').select('user_id,role,active')
               .eq('user_id', str(user.id)).eq('active', True).limit(1).execute().data)
    if not members or members[0]['role'] not in ('admin', 'reviewer', 'viewer'):
        raise HTTPException(403, 'Your account has not been approved for this dashboard.')
    return members[0]


def get_dataset(member=Depends(require_member), db=Depends(get_db)):
    imports = (db.table('imports').select('id,filename,activated_at,source_exported_at,validation_report,bucket:scope->bucket')
               .eq('status', 'active').limit(2).execute().data)
    if len(imports) != 1:
        raise HTTPException(409, 'Exactly one active dataset is required.')
    active = imports[0]
    active['scope'] = {'bucket': active.pop('bucket', None)}
    # Authorization is still checked on every request. The company-wide immutable
    # snapshot cache only avoids refetching every ledger page for each widget.
    with _dataset_cache_lock:
        cached = _dataset_cache.get(active['id'])
        if cached and time.monotonic() - cached[0] < 120:
            return active, cached[1]
    rows, offset = [], 0
    # Pin the import ID throughout pagination, even if another import is activated.
    columns = ('id,bill_id,due_date,paid_date,category,transaction_type,paid_amount,unpaid_amount,'
               'description,reading_type,service_start,service_end,duration_days,period_status,'
               'period_evidence,quality_issues,payment_reference,gl_account,usage_value,usage_unit,match_evidence,'
               'import_rows!inner(sheet_name,row_number),'
               'bills!inner(utility_accounts!inner(id,account_number,property_id,properties!inner(name)))')
    while True:
        page = (db.table('bill_versions').select(columns).eq('import_id', active['id'])
                .order('id').range(offset, offset + 499).execute().data)
        for r in page:
            account = r.pop('bills')['utility_accounts']
            r['property_id'] = account['property_id']
            r['property_name'] = account['properties']['name']
            r['account_id'] = account['id']
            r['account_number'] = account['account_number']
            source = r.pop('import_rows')
            r['source_sheet'], r['source_row'] = source['sheet_name'], source['row_number']
            r['source_filename'] = active['filename']
            rows.append(r)
        if len(page) < 500:
            break
        offset += 500
    with _dataset_cache_lock:
        _dataset_cache.clear()
        _dataset_cache[active['id']] = (time.monotonic(), rows)
    return active, rows


@dataclass
class Filters:
    property_ids: list[str]
    category: str | None
    start_date: date | None
    end_date: date | None


def get_filters(property_ids: Annotated[list[UUID] | None, Query()] = None,
                category: Literal['water_sewer', 'trash', 'other'] | None = None,
                start_date: date | None = None, end_date: date | None = None):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(422, 'start_date must be on or before end_date.')
    if start_date and end_date and (end_date.year - start_date.year) * 12 + end_date.month - start_date.month > 120:
        raise HTTPException(422, 'Select no more than 10 years per request.')
    return Filters(sorted({str(x) for x in property_ids or []}), category, start_date, end_date)


def filtered_dataset(dataset, filters):
    active, rows = dataset
    unknown = set(filters.property_ids) - {r['property_id'] for r in rows}
    if unknown:
        raise HTTPException(404, 'A selected property is absent from the active dataset.')
    selected = select_rows(rows, filters.property_ids, filters.category, filters.start_date, filters.end_date)
    return active, selected


def metadata(active, filters=None):
    report = active.get('validation_report') or {}
    differences = [{
        'scope': r['scope'],
        'difference_cents': -(r['difference_paid_cents'] + r['difference_unpaid_cents']),
    } for r in report.get('reconciliation', [])
       if r['difference_paid_cents'] or r['difference_unpaid_cents']]
    result = {
        'import_id': active['id'], 'date_basis': 'due_date',
        'expense_basis': 'signed_paid_plus_unpaid',
        'activated_at': active['activated_at'],
        'data_quality': {'scope': 'entire_active_import', 'source_total_differences': differences,
                         'duplicate_candidate_groups': len(report.get('duplicate_groups', []))},
    }
    if filters:
        result['filters'] = vars(filters)
    return result


@app.get('/health')
def health():
    return {'status': 'ok'}


@app.get('/api/v1/me')
def me(member=Depends(require_member)):
    return member


@app.post('/api/v1/chat')
def ask_data(body: ChatRequest, member=Depends(require_member),
             dataset=Depends(get_dataset), db=Depends(get_db)):
    return answer_question(db, member, dataset, body)


@app.get('/api/v1/properties')
def properties(dataset=Depends(get_dataset)):
    active, rows = dataset
    unique = {}
    for r in rows:
        item = unique.setdefault(r['property_id'], {'id': r['property_id'], 'name': r['property_name'], 'accounts': []})
        if r['account_id'] not in item['accounts']:
            item['accounts'].append(r['account_id'])
    return {**metadata(active), 'count': len(unique), 'properties': sorted(unique.values(), key=lambda p: p['name'])}


@app.get('/api/v1/dataset')
def dataset_info(dataset=Depends(get_dataset)):
    active, rows = dataset
    return {
        **metadata(active), 'filename': active['filename'],
        'source_exported_at': active.get('source_exported_at'),
        'min_due_date': min((r['due_date'] for r in rows), default=None),
        'max_due_date': max((r['due_date'] for r in rows), default=None),
        **totals(rows), 'validation_report': active.get('validation_report') or {},
    }


@app.get('/api/v1/imports')
def import_history(member=Depends(require_member), db=Depends(get_db)):
    items = (db.table('imports').select(PUBLIC_IMPORT_COLUMNS)
             .order('created_at', desc=True).limit(50).execute().data)
    return {'imports': [public_preview(i) for i in items]}


@app.post('/api/v1/imports/preview')
def preview_upload(body: UploadRequest, member=Depends(require_member), db=Depends(get_db), dataset=Depends(get_dataset)):
    return stage_upload(db, member, body, dataset)


@app.get('/api/v1/imports/{import_id}')
def import_preview(import_id: UUID, member=Depends(require_member), db=Depends(get_db)):
    found = db.table('imports').select(PUBLIC_IMPORT_COLUMNS).eq('id', str(import_id)).limit(1).execute().data
    if not found:
        raise HTTPException(404, 'Import not found.')
    return public_preview(found[0])


@app.patch('/api/v1/imports/{import_id}/matches')
def resolve_import_match(import_id: UUID, body: MatchRequest, member=Depends(require_member), db=Depends(get_db)):
    require_role(member, ('admin', 'reviewer'))
    item = rpc(db, 'resolve_utility_match', {'p_import_id': str(import_id), 'p_actor_id': member['user_id'],
        'p_expected_revision': body.expected_revision, 'p_source_row_id': str(body.source_row_id),
        'p_bill_id': str(body.bill_id) if body.bill_id else None})
    return public_preview(item)


@app.post('/api/v1/imports/{import_id}/activate')
def activate_upload(import_id: UUID, body: ActivateRequest, member=Depends(require_member), db=Depends(get_db)):
    return activate_import(db, member, import_id, body)


@app.get('/api/v1/imports/{import_id}/source')
def download_import_source(import_id: UUID, member=Depends(require_member), db=Depends(get_db)):
    found = db.table('imports').select('storage_path,scope,filename').eq('id', str(import_id)).limit(1).execute().data
    if not found or not found[0]['storage_path']:
        raise HTTPException(404, 'Original file is unavailable.')
    item = found[0]
    bucket = item.get('scope', {}).get('bucket')
    if not bucket:
        raise HTTPException(404, 'Original file bucket is not recorded.')
    signed = db.storage.from_(bucket).create_signed_url(item['storage_path'], 60, options={'download': item['filename']})
    return {'url': signed['signedURL'], 'filename': item['filename'], 'expires_in_seconds': 60}


@app.post('/api/v1/bills/{bill_id}/explanation')
def bill_explanation(bill_id: UUID, body: ExplanationRequest,
                     dataset=Depends(get_dataset), db=Depends(get_db)):
    return explain_bill(db, dataset, bill_id, body)


@app.get('/api/v1/ranking')
def property_ranking(filters=Depends(get_filters), dataset=Depends(get_dataset)):
    active, rows = filtered_dataset(dataset, filters)
    groups = {}
    for r in rows:
        groups.setdefault(r['property_id'], []).append(r)
    ranked = [{'property_id': key, 'name': group[0]['property_name'], **totals(group)}
              for key, group in groups.items()]
    ranked.sort(key=lambda item: (-item['total_cents'], item['name']))
    return {**metadata(active, filters), 'properties': ranked}


@app.get('/api/v1/records')
def ledger_records(
        filters=Depends(get_filters), dataset=Depends(get_dataset),
        bill_version_ids: Annotated[list[UUID] | None, Query()] = None,
        limit: Annotated[int, Query(ge=1, le=500)] = 500,
        offset: Annotated[int, Query(ge=0)] = 0):
    active, rows = filtered_dataset(dataset, filters)
    wanted = {str(value) for value in bill_version_ids or []}
    if wanted:
        rows = [r for r in rows if r['id'] in wanted]
    rows = sorted(rows, key=lambda r: (r['due_date'], r['id']), reverse=True)
    records = [{**bill_detail(r), 'property_id': r['property_id'], 'property_name': r['property_name']}
               for r in rows[offset:offset + limit]]
    return {**metadata(active, filters), 'count': len(rows), 'records': records,
            'next_offset': offset + limit if offset + limit < len(rows) else None}


@app.get('/api/v1/overview')
def overview(filters=Depends(get_filters), dataset=Depends(get_dataset)):
    active, rows = filtered_dataset(dataset, filters)
    return {**metadata(active, filters), **totals(rows)}


@app.get('/api/v1/monthly')
def monthly_trends(filters=Depends(get_filters), dataset=Depends(get_dataset)):
    active, rows = filtered_dataset(dataset, filters)
    # Infer missing bounds from matching data; cap the returned calendar span.
    start = filters.start_date or (date.fromisoformat(min(r['due_date'] for r in rows)) if rows else None)
    end = filters.end_date or (date.fromisoformat(max(r['due_date'] for r in rows)) if rows else None)
    if start and end and (end.year - start.year) * 12 + end.month - start.month > 120:
        raise HTTPException(422, 'Select no more than 10 years per request.')
    return {**metadata(active, filters), 'months': monthly(rows, start, end)}


@app.get('/api/v1/year-over-year')
def year_over_year(
        property_ids: Annotated[list[UUID] | None, Query()] = None,
        category: Literal['water_sewer', 'trash', 'other'] | None = None,
        year: Annotated[int | None, Query(ge=1901, le=9998)] = None,
        start_month: Annotated[int, Query(ge=1, le=12)] = 1,
        end_month: Annotated[int | None, Query(ge=1, le=12)] = None,
        dataset=Depends(get_dataset)):
    active, all_rows = dataset
    if not all_rows:
        raise HTTPException(409, 'The active dataset has no bill records.')
    # Conservative calendar cutoff anchored to the whole snapshot, so selecting
    # another building does not silently change the comparison window.
    latest_due = date.fromisoformat(max(r['due_date'] for r in all_rows))
    selected_year = year if year is not None else latest_due.year
    if selected_year > latest_due.year:
        raise HTTPException(422, 'Comparison year is beyond the dataset.')
    latest_completed_month = latest_due.month - 1 if selected_year == latest_due.year else 12
    selected_end = end_month if end_month is not None else latest_completed_month
    if selected_end < start_month or selected_end > latest_completed_month:
        raise HTTPException(422, 'Select completed calendar months before the latest observed bill month.')
    filters = Filters(sorted({str(x) for x in property_ids or []}), category, None, None)
    _, selected = filtered_dataset(dataset, filters)
    return {
        **metadata(active, filters),
        'latest_observed_due_date': latest_due.isoformat(),
        'window_rule': 'matching_calendar_months_excluding_latest_observed_month',
        'coverage_note': 'Matching calendar periods do not prove every expected invoice is present. Same-property comparison requires at least one record in each period, not verified complete coverage.',
        **year_comparison(selected, selected_year, start_month, selected_end),
    }


@app.get('/api/v1/properties/{property_id}/bills')
def property_bills(
        property_id: UUID,
        account_id: UUID | None = None,
        category: Literal['water_sewer', 'trash', 'other'] | None = None,
        date_basis: Literal['due_date', 'service_overlap'] = 'due_date',
        start_date: date | None = None,
        end_date: date | None = None,
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
        dataset=Depends(get_dataset)):
    active, all_rows = dataset
    if start_date and end_date and start_date > end_date:
        raise HTTPException(422, 'start_date must be on or before end_date.')
    property_rows = [r for r in all_rows if r['property_id'] == str(property_id)]
    if not property_rows:
        raise HTTPException(404, 'Property is absent from the active dataset.')
    accounts = {r['account_id']: {'id': r['account_id'], 'account_number': r['account_number']} for r in property_rows}
    if account_id and str(account_id) not in accounts:
        raise HTTPException(404, 'Account does not belong to this property in the active dataset.')
    selected = [r for r in property_rows if (not category or r['category'] == category)
                and (not account_id or r['account_id'] == str(account_id))]
    undated = sum(not r['service_start'] or not r['service_end'] for r in selected)
    if date_basis == 'service_overlap':
        selected = [r for r in selected if period_overlaps(r, start_date, end_date)]
    else:
        selected = select_rows(selected, start_date=start_date, end_date=end_date)
    # Due-date order in ledger mode; period-end order in service mode.
    sort_key = 'service_end' if date_basis == 'service_overlap' else 'due_date'
    selected.sort(key=lambda r: (r[sort_key], r['due_date'], r['id']), reverse=True)
    details = [bill_detail(r) for r in selected[offset:offset + limit]]
    summary = totals(selected)
    return {
        **metadata(active), 'date_basis': date_basis,
        'property': {'id': str(property_id), 'name': property_rows[0]['property_name']},
        'accounts': sorted(accounts.values(), key=lambda r: r['account_number']),
        'filters': {'account_id': str(account_id) if account_id else None, 'category': category,
                    'start_date': start_date, 'end_date': end_date},
        'summary': {**summary, 'amount_basis': 'whole_bill_amounts'},
        'service_period_convention': '[start,end); duration=end-start',
        'overlap_note': 'Service overlap selects whole bills. Amounts are not prorated to the selected months.',
        'excluded_without_service_period': undated if date_basis == 'service_overlap' else 0,
        'limit': limit, 'offset': offset,
        'next_offset': offset + limit if offset + limit < len(selected) else None,
        'bills': details,
    }


@app.get('/api/v1/properties/{property_id}/monthly')
def property_monthly(
        property_id: UUID,
        category: Literal['water_sewer', 'trash', 'other'] | None = None,
        charge_scope: Literal['regular', 'all', 'other'] = 'regular',
        start_date: date | None = None, end_date: date | None = None,
        dataset=Depends(get_dataset)):
    active, all_rows = dataset
    if start_date and end_date and start_date > end_date:
        raise HTTPException(422, 'start_date must be on or before end_date.')
    rows = [r for r in all_rows if r['property_id'] == str(property_id)]
    if not rows:
        raise HTTPException(404, 'Property is absent from the active dataset.')
    start = start_date or date.fromisoformat(min(r['due_date'] for r in rows))
    end = end_date or date.fromisoformat(max(r['due_date'] for r in rows))
    if (end.year - start.year) * 12 + end.month - start.month > 120:
        raise HTTPException(422, 'Select no more than 10 years per request.')
    return {**metadata(active), 'property': {'id': str(property_id), 'name': rows[0]['property_name']},
            'filters': {'category': category, 'charge_scope': charge_scope,
                        'start_date': start_date, 'end_date': end_date},
            **building_monthly(rows, start, end, category, charge_scope)}


@app.get('/api/v1/properties/{property_id}/analysis')
def property_analysis(
        property_id: UUID,
        account_id: UUID | None = None,
        category: Literal['water_sewer', 'trash', 'other'] | None = None,
        date_basis: Literal['due_date', 'service_overlap'] = 'service_overlap',
        start_date: date | None = None,
        end_date: date | None = None,
        dataset=Depends(get_dataset)):
    active, all_rows = dataset
    if start_date and end_date and start_date > end_date:
        raise HTTPException(422, 'start_date must be on or before end_date.')
    rows = [r for r in all_rows if r['property_id'] == str(property_id)]
    if not rows:
        raise HTTPException(404, 'Property is absent from the active dataset.')
    name = rows[0]['property_name']
    accounts = {r['account_id']: {'id': r['account_id'], 'account_number': r['account_number']} for r in rows}
    if account_id and str(account_id) not in accounts:
        raise HTTPException(404, 'Account does not belong to this property.')
    # Keep the whole account/category history for baselines, then filter display dates.
    rows = [r for r in rows if (not account_id or r['account_id'] == str(account_id))
            and (not category or r['category'] == category)]
    return {
        **metadata(active), 'date_basis': date_basis,
        'property': {'id': str(property_id), 'name': name},
        'accounts': sorted(accounts.values(), key=lambda r: r['account_number']),
        'filters': {'account_id': str(account_id) if account_id else None,
                    'category': category, 'start_date': start_date, 'end_date': end_date},
        **analyze(rows, start_date, end_date, date_basis),
    }


# Workflow routes use the existing authenticated, per-request service client.


@app.post('/api/v1/analysis-runs')
def save_analysis(member=Depends(require_member), dataset=Depends(get_dataset), db=Depends(get_db)):
    return persist_analysis(db, member, dataset)


@app.get('/api/v1/review-queue')
def saved_review_queue(
        property_id: UUID | None = None,
        property_ids: Annotated[list[UUID] | None, Query()] = None,
        category: Literal['water_sewer', 'trash', 'other'] | None = None,
        status: Literal['open', 'in_review', 'resolved', 'dismissed'] | None = None,
        priority: Literal['low', 'medium', 'high'] | None = None,
        start_date: date | None = None, end_date: date | None = None,
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
        dataset=Depends(get_dataset), db=Depends(get_db)):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(422, 'start_date must be on or before end_date.')
    if property_id and not any(r['property_id'] == str(property_id) for r in dataset[1]):
        raise HTTPException(404, 'Property is absent from the active dataset.')
    selected_properties = {str(p) for p in property_ids or []}
    if selected_properties - {r['property_id'] for r in dataset[1]}:
        raise HTTPException(404, 'A selected property is absent from the active dataset.')
    return review_queue(db, dataset, property_id, category, status, priority,
                        start_date, end_date, limit, offset, selected_properties)


@app.get('/api/v1/bills/{bill_id}/investigation')
def get_investigation(bill_id: UUID, dataset=Depends(get_dataset), db=Depends(get_db)):
    return investigation_detail(db, bill_id, dataset)


@app.patch('/api/v1/bills/{bill_id}/investigation')
def update_investigation(bill_id: UUID, update: ReviewUpdate,
                         member=Depends(require_member), db=Depends(get_db)):
    require_role(member, ('admin', 'reviewer'))
    return rpc(db, 'save_investigation', {
        'p_bill_id': str(bill_id), 'p_bill_version_id': str(update.bill_version_id),
        'p_actor_id': member['user_id'], 'p_expected_revision': update.expected_revision,
        'p_status': update.status, 'p_note': update.note,
    })


@app.get('/api/v1/public-config')
def public_config():
    url, key = os.getenv('SUPABASE_URL', ''), os.getenv('SUPABASE_PUBLISHABLE_KEY', '')
    if not url or not key or key.startswith('sb_secret_'):
        raise HTTPException(503, 'Public login configuration is missing.')
    # Legacy JWTs must identify the public anon role, never service_role.
    if not key.startswith('sb_publishable_'):
        import base64, json
        try:
            claims = json.loads(base64.urlsafe_b64decode(key.split('.')[1] + '==='))
            if claims.get('role') != 'anon':
                raise ValueError('Not an anon key')
        except (ValueError, IndexError, KeyError):
            raise HTTPException(503, 'Public login configuration is invalid.') from None
    return {'supabase_url': url, 'publishable_key': key}


STATIC_DIR = Path(__file__).with_name('static')
app.mount('/static', StaticFiles(directory=STATIC_DIR), name='static')


@app.get('/', include_in_schema=False)
def dashboard_page():
    return FileResponse(STATIC_DIR / 'index.html', headers={'Cache-Control': 'no-store'})
