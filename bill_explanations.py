"""Short computed explanations; AI can only select and order approved factual clauses."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
from uuid import UUID

from deviation_logic import evaluate, METHOD_VERSION

PROMPT_VERSION = 'short_bill_clauses_v1'
REASONS = {
    'duplicate_candidate': 'Possible duplicate; check the original bills.',
    'multiple_service_charges_same_due_date': 'Multiple charges for this account on the same date.',
    'service_period_unavailable': 'Service dates are missing or unclear.',
    'reading_type_unspecified': 'Reading type is not specified.',
    'nonpositive_service_charge': 'Zero or negative charge; regular comparison unavailable.',
    'adjustment_or_nonmetered_description': 'Adjustment or nonmetered charge; comparison unavailable.',
    'mixed_duration_baseline': 'Comparison uses different billing lengths.',
    'inferred_period_in_comparison': 'Comparison dates are inferred.',
}


class ExplanationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    import_id: UUID
    bill_version_id: UUID


def clauses_for(a):
    reasons = a.get('reason_codes') or []
    clauses = []
    # Specific record concerns precede comparison limitations.
    for code in ('duplicate_candidate', 'multiple_service_charges_same_due_date'):
        if code in reasons:
            clauses.append(REASONS[code])
    tt = a.get('transaction_type')
    if tt and tt != 'service_candidate':
        clauses.append(f"{tt.replace('_', ' ').capitalize()} charge; excluded from regular-bill comparisons.")
    elif a.get('expected_amount_cents') is not None:
        p = a.get('deviation_percent')
        if a.get('priority') == 'high' and p is not None:
            clauses.append(f"{abs(p):.1f}% {'above' if p >= 0 else 'below'} expected.")
        else:
            clauses.append('Within the comparison threshold.')
        n = a.get('baseline_count')
        if n is not None:
            clauses.append(f'Compared with {n} earlier bills.')
    elif 'insufficient_comparable_history' in reasons:
        clauses.append(f"Only {a.get('baseline_count') or 0} comparable bills; 4 needed.")
    for code in ('service_period_unavailable', 'reading_type_unspecified', 'nonpositive_service_charge',
                 'adjustment_or_nonmetered_description', 'mixed_duration_baseline', 'inferred_period_in_comparison'):
        if code in reasons:
            clauses.append(REASONS[code])
    if a.get('comparison_is_provisional') and REASONS['inferred_period_in_comparison'] not in clauses:
        clauses.append(REASONS['inferred_period_in_comparison'])
    return list(dict.fromkeys(clauses)) or ['Comparison unavailable.']


def short_template(a):
    clauses = clauses_for(a)
    out = clauses[0]
    for clause in clauses[1:2]:
        if len(out) + len(clause) + 1 <= 180:
            out += ' ' + clause
    return out


def is_complex(a):
    substantive = set(a.get('reason_codes') or []) - {'cost_increase', 'cost_decrease', 'inferred_period_in_comparison'}
    return len(substantive) >= 2 or (a.get('priority') == 'high' and 'mixed_duration_baseline' in substantive)


def evidence_hash(active, a, model):
    facts = {k: a.get(k) for k in (
        'bill_version_id', 'total_cents', 'expected_amount_cents', 'deviation_percent', 'baseline_count',
        'baseline_bill_ids', 'baseline_source_rows', 'baseline_method', 'priority', 'reason_codes',
        'transaction_type', 'reading_type', 'service_start', 'service_end', 'comparison_is_provisional')}
    return hashlib.sha256(json.dumps([active['id'], METHOD_VERSION, PROMPT_VERSION, model, facts],
                                    sort_keys=True, default=str).encode()).hexdigest()


def validate_ai(value, clauses):
    # The model cannot author numbers, diagnoses or new claims: all output is selected from computed facts.
    if not isinstance(value, dict) or set(value) != {'clauses'}:
        raise ValueError('Invalid explanation output')
    selected = value['clauses']
    if (not isinstance(selected, list) or not 1 <= len(selected) <= 2
            or any(not isinstance(c, str) or c not in clauses for c in selected)
            or len(set(selected)) != len(selected)):
        raise ValueError('Unsupported explanation clause')
    text = ' '.join(selected)
    if len(text) > 180:
        raise ValueError('Explanation too long')
    if all(c == REASONS['inferred_period_in_comparison'] or c.startswith('Compared with ') for c in selected):
        raise ValueError('Explanation omitted the substantive finding')
    return text


def generate_ai(clauses, key, model):
    schema = {'type': 'object', 'additionalProperties': False, 'required': ['clauses'],
              'properties': {'clauses': {'type': 'array', 'minItems': 1, 'maxItems': 2,
                                         'items': {'type': 'string', 'enum': clauses}}}}
    with httpx.Client(timeout=25) as client:
        r = client.post('https://api.openai.com/v1/responses', headers={'Authorization': f'Bearer {key}'},
                        json={'model': model, 'store': False, 'max_output_tokens': 400,
                              'input': [{'role': 'system', 'content':
                                         'Choose one or two supplied factual clauses for a short utility-bill explanation. '
                                         'Prioritize possible duplicates or multiple charges, then comparison blockers, '
                                         'then significant differences and uncertainty. Do not choose only a baseline-count '
                                         'or inferred-date clause when a substantive concern is supplied. Return clauses '
                                         'verbatim in useful order. Never invent causes or confirm an error.'},
                                        {'role': 'user', 'content': json.dumps(clauses)}],
                              'text': {'format': {'type': 'json_schema', 'name': 'bill_explanation',
                                                  'strict': True, 'schema': schema}}})
    r.raise_for_status()
    data = r.json()
    text = ''.join(p['text'] for x in data.get('output', []) if x.get('type') == 'message'
                   for p in x.get('content', []) if p.get('type') == 'output_text')
    return validate_ai(json.loads(text), clauses)


def explain_bill(db, dataset, bill_id, body):
    active, rows = dataset
    if str(body.import_id) != active['id']:
        raise HTTPException(409, 'The active import changed. Reload this bill.')
    a = next((a for a in evaluate(rows) if a['bill_id'] == str(bill_id)), None)
    if a is None:
        raise HTTPException(404, 'Bill is absent from the active dataset.')
    if a['bill_version_id'] != str(body.bill_version_id):
        raise HTTPException(409, 'The bill version changed. Reload this bill.')
    key, model = os.getenv('OPENAI_API_KEY'), os.getenv('OPENAI_MODEL')
    digest = evidence_hash(active, a, model)
    result = {'import_id': active['id'], 'bill_version_id': a['bill_version_id'], 'evidence_hash': digest,
              'text': short_template(a), 'source': 'template', 'cache_hit': False,
              'complex': is_complex(a), 'status': 'ready'}
    if not result['complex']:
        return result
    if not key or not model:
        return {**result, 'status': 'unavailable'}
    try:
        now = datetime.now(timezone.utc)
        found = db.table('bill_explanation_cache').select('*').eq('evidence_hash', digest).limit(1).execute().data
        if found:
            cached = found[0]
            if cached['status'] == 'ready':
                text = validate_ai({'clauses': cached['clauses']}, clauses_for(a))
                return {**result, 'text': text, 'source': 'ai', 'cache_hit': True}
            if cached['status'] == 'failed':
                return {**result, 'cache_hit': True, 'status': 'unavailable'}
            # Recover a process that died while generating; compare-and-set the old claim timestamp.
            cutoff = (now - timedelta(minutes=2)).isoformat()
            claimed = (db.table('bill_explanation_cache').update({'claimed_at': now.isoformat()})
                       .eq('evidence_hash', digest).eq('status', 'pending').lt('claimed_at', cutoff).execute().data)
            if not claimed:
                return {**result, 'cache_hit': True, 'status': 'pending'}
        else:
            try:
                db.table('bill_explanation_cache').insert({'evidence_hash': digest, 'import_id': active['id'],
                    'bill_version_id': a['bill_version_id'], 'status': 'pending', 'claimed_at': now.isoformat(),
                    'prompt_version': PROMPT_VERSION, 'model': model}).execute()
            except Exception as exc:
                if getattr(exc, 'code', None) == '23505':
                    return {**result, 'status': 'pending'}
                raise
        clauses = clauses_for(a)
        try:
            text = generate_ai(clauses, key, model)
            selected = [c for c in clauses if c in text]
            # Keep the model's selected ordering, which is serialized as the final text.
            selected.sort(key=text.index)
            db.table('bill_explanation_cache').update({'status': 'ready', 'text': text, 'clauses': selected,
                'generated_at': datetime.now(timezone.utc).isoformat()}).eq('evidence_hash', digest).execute()
            return {**result, 'text': text, 'source': 'ai'}
        except Exception:
            db.table('bill_explanation_cache').update({'status': 'failed'}).eq('evidence_hash', digest).execute()
            return {**result, 'status': 'unavailable'}
    except Exception:
        # Cache/database availability must never prevent a factual explanation or review.
        return {**result, 'status': 'unavailable'}
