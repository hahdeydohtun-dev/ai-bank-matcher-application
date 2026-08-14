DELETE FROM public.import_batches ib
WHERE ib.source = 'bank'
  AND ib.label = 'Globus Statement_1000046799 1.csv'
  AND NOT EXISTS (
    SELECT 1
    FROM public.bank_transactions bt
    WHERE bt.import_batch_id = ib.id
  );

DELETE FROM public.data_sets ds
WHERE ds.source = 'bank'
  AND ds.label = 'Globus Statement_1000046799 1.csv'
  AND NOT EXISTS (
    SELECT 1
    FROM public.bank_transactions bt
    WHERE bt.data_set_id = ds.id
  );