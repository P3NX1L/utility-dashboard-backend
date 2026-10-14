from datetime import date

from fastapi.testclient import TestClient

from dashboard_logic import building_monthly


def row(key, amount, account='a', due='2026-01-15', kind='service_candidate', category='water_sewer'):
    return dict(id=key, bill_id=key, property_id='property', property_name='Property',
                account_id=account, account_number=account, due_date=due, category=category,
                paid_amount=amount, unpaid_amount='0.00', transaction_type=kind,
                duration_days=30 if kind == 'service_candidate' else None,
                period_status='inferred')


def test_combined_exact_cents_and_account_breakdown_reconcile():
    result = building_monthly([row('1', '0.10'), row('2', '0.20', 'b'), row('3', '-0.05', 'b')])
    assert result['totals']['total_cents'] == 25
    assert result['months'][0]['total_cents'] == 25
    assert sum(a['months'][0]['total_cents'] for a in result['account_series']) == 25
    assert result['months'][0]['bill_ids'] == ['1', '2', '3']
    assert result['months'][0]['recorded_account_count'] == 2


def test_month_without_records_is_gap_not_zero_for_total_and_accounts():
    result = building_monthly([row('1', '100'), row('2', '200', 'b', '2026-03-15')])
    assert result['months'][1]['month'] == '2026-02'
    assert result['months'][1]['total_cents'] is None
    assert result['months'][1]['bill_ids'] == []
    assert all(a['months'][1]['total_cents'] is None for a in result['account_series'])
    assert result['coverage']['complete_billing_history_verified'] is False


def test_known_accounts_are_from_history_not_just_selected_month():
    rows = [row('1', '100'), row('2', '200', 'b', '2026-03-15')]
    result = building_monthly(rows, date(2026, 1, 1), date(2026, 1, 31))
    assert result['coverage']['known_account_count'] == 2
    assert result['months'][0]['recorded_account_count'] == 1
    assert result['account_series'][1]['months'][0]['total_cents'] is None
    assert result['coverage']['observed_account_coverage_varies'] is True


def test_payment_plans_penalties_and_credits_remain_separate_and_all_reconciles():
    rows = [row('bill', '300'), row('plan', '159.56', kind='installment'),
            row('fee', '24.44', kind='penalty'), row('credit', '-20', kind='credit')]
    regular = building_monthly(rows)
    other = building_monthly(rows, charge_scope='other')
    all_charges = building_monthly(rows, charge_scope='all')
    assert regular['totals']['bill_count'] == 1
    assert regular['totals']['total_cents'] == 30000
    assert other['totals']['total_cents'] == 16400
    assert all_charges['totals']['total_cents'] == 46400
    assert regular['other_charge_totals']['total_cents'] == 16400
    assert all_charges['all_charge_totals']['bill_count'] == 4


def test_due_date_category_and_partial_month_boundaries_are_exact():
    rows = [row('before', '100', due='2026-01-02'), row('included', '200'),
            row('trash', '300', category='trash')]
    result = building_monthly(rows, date(2026, 1, 10), date(2026, 1, 20), 'water_sewer')
    assert result['months'][0]['total_cents'] == 20000
    assert result['months'][0]['bill_ids'] == ['included']
    assert result['months'][0]['selection_covers_full_month'] is False


def test_identical_source_transactions_not_silently_deduplicated():
    result = building_monthly([row('source-1', '25'), row('source-2', '25')])
    assert result['months'][0]['bill_count'] == 2
    assert result['months'][0]['total_cents'] == 5000


def test_regular_view_without_service_records_returns_gaps_and_separate_total():
    result = building_monthly([row('plan', '159.56', kind='installment')])
    assert result['months'][0]['total_cents'] is None
    assert result['accounts'] == []
    assert result['other_charge_totals']['total_cents'] == 15956


def test_endpoint_rejects_bad_scope_and_foreign_property_and_long_range():
    from main import app, get_dataset
    pid = '429fab95-a9b7-5d49-9671-6d530fb4ad01'
    source = row('source', '100')
    source['property_id'] = pid
    app.dependency_overrides[get_dataset] = lambda: (
        {'id': 'import', 'activated_at': None, 'validation_report': {}}, [source])
    try:
        client = TestClient(app)
        path = '/api/v1/properties/' + pid + '/monthly'
        result = client.get(path)
        assert result.status_code == 200
        assert result.json()['totals']['total_cents'] == 10000
        assert client.get(path, params={'charge_scope': 'invalid'}).status_code == 422
        assert client.get(path, params={'start_date': '2027-01-01', 'end_date': '2026-01-01'}).status_code == 422
        assert client.get(path, params={'start_date': '2000-01-01', 'end_date': '2026-01-01'}).status_code == 422
        assert client.get('/api/v1/properties/00000000-0000-0000-0000-000000000000/monthly').status_code == 404
    finally:
        app.dependency_overrides.pop(get_dataset, None)
