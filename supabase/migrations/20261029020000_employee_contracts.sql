CREATE TABLE public.employee_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE RESTRICT,
  contract_type text NOT NULL
    CHECK (contract_type IN ('fixed_term', 'permanent', 'probation', 'consultancy', 'other')),
  start_date date NOT NULL,
  end_date date,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'terminated')),
  document_path text,
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (contract_type = 'permanent' OR end_date IS NOT NULL)
);

CREATE INDEX employee_contracts_employee_id_idx
  ON public.employee_contracts (employee_id);
CREATE INDEX employee_contracts_active_end_date_idx
  ON public.employee_contracts (end_date)
  WHERE status = 'active';

CREATE TABLE public.contract_expiry_email_log (
  contract_id uuid NOT NULL REFERENCES public.employee_contracts (id) ON DELETE CASCADE,
  contract_end_date date NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, contract_end_date, recipient_user_id)
);

ALTER TABLE public.employee_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_expiry_email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HR staff manage employee contracts"
  ON public.employee_contracts FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "HR staff view contract email log"
  ON public.contract_expiry_email_log FOR SELECT
  USING (public.is_staff(auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.employee_contracts TO authenticated;
GRANT SELECT ON public.contract_expiry_email_log TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-contracts',
  'employee-contracts',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "HR staff manage employee contract files"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'employee-contracts'
    AND public.is_staff(auth.uid())
  )
  WITH CHECK (
    bucket_id = 'employee-contracts'
    AND public.is_staff(auth.uid())
  );

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'employee-contract-expiry-emails',
  '0 3 * * *',
  $job$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'contract_function_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-contract-job-secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'contract_job_secret')
      ),
      body := '{}'::jsonb
    );
  $job$
);
