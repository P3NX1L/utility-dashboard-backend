"""Prepare a vendor-ledger export without deleting or guessing transaction records.
Usage: python prepare_ledger.py source.xlsx output_directory
Requires pandas and openpyxl. Outputs JSON suitable for subsequent database import.
"""
import argparse, collections, datetime as dt, hashlib, json, re
from decimal import Decimal
from pathlib import Path
import pandas as pd

HEADERS = ['Reference','Due Date','GL Account','Property','Unit','Paid','Unpaid','Check #','Paid Date','Description']
def norm(v): return re.sub(r'\s+', ' ', str(v or '')).strip()
def digest(v): return hashlib.sha256(json.dumps(v, sort_keys=True, default=str).encode()).hexdigest()
def serial(v):
    if pd.isna(v): return None
    if isinstance(v,(dt.datetime,dt.date,pd.Timestamp)): return v.isoformat()
    if hasattr(v,'item'): return v.item()
    return v
def cents(v):
    if v is None or pd.isna(v): raise ValueError('Missing amount')
    d=Decimal(str(v))
    if not d.is_finite() or d*100!=(d*100).to_integral_value(): raise ValueError('Invalid currency precision')
    return int(d*100)
def date(v):
    if v is None or pd.isna(v): return None
    if isinstance(v,(dt.datetime,dt.date,pd.Timestamp)): return v.date().isoformat() if hasattr(v,'date') else v.isoformat()
    raise ValueError('Date is not a typed Excel date; manual review required')
def classify(description,total):
    s=description.lower()
    if total<0: return 'credit','Negative signed amount'
    if re.search(r'penalt|late\s*fee|late\s*charge',s): return 'penalty','Explicit penalty/late-fee wording'
    if re.search(r'payment\s*plan|installment',s): return 'installment','Explicit payment-plan/installment wording'
    if re.search(r'actual|estimat|non.?meter|service|garbage|sewer|water',s): return 'service_candidate','Service/reading wording; classification requires confirmation'
    return 'unclassified','Insufficient explicit description'
PERIOD_PATTERN=re.compile(r'(?<!\d)(\d{1,2})/(\d{1,2})(?:/(20\d{2}))?\s*[-–]\s*(\d{1,2})/(\d{1,2})(?:/(20\d{2}))?(?!\d)')
def service_period(description,due_date,total,kind):
    result={'service_start':None,'service_end':None,'duration_days':None,'billing_length':None,'date_parsing_status':'not_applicable','cost_per_day_usd':None}
    if kind!='service_candidate': return result
    m=PERIOD_PATTERN.search(description)
    if not m: result['date_parsing_status']='needs_review_unparsed';return result
    a,b,y,c,d,z=m.groups();a,b,c,d=map(int,[a,b,c,d]);due=dt.date.fromisoformat(due_date);candidates=[]
    for ey in ([int(z)] if z else range(due.year-1,due.year+2)):
        for sy in ([int(y)] if y else [ey-1,ey]):
            try: start,end=dt.date(sy,a,b),dt.date(ey,c,d)
            except ValueError: continue
            days=(end-start).days;lag=(due-end).days
            if 15<=days<=100 and -7<=lag<=120: candidates.append((start,end,days))
    if len(candidates)!=1: result['date_parsing_status']='needs_review_ambiguous_or_outside_rules';return result
    start,end,days=candidates[0]
    result.update(service_start=start.isoformat(),service_end=end.isoformat(),duration_days=days,billing_length='about_1_month' if 20<=days<=40 else 'about_2_months' if 45<=days<=75 else 'other_duration',date_parsing_status='explicit' if y and z else 'inferred_year',cost_per_day_usd=round(total/100/days,6))
    return result
