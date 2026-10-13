-- Derived source readings only. No assumptions about gallons or meter units.
with extracted as (
  select b.id,array_agg(m.parts[1]) as values
  from public.bill_versions b
  cross join lateral regexp_matches(b.description,'\yusage\s*[:=]?\s*(\d+(?:\.\d+)?)\y','gi') as m(parts)
  where b.usage_value is null group by b.id
)
update public.bill_versions b set usage_value=e.values[1]::numeric,usage_unit=null
from extracted e where b.id=e.id and array_length(e.values,1)=1;
