ALTER TABLE public.data_sets ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS data_sets_idempotency_key_uidx
  ON public.data_sets (idempotency_key)
  WHERE idempotency_key IS NOT NULL;