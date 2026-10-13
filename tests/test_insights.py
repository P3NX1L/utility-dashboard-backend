from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from insights import generate_insights, validate_output
from insights import evidence_context


def test_no_fake_ai_when_key_missing(monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    with pytest.raises(HTTPException) as error:
        generate_insights({'id':'test'}, [], [], SimpleNamespace())
    assert error.value.status_code == 503


def test_unknown_evidence_is_rejected():
    value={'insights':[{'title':'Review', 'observation':'Change requires review',
                       'suggestion':'Check original bill', 'evidence_ids':['invented-bill']}]}
    with pytest.raises(ValueError):
        validate_output(value,[{'id':'portfolio'}])


def test_valid_observation_keeps_evidence():
    value={'insights':[{'title':'Review', 'observation':'Change requires review',
                       'suggestion':'Check original bill', 'evidence_ids':['portfolio']}]}
    assert validate_output(value,[{'id':'portfolio'}]) == value


def test_ai_context_has_metrics_not_private_names_or_notes():
    row=dict(id='version',bill_id='bill',property_id='property',property_name='Private address',
             account_id='account',account_number='Private account',category='water_sewer',
             transaction_type='service_candidate',due_date='2026-07-01',paid_date=None,
             paid_amount='300.00',unpaid_amount='0.00',description='Private text',
             reading_type='actual',service_start='2026-04-01',service_end='2026-06-01',duration_days=61,
             period_status='explicit',period_evidence='Private evidence',quality_issues=[],source_sheet='Private sheet',source_row=2)
    evidence, model = evidence_context({'validation_report':{}},[row],[row])
    import json
    text=json.dumps(model)
    assert 'Private' not in text and 'account_number' not in text and 'bill_id' not in text
    assert next(e for e in evidence if e['kind']=='bill')['property_name']=='Private address'
    assert next(e for e in model if e['id']=='portfolio')['total_cents']==30000
