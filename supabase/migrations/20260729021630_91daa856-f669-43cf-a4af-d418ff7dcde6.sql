UPDATE public.import_batches ib
SET bank_account_id = scoped.bank_account_id
FROM (
  SELECT import_batch_id, (ARRAY_AGG(bank_account_id))[1] AS bank_account_id
  FROM public.accounting_records
  WHERE import_batch_id IS NOT NULL
    AND bank_account_id IS NOT NULL
  GROUP BY import_batch_id
  HAVING COUNT(DISTINCT bank_account_id) = 1
) scoped
WHERE ib.id = scoped.import_batch_id
  AND ib.source = 'ledger'
  AND ib.bank_account_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'accounting_records_company_id_doc_number_key'
      AND conrelid = 'public.accounting_records'::regclass
  ) THEN
    ALTER TABLE public.accounting_records
      DROP CONSTRAINT accounting_records_company_id_doc_number_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS accounting_records_company_bank_account_doc_number_key
  ON public.accounting_records (company_id, bank_account_id, doc_number);