def run(source,out):
    source=Path(source);out=Path(out);out.mkdir(parents=True,exist_ok=True)
    filehash=hashlib.sha256(source.read_bytes()).hexdigest()
    records=[];excluded=[];rejected=[];controls=[];raw=[];metadata=[]
    for sheet,df in pd.read_excel(source,sheet_name=None,header=None,dtype=object).items():
        header=None;section=None
        for index,values in enumerate(df.itertuples(index=False,name=None),1):
            vals=[serial(v) for v in values]
            raw.append({'sheet':sheet,'row':index,'values':vals})
            if [norm(v) for v in vals[:10]]==HEADERS: header=index;continue
            if header is None:
                if any(v is not None for v in vals): metadata.append({'sheet':sheet,'row':index,'values':vals})
                continue
            r=dict(zip(HEADERS,vals[:10]))
            if not any(v is not None for v in vals): excluded.append({'sheet':sheet,'row':index,'reason':'blank'});continue
            if r['Due Date'] is None and r['Property'] is None:
                if r['Paid'] is not None or r['Unpaid'] is not None:
                    controls.append({'sheet':sheet,'row':index,'scope':'grand_total' if norm(r['Reference']).lower()=='total' else section,'paid_cents':cents(r['Paid']),'unpaid_cents':cents(r['Unpaid'])})
                    excluded.append({'sheet':sheet,'row':index,'reason':'source total; never transaction'})
                elif re.match(r'^\d+\s*-',norm(r['Reference'])):
                    section=norm(r['Reference']);excluded.append({'sheet':sheet,'row':index,'reason':'category heading'})
                else: rejected.append({'sheet':sheet,'row':index,'reason':'Unrecognized nonblank row','raw':r})
                continue
            try:
                due=date(values[1]);paiddate=date(values[8]);p=norm(r['Property']);gl=norm(r['GL Account']);ref=norm(r['Reference'])
                if not due or not p or not gl: raise ValueError('Missing due date, property or GL category')
                pa,un=cents(r['Paid']),cents(r['Unpaid']);total=pa+un
                account=re.search(r'(\d+(?:-\d+)+)',ref)
                acct=account.group(1) if account else None
                description=norm(r['Description']);kind,reason=classify(description,total)
                candidate=[p,acct,gl,due,description.lower(),total]
                records.append({'record_id':digest([filehash,sheet,index]),'dataset_id':filehash,'source_file':source.name,'source_sheet':sheet,'source_row':index,'property_id':digest(p.lower()),'property_label':p,'account_number':acct,'reference_original':r['Reference'],'gl_account':gl,'category':gl.split(' - ',1)[-1],'due_date':due,'due_month':due[:7],'paid_cents':pa,'unpaid_cents':un,'total_cents':total,'paid_date':paiddate,'payment_reference':r['Check #'],'description_original':r['Description'],'unit_original':r['Unit'],'transaction_type':kind,'classification_reason':reason,'reading_type':'estimated' if 'estimat' in description.lower() else 'actual' if 'actual' in description.lower() else 'unspecified','service_start':None,'service_end':None,'bill_match_candidate':digest(candidate),'exact_row_signature':digest(r),'validation_flags':([] if acct else ['account_unparsed'])+([] if description else ['description_missing'])})
            except (ValueError,TypeError) as e: rejected.append({'sheet':sheet,'row':index,'reason':str(e),'raw':r})
    for r in records:
        r.update(service_period(norm(r['description_original']),r['due_date'],r['total_cents'],r['transaction_type']))
        if r['date_parsing_status'].startswith('needs_review'):r['validation_flags'].append('service_period_needs_review')
    exact=collections.defaultdict(list)
    for r in records: exact[r['exact_row_signature']].append(r)
    duplicate_groups=[]
    for sig,rs in exact.items():
        if len(rs)>1:
            for r in rs: r['validation_flags'].append('identical_rows_review')
            duplicate_groups.append({'signature':sig,'source_rows':[r['source_row'] for r in rs],'sheet':rs[0]['source_sheet'],'count':len(rs),'amount_each_cents':rs[0]['total_cents'],'potential_excess_cents':(len(rs)-1)*rs[0]['total_cents'],'property':rs[0]['property_label'],'status':'candidate_only; all rows retained'})
    monthly=collections.defaultdict(lambda:{'paid_cents':0,'unpaid_cents':0,'total_cents':0,'row_count':0,'source_rows':[]})
    for r in records:
        key=(r['property_id'],r['property_label'],r['account_number'],r['gl_account'],r['due_month'],r['transaction_type']);m=monthly[key]
        for field in ['paid_cents','unpaid_cents','total_cents']:m[field]+=r[field]
        m['row_count']+=1;m['source_rows'].append({'sheet':r['source_sheet'],'row':r['source_row']})
    summaries=[dict(zip(['property_id','property_label','account_number','gl_account','due_month','transaction_type'],k),**v) for k,v in monthly.items()]
    reconciliation=[]
    for c in controls:
        relevant=[r for r in records if r['source_sheet']==c['sheet'] and (c['scope']=='grand_total' or r['gl_account']==c['scope'])]
        actual={f:sum(r[f] for r in relevant) for f in ['paid_cents','unpaid_cents']}
        reconciliation.append({**c,'row_paid_cents':actual['paid_cents'],'row_unpaid_cents':actual['unpaid_cents'],'difference_paid_cents':c['paid_cents']-actual['paid_cents'],'difference_unpaid_cents':c['unpaid_cents']-actual['unpaid_cents']})
    qa={'dataset_id':filehash,'transaction_count':len(records),'property_count':len({r['property_id'] for r in records}),'category_counts':dict(collections.Counter(r['category'] for r in records)),'classification_counts':dict(collections.Counter(r['transaction_type'] for r in records)),'totals_cents':{f:sum(r[f] for r in records) for f in ['paid_cents','unpaid_cents','total_cents']},'date_range':[min(r['due_date'] for r in records),max(r['due_date'] for r in records)],'duplicate_groups':duplicate_groups,'reconciliation':reconciliation,'rejected_rows':rejected,'excluded_rows':excluded,'metadata':metadata,'release_status':'needs_source_total_review' if rejected or any(c['difference_paid_cents'] or c['difference_unpaid_cents'] for c in reconciliation) else 'reconciled'}
    assert sum(r['total_cents'] for r in records)==sum(r['total_cents'] for r in summaries)
    assert all(r['paid_cents']+r['unpaid_cents']==r['total_cents'] for r in records)
    for name,obj in [('transactions',records),('monthly_account_category',summaries),('quality_report',qa),('raw_rows',raw)]: (out/(name+'.json')).write_text(json.dumps(obj,indent=2,ensure_ascii=False))
    print(json.dumps({k:qa[k] for k in ['transaction_count','property_count','category_counts','classification_counts','totals_cents','release_status']},indent=2))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('output');args=parser.parse_args();run(args.source,args.output)
