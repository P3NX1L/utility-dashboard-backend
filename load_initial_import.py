"""Initial ledger loader only. Updated-file matching is a separate workflow."""
import hashlib
import json
import os
from datetime import date
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid5

ROOT = Path(__file__).resolve().parent
NAMESPACE = UUID('c5cfec7b-726a-46cd-a8b9-87adf39e072f')
EXPECTED_HASH = '7f22d9573d3d46805c6e61199d483c55ef5ea3e8c8cb54e54953aa4214e89700'


def uid(*parts):
    return str(uuid5(NAMESPACE, json.dumps(parts)))


def money(cents):
    return str(Decimal(cents) / 100)


def build_payload(records, raw_rows, report, import_id):
    properties, accounts, bills, versions, originals = {}, {}, [], [], []
    transactions = {(r['source_sheet'], r['source_row']) for r in records}
    controls = {(r['sheet'], r['row']): r for r in report['reconciliation']}
    excluded = {(r['sheet'], r['row']): r for r in report['excluded_rows']}
    for r in raw_rows:
        key = (r['sheet'], r['row'])
        values = r['values']
        if key in transactions:
            kind = 'transaction'
        elif key in controls:
            kind = 'grand_total' if controls[key]['scope'] == 'grand_total' else 'subtotal'
        elif not any(v is not None for v in values):
            kind = 'blank'
        elif values[:2] == ['Reference', 'Due Date'] or key in excluded:
            kind = 'header'
        else:
            kind = 'metadata'
        originals.append({
            'id': uid('row', import_id, *key), 'import_id': import_id,
            'sheet_name': r['sheet'], 'row_number': r['row'],
            'row_kind': kind, 'raw_data': {'values': values},
            'parse_issues': [],
        })
    statuses = {
        'explicit': 'explicit', 'inferred_year': 'inferred',
        'needs_review_ambiguous_or_outside_rules': 'ambiguous',
        'needs_review_unparsed': 'unparsed', 'not_applicable': 'not_applicable',
    }
    categories = {'Water & Sewer': 'water_sewer', 'Trash Disposal': 'trash'}
    for r in records:
        if not r['account_number']:
            raise ValueError('Missing account; resolve before loading.')
        property_id = uid('property', r['property_id'])
        account_id = uid('account', property_id, 'City of Chicago', r['account_number'])
        row_id = uid('row', import_id, r['source_sheet'], r['source_row'])
        bill_id = uid('initial-bill', row_id)
        properties[property_id] = {
            'id': property_id, 'property_key': r['property_id'],
            'name': r['property_label'],
        }
        accounts[account_id] = {
            'id': account_id, 'property_id': property_id,
            'provider': 'City of Chicago', 'account_number': r['account_number'],
        }
        bills.append({'id': bill_id, 'account_id': account_id})
        versions.append({
            'id': uid('version', import_id, bill_id), 'bill_id': bill_id,
            'import_id': import_id, 'source_row_id': row_id,
            'category': categories.get(r['category'], 'other'), 'gl_account': r['gl_account'],
            'transaction_type': r['transaction_type'], 'due_date': r['due_date'],
            'paid_date': r['paid_date'], 'payment_reference': r['payment_reference'],
            'description': r['description_original'], 'currency': 'USD',
            'paid_amount': money(r['paid_cents']), 'unpaid_amount': money(r['unpaid_cents']),
            'service_start': r['service_start'], 'service_end': r['service_end'],
            'period_status': statuses[r['date_parsing_status']],
            'period_evidence': r['description_original'], 'reading_type': r['reading_type'],
            'match_method': 'new',
            'match_evidence': {
                'method': 'initial_snapshot_row_identity_v1',
                'candidate_signature': r['bill_match_candidate'],
                'exact_row_signature': r['exact_row_signature'],
            },
            'quality_issues': r['validation_flags'] + (
                ['service_year_inferred'] if r['date_parsing_status'] == 'inferred_year' else []
            ),
        })
    return {
        'properties': list(properties.values()), 'utility_accounts': list(accounts.values()),
        'import_rows': originals, 'bills': bills, 'bill_versions': versions,
    }


