"""Saved analysis and review workflow. Mutations are atomic database RPCs."""
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, Field, model_validator

from deviation_logic import METHOD_VERSION, PARAMETERS, evaluate


class ReviewUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    bill_version_id: UUID
    expected_revision: int = Field(ge=0)
    status: Literal['open', 'in_review', 'resolved', 'dismissed'] | None = None
    note: str | None = Field(default=None, max_length=4000)

    @model_validator(mode='after')
    def validate_action(self):
        self.note = (self.note or '').strip() or None
        if self.status is None and self.note is None:
            raise ValueError('Provide a status or a note.')
        if self.status in ('resolved', 'dismissed') and self.note is None:
            raise ValueError('A note is required to resolve or dismiss a bill.')
        return self


def require_role(member, roles):
    if member['role'] not in roles or not member['active']:
        raise HTTPException(403, 'Your role cannot perform this action.')


def rpc(db, name, payload):
    try:
        return db.rpc(name, payload).execute().data
    except APIError as exc:
        message = getattr(exc, 'message', '')
        if any(code in message for code in ('REVISION_CONFLICT', 'BILL_VERSION_NOT_ACTIVE', 'IMPORT_NOT_ACTIVE')):
            raise HTTPException(409, 'The record changed. Refresh and review the latest version before saving.') from None
        if getattr(exc, 'code', '') == '42501':
            raise HTTPException(403, 'Your role cannot perform this action.') from None
        if getattr(exc, 'code', '') == '22023':
            raise HTTPException(422, 'The submitted data does not match the current dataset.') from None
        raise


def persist_analysis(db, member, dataset):
    require_role(member, ('admin',))
    active, rows = dataset
    assessments = evaluate(rows)
    return rpc(db, 'save_analysis_snapshot', {
        'p_import_id': active['id'], 'p_actor_id': member['user_id'],
        'p_method': METHOD_VERSION, 'p_parameters': PARAMETERS,
        'p_assessments': sorted(assessments, key=lambda r: r['bill_version_id']),
    })


def read_all(query, order='id'):
    records, offset = [], 0
    while True:
        ordered = query.order(order)
        if order != 'id':
            ordered = ordered.order('id')
        batch = ordered.range(offset, offset + 499).execute().data
        records.extend(batch)
        if len(batch) < 500:
            return records
        offset += 500


def latest_run(db, import_id):
    found = (db.table('analysis_runs').select('*').eq('import_id', import_id)
             .eq('status', 'completed').eq('method_version', METHOD_VERSION)
             .order('completed_at', desc=True).order('id', desc=True).limit(1).execute().data)
    return found[0] if found else None


def review_queue(db, dataset, property_id=None, category=None, status=None,
                 priority=None, start_date=None, end_date=None, limit=100, offset=0, property_ids=()):
    active, rows = dataset
    run = latest_run(db, active['id'])
    if run is None:
        return {'import_id': active['id'], 'analysis_run': None, 'count': 0,
                'summary': {}, 'items': [], 'next_offset': None}
    flags = read_all(db.table('flags').select('id,evidence').eq('analysis_run_id', run['id']))
    reviews = {r['bill_id']: r for r in read_all(db.table('investigations').select('*'))}
    items = []
    for flag in flags:
        a = flag['evidence']
        if property_id and a['property_id'] != str(property_id):
            continue
        if property_ids and a['property_id'] not in property_ids:
            continue
        if category and a['category'] != category:
            continue
        if start_date and a['due_date'] < start_date.isoformat():
            continue
        if end_date and a['due_date'] > end_date.isoformat():
            continue
        investigation = reviews.get(a['bill_id'])
        stale = bool(investigation and investigation['reviewed_bill_version_id'] != a['bill_version_id'])
        effective = 'open' if stale or not investigation else investigation['status']
        items.append({**a, 'flag_id': flag['id'], 'review_status': effective,
                      'review_is_stale': stale, 'investigation': investigation,
                      'revision': investigation['revision'] if investigation else 0})
    summary = {k: sum(r['review_status'] == k for r in items)
               for k in ('open', 'in_review', 'resolved', 'dismissed')}
    items = [r for r in items if (not status or r['review_status'] == status)
             and (not priority or r['priority'] == priority)]
    items.sort(key=lambda r: ({'high': 2, 'medium': 1, 'low': 0}[r['priority']],
                             r['due_date'], abs(r['difference_cents'] or 0), r['bill_version_id']), reverse=True)
    return {'import_id': active['id'], 'analysis_run': run, 'summary': summary,
            'count': len(items), 'items': items[offset:offset + limit],
            'next_offset': offset + limit if offset + limit < len(items) else None}


def investigation_detail(db, bill_id, dataset):
    active, rows = dataset
    row = next((r for r in rows if r['bill_id'] == str(bill_id)), None)
    if row is None:
        raise HTTPException(404, 'Bill is absent from the active dataset.')
    found = db.table('investigations').select('*').eq('bill_id', str(bill_id)).limit(1).execute().data
    investigation = found[0] if found else None
    events = (read_all(db.table('investigation_events').select('*')
                      .eq('investigation_id', investigation['id']), 'created_at') if investigation else [])
    return {'bill_id': str(bill_id), 'bill_version_id': row['id'],
            'investigation': investigation, 'events': events,
            'revision': investigation['revision'] if investigation else 0,
            'review_is_stale': bool(investigation and investigation['reviewed_bill_version_id'] != row['id'])}
