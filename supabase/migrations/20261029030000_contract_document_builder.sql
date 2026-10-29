ALTER TABLE public.employee_contracts
  ADD COLUMN contract_terms jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(contract_terms) = 'object'),
  ADD COLUMN signed_document_path text,
  ADD COLUMN is_primary boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX employee_contracts_one_primary_per_employee_idx
  ON public.employee_contracts (employee_id)
  WHERE is_primary;

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png'
]
WHERE id = 'employee-contracts';