def main():
    from dotenv import load_dotenv
    from supabase import create_client
    from prepare_ledger import run

    load_dotenv(ROOT / '.env')
    client = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SECRET_KEY'])
    bucket = os.environ['SUPABASE_STORAGE_BUCKET']
    source_name = os.environ['SUPABASE_SOURCE_FILE']
    content = client.storage.from_(bucket).download(source_name)
    file_hash = hashlib.sha256(content).hexdigest()
    if file_hash != EXPECTED_HASH:
        raise ValueError('This initial loader only accepts the file we reviewed. Stop for updated-file matching.')
    folder = ROOT / 'local_data' / file_hash
    folder.mkdir(parents=True, exist_ok=True)
    source = folder / 'source.xlsx'
    source.write_bytes(content)
    run(source, folder)
    read = lambda name: json.loads((folder / f'{name}.json').read_text(encoding='utf-8'))
    records, raw_rows, report = read('transactions'), read('raw_rows'), read('quality_report')
    if report['rejected_rows'] or report['transaction_count'] != 1641 or report['property_count'] != 68:
        raise ValueError('Source validation failed; no records loaded.')
    if report['totals_cents'] != {'paid_cents': 72525708, 'unpaid_cents': 201047, 'total_cents': 72726755}:
        raise ValueError('Source totals changed; no records loaded.')

    import_id = uid('initial-import', file_hash)
    payload = build_payload(records, raw_rows, report, import_id)
    existing = client.table('imports').select('id,status,file_sha256').execute().data
    if any(x['id'] != import_id for x in existing):
        raise ValueError('Other imports already exist. This script is only for the first dataset.')
    if existing and existing[0]['status'] not in ('processing', 'failed', 'needs_review'):
        raise ValueError('This import has progressed beyond staging; no changes made.')
    if not existing:
        for table in payload:
            if client.table(table).select('id').limit(1).execute().data:
                raise ValueError(f'{table} is not empty. Stop to avoid mixing existing records.')
        client.table('imports').insert({
            'id': import_id, 'filename': source_name, 'storage_path': source_name,
            'file_sha256': file_hash, 'status': 'processing',
            'scope': {'mode': 'full_snapshot', 'bucket': bucket, 'loader': 'initial_v1'},
            'source_row_count': len(raw_rows), 'validation_report': report,
        }).execute()
    else:
        client.table('imports').update({'status': 'processing'}).eq('id', import_id).execute()

    try:
        for table, rows in payload.items():
            for start in range(0, len(rows), 200):
                client.table(table).upsert(rows[start:start + 200], on_conflict='id').execute()
            print(f'{table}: {len(rows)} records staged')

        # Paginate: Supabase normally limits query responses to 1,000 rows.
        stored = []
        start = 0
        while True:
            page = (client.table('bill_versions')
                    .select('id,paid_amount,unpaid_amount,total_amount,duration_days')
                    .eq('import_id', import_id).order('id')
                    .range(start, start + 499).execute().data)
            stored.extend(page)
            if len(page) < 500:
                break
            start += 500
        expected = {x['id']: x for x in payload['bill_versions']}
        if {x['id'] for x in stored} != set(expected) or len(stored) != len(expected):
            raise ValueError('Stored bill IDs or counts do not match.')
        for row in stored:
            original = expected[row['id']]
            paid, unpaid = Decimal(original['paid_amount']), Decimal(original['unpaid_amount'])
            days = ((date.fromisoformat(original['service_end']) - date.fromisoformat(original['service_start'])).days
                    if original['service_start'] else None)
            if (Decimal(str(row['paid_amount'])) != paid
                or Decimal(str(row['unpaid_amount'])) != unpaid
                or Decimal(str(row['total_amount'])) != paid + unpaid
                or row['duration_days'] != days):
                raise ValueError(f"Stored amount or duration mismatch: {row['id']}")
        for table, rows in payload.items():
            query = client.table(table).select('id', count='exact').limit(1)
            if table in ('import_rows', 'bill_versions'):
                query = query.eq('import_id', import_id)
            if query.execute().count != len(rows):
                raise ValueError(f'Stored count mismatch for {table}')

        report['database_verification'] = {
            'passed': True, 'bill_count': len(stored),
            'amounts_and_durations_checked': True,
        }
        client.table('imports').update({
            'status': 'needs_review', 'validation_report': report,
        }).eq('id', import_id).execute()
        print('\nVerified: 68 properties, 1,641 bills, $727,267.55.')
        print('All stored bill amounts and generated durations match.')
        print('Import status: needs_review. Dataset has NOT been activated.')
        print('Known source grand-total difference: $760.80.')
    except Exception:
        try:
            client.table('imports').update({'status': 'failed'}).eq('id', import_id).execute()
        except Exception:
            pass
        print('Import incomplete and inactive. Rerun this same script to retry.')
        raise


if __name__ == '__main__':
    main()
