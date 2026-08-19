create or replace function public.apply_match_results(_rows jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  update public.bank_transactions t
  set category = r.category,
      ai_confidence = r.confidence
  from jsonb_to_recordset(_rows) as r(id uuid, category text, confidence numeric)
  where t.id = r.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.apply_match_results(jsonb) to authenticated;

create or replace function public.bulk_resolve_matches(
  _rows jsonb,
  _accept boolean,
  _email text default null,
  _reason text default null
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  update public.bank_transactions t
  set status = case when _accept then 'reconciled' else 'rejected' end,
      reconciled_record_id = case when _accept then r.record_id else null end,
      resolved_by_email = _email,
      resolved_at = now(),
      rejection_reason = case when _accept then null else nullif(btrim(coalesce(_reason, '')), '') end
  from jsonb_to_recordset(_rows) as r(txn_id uuid, record_id uuid)
  where t.id = r.txn_id;
  get diagnostics n = row_count;

  if _accept then
    update public.accounting_records a
    set status = 'reconciled',
        reconciled_txn_id = r.txn_id,
        resolved_by_email = _email,
        resolved_at = now()
    from jsonb_to_recordset(_rows) as r(txn_id uuid, record_id uuid)
    where a.id = r.record_id;
  end if;

  update public.match_suggestions s
  set status = case when _accept then 'accepted' else 'rejected' end,
      rejection_reason = case when _accept then null else nullif(btrim(coalesce(_reason, '')), '') end
  from jsonb_to_recordset(_rows) as r(txn_id uuid, record_id uuid)
  where s.bank_transaction_id = r.txn_id;

  return n;
end;
$$;

grant execute on function public.bulk_resolve_matches(jsonb, boolean, text, text) to authenticated;