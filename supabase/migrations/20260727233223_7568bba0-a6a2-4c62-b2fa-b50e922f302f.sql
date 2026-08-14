-- ============ tables ============
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'NGN',
  created_at timestamptz not null default now()
);

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bank_name text not null,
  account_number text not null,
  created_at timestamptz not null default now()
);

create table public.accounting_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  doc_type text,
  doc_number text not null,
  party_name text,
  party_type text,
  amount numeric(18,2) not null default 0,
  balance numeric(18,2),
  doc_date date,
  side text not null default 'debit',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (company_id, doc_number)
);

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  txn_ref text not null,
  amount numeric(18,2) not null default 0,
  direction text not null default 'credit',
  txn_date date,
  value_date date,
  balance numeric(18,2),
  narration text,
  status text not null default 'unreconciled',
  category text,
  ai_confidence numeric(6,2),
  reconciled_record_id uuid references public.accounting_records(id) on delete set null,
  resolved_by_email text,
  resolved_at timestamptz,
  manually_reconciled boolean not null default false,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bank_account_id, txn_ref)
);

create table public.match_suggestions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bank_transaction_id uuid not null references public.bank_transactions(id) on delete cascade,
  accounting_record_id uuid references public.accounting_records(id) on delete set null,
  confidence numeric(6,2) not null default 0,
  amount_score numeric(6,2) not null default 0,
  reference_score numeric(6,2) not null default 0,
  date_score numeric(6,2) not null default 0,
  party_score numeric(6,2) not null default 0,
  side_score numeric(6,2) not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (bank_transaction_id)
);

-- ============ grants ============
grant select, insert, update, delete on public.companies to authenticated;
grant select, insert, update, delete on public.company_members to authenticated;
grant select, insert, update, delete on public.bank_accounts to authenticated;
grant select, insert, update, delete on public.accounting_records to authenticated;
grant select, insert, update, delete on public.bank_transactions to authenticated;
grant select, insert, update, delete on public.match_suggestions to authenticated;
grant all on public.companies, public.company_members, public.bank_accounts,
  public.accounting_records, public.bank_transactions, public.match_suggestions to service_role;

-- ============ membership helper ============
create or replace function public.is_company_member(_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = _company_id and m.user_id = auth.uid()
  )
$$;

-- ============ rls ============
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.accounting_records enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.match_suggestions enable row level security;

create policy "members read companies" on public.companies
  for select to authenticated using (public.is_company_member(id));

create policy "members read own memberships" on public.company_members
  for select to authenticated using (user_id = auth.uid() or public.is_company_member(company_id));

create policy "members manage bank accounts" on public.bank_accounts
  for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

create policy "members manage accounting records" on public.accounting_records
  for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

create policy "members manage bank transactions" on public.bank_transactions
  for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

create policy "members manage match suggestions" on public.match_suggestions
  for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- ============ realtime ============
alter table public.bank_transactions replica identity full;
alter table public.match_suggestions replica identity full;
alter publication supabase_realtime add table public.bank_transactions;
alter publication supabase_realtime add table public.match_suggestions;

-- ============ demo workspace ============
insert into public.companies (id, name, currency) values
  ('11111111-1111-1111-1111-111111111111', 'XYZ Trading Ltd', 'NGN');

insert into public.bank_accounts (id, company_id, bank_name, account_number) values
  ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111', 'Zenith Bank PLC', '1014785236'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'GTBank PLC', '0221547896');

