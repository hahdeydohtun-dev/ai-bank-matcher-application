ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_bank_account_id_txn_ref_key;

DROP INDEX IF EXISTS public.bank_transactions_bank_account_id_txn_ref_key;