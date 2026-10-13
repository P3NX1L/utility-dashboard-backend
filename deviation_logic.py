"""Transparent cost-per-day comparisons. No database writes or LLM decisions."""
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import re
from statistics import median

from dashboard_logic import bill_detail, cents, period_overlaps

METHOD_VERSION = 'cost_per_day_median_v1'
PARAMETERS = {
    'minimum_prior_bills': 4, 'maximum_prior_bills': 6, 'lookback_days': 730,
    'similar_duration_ratio': [0.8, 1.2], 'spike_label_above_percent': 30,
    'minimum_deviation_cents': 1,
    'seasonally_adjusted': False,
}
ADJUSTMENT = re.compile(r'credit|refund|balance|adjust|non.?meter', re.I)


def amount(row):
    return cents(row['paid_amount']) + cents(row['unpaid_amount'])


def daily(row):
    return Decimal(amount(row)) / 100 / row['duration_days']


def decimal_string(value):
    return str(value.quantize(Decimal('0.000001'), rounding=ROUND_HALF_UP)) if value is not None else None


def group_key(row):
    return row['account_id'], row['category'], row['reading_type']


def evaluate(rows):
    """Evaluate full history BEFORE display filtering. Only older, non-overlapping
    periods can enter a baseline. Each identical source row remains a separate bill.
    """
    ordered = sorted(rows, key=lambda r: (r['due_date'], r['id']))
    service_day_counts = Counter((r['account_id'], r['category'], r['due_date'])
                                 for r in rows if r['transaction_type'] == 'service_candidate')
    problems = {}
    for r in ordered:
        reasons = []
        if 'identical_rows_review' in r['quality_issues']:
            reasons.append('duplicate_candidate')
        if r['transaction_type'] != 'service_candidate':
            reasons.append('separate_' + r['transaction_type'])
        else:
            if r['period_status'] not in ('explicit', 'inferred') or not r['duration_days']:
                reasons.append('service_period_unavailable')
            if r['reading_type'] not in ('actual', 'estimated'):
                reasons.append('reading_type_unspecified')
            if amount(r) <= 0:
                reasons.append('nonpositive_service_charge')
            if ADJUSTMENT.search(r['description'] or ''):
                reasons.append('adjustment_or_nonmetered_description')
            if service_day_counts[(r['account_id'], r['category'], r['due_date'])] > 1:
                reasons.append('multiple_service_charges_same_due_date')
        problems[r['id']] = reasons
    histories = defaultdict(list)
    results = []
    for r in ordered:
        reasons = list(problems[r['id']])
        result = {
            **bill_detail(r), 'property_id': r['property_id'], 'property_name': r['property_name'],
            'assessment': 'needs_review', 'needs_review': True,
            'reason_codes': reasons, 'is_deviation': False,
            'direction': None, 'is_spike': False, 'priority': 'medium',
            'expected_amount_cents': None, 'difference_cents': None,
            'deviation_percent': None, 'baseline_cost_per_day_usd': None,
            'baseline_method': None, 'baseline_bill_ids': [],
            'baseline_source_rows': [], 'baseline_count': 0,
            'comparison_is_provisional': r['period_status'] == 'inferred',
            'prior_year_context': None,
        }
        if reasons:
            result['explanation'] = 'Review required: ' + ', '.join(reasons).replace('_', ' ') + '. No deviation percentage calculated.'
            results.append(result)
            continue
        prior = [p for p in histories[group_key(r)]
                 if p['due_date'] < r['due_date']
                 and (date.fromisoformat(r['due_date']) - date.fromisoformat(p['due_date'])).days <= 730
                 and p['service_end'] <= r['service_start']]
        comparable = [p for p in prior if Decimal('0.8') <= Decimal(p['duration_days']) / r['duration_days'] <= Decimal('1.2')]
        selected = comparable[-6:] if len(comparable) >= 4 else prior[-6:]
        result['baseline_method'] = ('similar_duration_median' if len(comparable) >= 4 else 'daily_rate_fallback')
        result['baseline_count'] = len(selected)
        result['baseline_bill_ids'] = [p['bill_id'] for p in selected]
        result['baseline_source_rows'] = [{'sheet': p['source_sheet'], 'row': p['source_row']} for p in selected]
        # Supplemental prior-year context; never described as seasonal adjustment.
        year_candidates = [p for p in prior if
                           abs((date.fromisoformat(r['service_end']) - date.fromisoformat(p['service_end'])).days - 365) <= 45
                           and Decimal('0.8') <= Decimal(p['duration_days']) / r['duration_days'] <= Decimal('1.2')]
        if year_candidates:
            previous = min(year_candidates, key=lambda p: (abs((date.fromisoformat(r['service_end']) - date.fromisoformat(p['service_end'])).days - 365), p['id']))
            result['prior_year_context'] = {
                'bill_id': previous['bill_id'], 'source_row': previous['source_row'],
                'service_start': previous['service_start'], 'service_end': previous['service_end'],
                'cost_per_day_usd': decimal_string(daily(previous)),
                'change_percent': float(((daily(r) / daily(previous) - 1) * 100).quantize(Decimal('0.0001'))),
                'note': 'Nearest eligible period about one year earlier; not a seasonal model.',
            }
        if len(selected) < 4:
            result['reason_codes'] = ['insufficient_comparable_history']
            result['explanation'] = f'Only {len(selected)} eligible prior bills; at least 4 are required. No deviation percentage calculated.'
        else:
            base = median([daily(p) for p in selected])
            expected_cents = int((base * r['duration_days'] * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
            delta = amount(r) - expected_cents
            percentage = Decimal(delta) / expected_cents * 100 if expected_cents > 0 else None
            provisional = r['period_status'] == 'inferred' or any(p['period_status'] == 'inferred' for p in selected)
            result.update(
                expected_amount_cents=expected_cents, difference_cents=delta,
                deviation_percent=float(percentage.quantize(Decimal('0.0001'))) if percentage is not None else None,
                baseline_cost_per_day_usd=decimal_string(base),
                comparison_is_provisional=provisional,
                assessment='deviated' if delta else 'matches_baseline',
                is_deviation=bool(delta), direction='increase' if delta > 0 else 'decrease' if delta < 0 else 'unchanged',
                is_spike=percentage is not None and percentage > 30,
                priority='high' if percentage is not None and abs(percentage) > 30 else 'low',
                needs_review=bool(delta) or provisional or result['baseline_method'] == 'daily_rate_fallback',
                reason_codes=(['cost_increase' if delta > 0 else 'cost_decrease'] if delta else [])
                             + (['inferred_period_in_comparison'] if provisional else [])
                             + (['mixed_duration_baseline'] if result['baseline_method'] == 'daily_rate_fallback' else []),
            )
            result['explanation'] = (
                f"Bill ${amount(r)/100:,.2f} over {r['duration_days']} days; expected ${expected_cents/100:,.2f} "
                f"from the median cost/day of {len(selected)} earlier eligible bills. "
                + (f"Difference {float(percentage):+.2f}%." if percentage is not None else 'Percentage unavailable.')
                + (' Dates in this comparison include inferred years.' if provisional else '')
                + (' Baseline includes different billing lengths.' if result['baseline_method'] == 'daily_rate_fallback' else '')
                + ' Spending comparison; not proof of a usage change or billing error.'
            )
        results.append(result)
        # Even a bill without enough earlier history can become a later baseline input.
        # Flagged spikes remain in history; a sustained increase can shift the rolling baseline.
        histories[group_key(r)].append(r)
    return results


def visible_results(results, start_date=None, end_date=None, date_basis='due_date'):
    shown = []
    for r in results:
        basis = date_basis
        if date_basis == 'service_overlap' and r['service_start'] and r['service_end']:
            include = period_overlaps(r, start_date, end_date)
        else:
            basis = 'due_date_fallback' if date_basis == 'service_overlap' else 'due_date'
            include = ((not start_date or r['due_date'] >= start_date.isoformat())
                       and (not end_date or r['due_date'] <= end_date.isoformat()))
        if include:
            shown.append({**r, 'date_filter_basis': basis})
    return shown


def chart_series(results):
    """Chart points contain the same assessment and expected values as the review list."""
    invoice, adjusted = defaultdict(list), defaultdict(list)
    for r in results:
        common = {
            'bill_id': r['bill_id'], 'bill_version_id': r['bill_version_id'],
            'due_date': r['due_date'], 'service_start': r['service_start'], 'service_end': r['service_end'],
            'duration_days': r['duration_days'], 'period_status': r['period_status'],
            'assessment': r['assessment'], 'needs_review': r['needs_review'],
            'direction': r['direction'], 'is_spike': r['is_spike'], 'priority': r['priority'],
            'deviation_percent': r['deviation_percent'], 'explanation': r['explanation'],
            'baseline_bill_ids': r['baseline_bill_ids'], 'point_type': 'bill',
            'comparison_is_provisional': r['comparison_is_provisional'],
            'actual_amount_cents': r['total_cents'], 'expected_amount_cents': r['expected_amount_cents'],
        }
        invoice[(r['account_id'], r['category'], r['reading_type'], r['transaction_type'])].append({
            **common, 'date': r['due_date'], 'actual': r['total_cents'] / 100,
            'expected': r['expected_amount_cents'] / 100 if r['expected_amount_cents'] is not None else None,
        })
        if r['transaction_type'] == 'service_candidate' and r['service_end']:
            adjusted[(r['account_id'], r['category'], r['reading_type'])].append({
                **common, 'date': r['service_end'],
                'actual': float(r['cost_per_day_usd']) if r['cost_per_day_usd'] is not None else None,
                'expected': float(r['baseline_cost_per_day_usd']) if r['baseline_cost_per_day_usd'] is not None else None,
            })
    output = {'invoice_amount': [], 'cost_per_day': []}
    for key, points in invoice.items():
        output['invoice_amount'].append({'account_id': key[0], 'category': key[1], 'reading_type': key[2],
                                        'transaction_type': key[3], 'unit': 'USD',
                                        'points': sorted(points, key=lambda p: (p['date'], p['bill_version_id']))})
    for key, points in adjusted.items():
        ordered = sorted(points, key=lambda p: (p['date'], p['bill_version_id']))
        with_gaps, previous_end = [], None
        for p in ordered:
            if previous_end and p['service_start'] > previous_end:
                with_gaps.append({'date': p['service_start'], 'actual': None, 'expected': None,
                                  'point_type': 'gap', 'reason': 'no_service_period_coverage_in_this_series'})
            with_gaps.append(p)
            previous_end = max(previous_end or p['service_end'], p['service_end'])
        output['cost_per_day'].append({'account_id': key[0], 'category': key[1], 'reading_type': key[2],
                                      'unit': 'USD/day', 'points': with_gaps})
    return output


def analyze(rows, start_date=None, end_date=None, date_basis='due_date'):
    evaluated = evaluate(rows)
    shown = visible_results(evaluated, start_date, end_date, date_basis)
    return {
        'method_version': METHOD_VERSION, 'parameters': PARAMETERS,
        'summary': {
            'bill_count': len(shown),
            'assessed_count': sum(r['assessment'] != 'needs_review' for r in shown),
            'deviation_count': sum(r['is_deviation'] for r in shown),
            'increase_count': sum(r['direction'] == 'increase' for r in shown),
            'decrease_count': sum(r['direction'] == 'decrease' for r in shown),
            'spike_count': sum(r['is_spike'] for r in shown),
            'unassessable_count': sum(r['assessment'] == 'needs_review' for r in shown),
            'review_count': sum(r['needs_review'] for r in shown),
            'service_date_fallback_count': sum(r['date_filter_basis'] == 'due_date_fallback' for r in shown),
        },
        'assessments': sorted(shown, key=lambda r: (r['due_date'], r['bill_version_id']), reverse=True),
        'charts': chart_series(shown),
        'limitations': [
            'Rolling historical spending baseline; not seasonally adjusted or physical consumption.',
            'Inferred service years remain provisional; provider date convention needs confirmation.',
            'Every nonzero difference after rounding expected cost to cents is flagged; high review volume is intentional.',
            'A sustained increase can shift the rolling baseline; persistent-episode tracking is a separate feature.',
            'Service overlap selects whole bills. Missing periods use an explicitly labeled due-date fallback.',
            'These charts are calculated on demand. The review queue uses the latest saved analysis; saving an analysis requires an admin.',
        ],
    }