insert into public.accounting_records (company_id, doc_type, doc_number, party_name, party_type, amount, balance, doc_date, side, meta) values
  ('11111111-1111-1111-1111-111111111111','Sales Invoice','SINV-2025-0041','Dangote Cement PLC','Customer',4250000.00,4250000.00,'2025-06-02','debit','{"Project":"Lagos Depot","Department":"Sales"}'),
  ('11111111-1111-1111-1111-111111111111','Sales Invoice','SINV-2025-0042','Flour Mills of Nigeria PLC','Customer',1875000.50,6125000.50,'2025-06-04','debit','{"Project":"Apapa","Department":"Sales"}'),
  ('11111111-1111-1111-1111-111111111111','Purchase Invoice','PINV-2025-0113','Sahara Energy Ltd','Supplier',920000.00,5205000.50,'2025-06-05','credit','{"Department":"Operations"}'),
  ('11111111-1111-1111-1111-111111111111','Payment Entry','PE-2025-0308','MTN Nigeria Communications PLC','Supplier',157500.00,5047500.50,'2025-06-06','credit','{"Channel":"Bank Transfer"}'),
  ('11111111-1111-1111-1111-111111111111','Sales Invoice','SINV-2025-0043','Nestle Nigeria PLC','Customer',3100000.00,8147500.50,'2025-06-09','debit','{"Project":"Ikeja"}'),
  ('11111111-1111-1111-1111-111111111111','Journal Entry','JE-2025-0077','Bank Charges','Internal',12500.00,8135000.50,'2025-06-10','credit','{"Remarks":"COT and VAT"}'),
  ('11111111-1111-1111-1111-111111111111','Purchase Invoice','PINV-2025-0114','Julius Berger Nigeria PLC','Supplier',2650000.00,5485000.50,'2025-05-14','credit','{"Department":"Projects"}'),
  ('11111111-1111-1111-1111-111111111111','Sales Invoice','SINV-2025-0044','Unilever Nigeria PLC','Customer',640000.00,6125000.50,'2025-06-12','debit','{}'),
  ('11111111-1111-1111-1111-111111111111','Payment Entry','PE-2025-0309','Ikeja Electric PLC','Supplier',385000.00,5740000.50,'2025-06-13','credit','{}'),
  ('11111111-1111-1111-1111-111111111111','Sales Invoice','SINV-2025-0045','Seplat Energy PLC','Customer',5400000.00,11140000.50,'2025-06-16','debit','{"Project":"Warri"}');

insert into public.bank_transactions (company_id, bank_account_id, txn_ref, amount, direction, txn_date, value_date, balance, narration, status) values
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','ZEN/2025/000181',4250000.00,'credit','2025-06-02','2025-06-02',14250000.00,'NIP INWARD DANGOTE CEMENT PLC SINV-2025-0041 PAYMENT','unreconciled'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','ZEN/2025/000182',1875000.50,'credit','2025-06-05','2025-06-05',16125000.50,'TRF FLOUR MILLS OF NIGERIA SINV 2025 0042','unreconciled'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','ZEN/2025/000183',920000.00,'debit','2025-06-05','2025-06-06',15205000.50,'OUTWARD TRANSFER SAHARA ENERGY LTD PINV-2025-0113','unreconciled'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','ZEN/2025/000184',157500.00,'debit','2025-06-07','2025-06-07',15047500.50,'MTN NIGERIA AIRTIME PURCHASE PE-2025-0308','unreconciled'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','ZEN/2025/000185',3100000.00,'credit','2025-06-09','2025-06-09',18147500.50,'NESTLE NIGERIA PLC PAYMENT SINV/2025/0043','unreconciled'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','ZEN/2025/000186',12500.00,'debit','2025-06-10','2025-06-10',18135000.50,'COT CHARGE AND VAT JUNE','unreconciled'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','ZEN/2025/000187',4250000.00,'credit','2025-06-11','2025-06-11',22385000.50,'DANGOTE CEMENT PLC SINV-2025-0041 REPEAT LODGEMENT','unreconciled'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','ZEN/2025/000188',2650000.00,'debit','2025-05-14','2025-05-14',19735000.50,'JULIUS BERGER RETENTION SETTLEMENT','unreconciled'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','ZEN/2025/000189',640000.00,'credit','2025-06-14','2025-06-14',20375000.50,'UNILEVER NIG PLC PART PAYMENT','unreconciled'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','ZEN/2025/000190',5400000.00,'credit','2025-06-16','2025-06-16',25775000.50,'SEPLAT ENERGY PLC SINV-2025-0045 SETTLEMENT','unreconciled'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','ZEN/2025/000191',78450.25,'debit','2025-06-17','2025-06-17',25696550.25,'POS TERMINAL RENTAL FEE UNKNOWN VENDOR','unreconciled'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222221','ZEN/2025/000192',385000.00,'debit','2025-06-18','2025-06-18',25311550.25,'IKEJA ELECTRIC PREPAID TOKEN PE 2025 0309','unreconciled'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','GTB/2025/004411',1250000.00,'credit','2025-06-08','2025-06-08',3250000.00,'INWARD TRANSFER MISC CUSTOMER DEPOSIT','unreconciled'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','GTB/2025/004412',95000.00,'debit','2025-06-12','2025-06-12',3155000.00,'BANK CHARGES AND STAMP DUTY','unreconciled');

-- every new signup joins the demo workspace
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.company_members (company_id, user_id, role)
  values ('11111111-1111-1111-1111-111111111111', new.id, 'member')
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();