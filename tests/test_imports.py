from copy import deepcopy
from datetime import datetime
import io
from uuid import uuid4

import pytest
from openpyxl import Workbook

from import_workflow import build_preview, parse_workbook, payload_rows, usage, validate_workbook
from prepare_ledger import HEADERS, digest


def workbook(rows=None):
    book = Workbook(); sheet = book.active
    sheet.append(HEADERS)
    for row in rows or [['Account 123-456', datetime(2026, 7, 1), '6430 - Water & Sewer',
                          'Test building', None, 300, 0, None, None,
                          '4/1/2026-6/1/2026 Actual (Usage 25)']]:
        sheet.append(row)
    buffer = io.BytesIO(); book.save(buffer); book.close()
    return buffer.getvalue()


@pytest.fixture
def parsed():
    return parse_workbook(workbook(), 'ledger.xlsx')


def test_consumption_number_not_invented_unit(parsed):
    p = build_preview(*parsed, {'id': str(uuid4())}, [])
    v = p['payload']['bill_versions'][0]
    assert v['usage_value'] == '25' and v['usage_unit'] is None
    assert usage('Usage 1 and Usage 2') is None


def test_exact_and_paid_status_matching_preserve_bill(parsed):
    base = build_preview(*parsed, {'id': str(uuid4())}, [])
    previous = payload_rows(base['payload'])
    p = build_preview(*parsed, {'id': base['id']}, previous)
    assert p['payload']['bill_versions'][0]['bill_id'] == previous[0]['bill_id']
    assert p['report']['matching']['unchanged'] == 1
    changed = deepcopy(parsed)
    changed[0][0].update(paid_cents=10000, unpaid_cents=20000)
    p = build_preview(*changed, {'id': base['id']}, previous)
    assert p['report']['matching']['updated'] == 1
    assert p['payload']['bill_versions'][0]['bill_id'] == previous[0]['bill_id']


def test_amount_or_description_change_requires_match_review(parsed):
    base = build_preview(*parsed, {'id': str(uuid4())}, [])
    previous = payload_rows(base['payload'])
    for field, value in [('paid_cents', 40000), ('description_original', 'Changed water description')]:
        changed = deepcopy(parsed); changed[0][0][field] = value
        p = build_preview(*changed, {'id': base['id']}, previous)
        assert len(p['pending_matches']) == 1
        assert p['pending_matches'][0]['candidates'][0]['bill_id'] == previous[0]['bill_id']


def test_duplicate_rows_preserved_and_not_silently_matched(parsed):
    base = build_preview(*parsed, {'id': str(uuid4())}, [])
    previous = payload_rows(base['payload'])
    other = deepcopy(previous[0]); other['bill_id'] = str(uuid4()); other['id'] = str(uuid4())
    p = build_preview(*parsed, {'id': base['id']}, previous + [other])
    assert p['report']['matching']['uncertain'] == 1
    assert len(p['pending_matches'][0]['candidates']) == 2
    assert len(p['payload']['bill_versions']) == 1


def test_parser_keeps_duplicate_occurrences():
    row = ['Account 123-456', datetime(2026, 7, 1), '6450 - Trash Disposal', 'Test building',
           None, 28.5, 0, None, None, 'Garbage service']
    records, raw, report = parse_workbook(workbook([row, row]), 'duplicate.xlsx')
    assert len(records) == 2 and report['totals_cents']['total_cents'] == 5700
    assert report['duplicate_groups'][0]['count'] == 2


def test_formula_workbook_rejected():
    row = ['Account 123-456', datetime(2026, 7, 1), '6450 - Trash Disposal', 'Test building',
           None, '=1+1', 0, None, None, 'Garbage service']
    with pytest.raises(ValueError, match='formulas'):
        validate_workbook(workbook([row]))


def test_missing_header_rejected():
    book = Workbook(); book.active.append(['Not a vendor ledger']); b = io.BytesIO(); book.save(b)
    with pytest.raises(ValueError):
        parse_workbook(b.getvalue(), 'wrong.xlsx')
