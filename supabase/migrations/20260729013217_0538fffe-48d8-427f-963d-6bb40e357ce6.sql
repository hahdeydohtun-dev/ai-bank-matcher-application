ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.match_suggestions ADD COLUMN IF NOT EXISTS rejection_reason text;