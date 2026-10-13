"""Exact currency aggregation; no network or authentication side effects."""
from collections import defaultdict
from datetime import date
from decimal import Decimal


def cents(value):
    amount = Decimal(str(value)) * 100
    if not amount.is_finite() or amount != amount.to_integral_value():
        raise ValueError('Invalid currency precision')
    return int(amount)


def select_rows(rows, property_ids=(), category=None, start_date=None, end_date=None):
    selected = set(property_ids)
    return [r for r in rows
            if (not selected or r['property_id'] in selected)
            and (not category or r['category'] == category)
            and (not start_date or r['due_date'] >= start_date.isoformat())
            and (not end_date or r['due_date'] <= end_date.isoformat())]


def totals(rows):
    paid = sum(cents(r['paid_amount']) for r in rows)
    unpaid = sum(cents(r['unpaid_amount']) for r in rows)
    return {
        'currency': 'USD', 'paid_cents': paid, 'unpaid_cents': unpaid,
        'total_cents': paid + unpaid, 'bill_count': len(rows),
        'properties_with_bills': len({r['property_id'] for r in rows}),
        'bills_with_duration': sum(r['duration_days'] is not None for r in rows),
        'inferred_period_count': sum(r['period_status'] == 'inferred' for r in rows),
        'unresolved_period_count': sum(r['period_status'] in ('ambiguous', 'unparsed') for r in rows),
    }


def monthly(rows, start_date=None, end_date=None):
    grouped = defaultdict(list)
    for r in rows:
        grouped[r['due_date'][:7]].append(r)
    if not rows and not (start_date and end_date):
        return []
    first = start_date or date.fromisoformat(min(r['due_date'] for r in rows))
    last = end_date or date.fromisoformat(max(r['due_date'] for r in rows))
    if first > last:
        return []
    cursor, final = first.replace(day=1), last.replace(day=1)
    result = []
    while cursor <= final:
        following = date(cursor.year + (cursor.month == 12), cursor.month % 12 + 1, 1)
        month_rows = grouped[cursor.strftime('%Y-%m')]
        metrics = totals(month_rows)
        # No rows means no recorded bills, not proven zero expense.
        if not month_rows:
            for key in ('paid_cents', 'unpaid_cents', 'total_cents'):
                metrics[key] = None
        result.append({
            'month': cursor.strftime('%Y-%m'), **metrics,
            'has_records': bool(month_rows),
            'selection_covers_full_month': first <= cursor and last.toordinal() >= following.toordinal() - 1,
        })
        cursor = following
    return result


def comparison(current, previous):
    """No rows is missing evidence; zero/negative prior totals have no percentage."""
    current_total = totals(current)['total_cents'] if current else None
    previous_total = totals(previous)['total_cents'] if previous else None
    change = (current_total - previous_total
              if current_total is not None and previous_total is not None else None)
    percentage = (float(Decimal(change) * 100 / Decimal(previous_total))
                  if change is not None and previous_total > 0 else None)
    return {
        'current_total_cents': current_total,
        'previous_total_cents': previous_total,
        'change_cents': change,
        'change_percent': round(percentage, 4) if percentage is not None else None,
        'current_bill_count': len(current), 'previous_bill_count': len(previous),
        'comparison_status': ('missing_current_records' if not current else
                              'missing_previous_records' if not previous else
                              'nonpositive_previous_total' if previous_total <= 0 else 'available'),
    }


def year_comparison(rows, year, start_month, end_month):
    import calendar
    start, end = date(year, start_month, 1), date(year, end_month, calendar.monthrange(year, end_month)[1])
    previous_start = date(year - 1, start_month, 1)
    previous_end = date(year - 1, end_month, calendar.monthrange(year - 1, end_month)[1])
    current = select_rows(rows, start_date=start, end_date=end)
    previous = select_rows(rows, start_date=previous_start, end_date=previous_end)
    current_properties = {r['property_id'] for r in current}
    previous_properties = {r['property_id'] for r in previous}
    common = current_properties & previous_properties
    current_months, previous_months = defaultdict(list), defaultdict(list)
    for r in current:
        current_months[int(r['due_date'][5:7])].append(r)
    for r in previous:
        previous_months[int(r['due_date'][5:7])].append(r)
    return {
        'currency': 'USD', 'current_year': year, 'previous_year': year - 1,
        'current_period': {'start': start.isoformat(), 'end': end.isoformat()},
        'previous_period': {'start': previous_start.isoformat(), 'end': previous_end.isoformat()},
        **comparison(current, previous),
        'coverage': {
            'current_property_count': len(current_properties),
            'previous_property_count': len(previous_properties),
            'properties_in_both_periods': len(common),
            'current_only_property_ids': sorted(current_properties - previous_properties),
            'previous_only_property_ids': sorted(previous_properties - current_properties),
            'unverified_completeness': True,
        },
        'same_property_comparison': {
            'property_ids': sorted(common),
            **comparison([r for r in current if r['property_id'] in common],
                         [r for r in previous if r['property_id'] in common]),
        },
        'months': [{'month_number': m, **comparison(current_months[m], previous_months[m])}
                   for m in range(start_month, end_month + 1)],
    }


def period_overlaps(row, start_date=None, end_date=None):
    # Source periods use [start,end). User's filter end date is inclusive.
    # A bill ending July 1 has no July service days under this convention.
    if not row.get('service_start') or not row.get('service_end'):
        return False
    return ((not start_date or row['service_end'] > start_date.isoformat())
            and (not end_date or row['service_start'] <= end_date.isoformat()))


def bill_detail(row):
    from decimal import ROUND_HALF_UP
    paid, unpaid = cents(row['paid_amount']), cents(row['unpaid_amount'])
    amount = paid + unpaid
    eligible = (row['transaction_type'] == 'service_candidate'
                and row['duration_days'] is not None and row['duration_days'] > 0
                and amount >= 0)
    daily = (str((Decimal(amount) / 100 / row['duration_days']).quantize(
        Decimal('0.000001'), rounding=ROUND_HALF_UP)) if eligible else None)
    return {
        'bill_id': row['bill_id'], 'bill_version_id': row['id'],
        'account_id': row['account_id'], 'account_number': row['account_number'],
        'category': row['category'], 'transaction_type': row['transaction_type'],
        'due_date': row['due_date'], 'paid_date': row['paid_date'],
        'description': row['description'], 'reading_type': row['reading_type'],
        'paid_cents': paid, 'unpaid_cents': unpaid, 'total_cents': amount,
        'service_start': row['service_start'], 'service_end': row['service_end'],
        'duration_days': row['duration_days'], 'period_status': row['period_status'],
        'period_evidence': row['period_evidence'],
        'cost_per_day_usd': daily,
        'cost_per_day_is_provisional': eligible and row['period_status'] == 'inferred',
        'cost_per_day_requires_charge_review': eligible,
        'quality_issues': row['quality_issues'],
        'source': {'sheet': row['source_sheet'], 'row': row['source_row']},
    }
