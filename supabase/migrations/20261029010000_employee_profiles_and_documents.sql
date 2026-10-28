ALTER TABLE public.employees
  ADD COLUMN photo_path text,
  ADD COLUMN cv_path text,
  ADD COLUMN application_letter_path text,
  ADD COLUMN other_documents jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(other_documents) = 'array');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-documents',
  'employee-documents',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "HR staff manage employee documents"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'employee-documents'
    AND public.is_staff(auth.uid())
  )
  WITH CHECK (
    bucket_id = 'employee-documents'
    AND public.is_staff(auth.uid())
  );

CREATE POLICY "Employees view own profile photo"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'employee-documents'
    AND (storage.foldername(name))[2] = 'photo'
    AND EXISTS (
      SELECT 1
      FROM public.employees AS employee
      WHERE employee.id::text = (storage.foldername(name))[1]
        AND employee.auth_user_id = auth.uid()
    )
  );
