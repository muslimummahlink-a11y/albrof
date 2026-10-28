ALTER TABLE public.employees
  ADD COLUMN auth_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX employees_auth_user_id_unique
  ON public.employees (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

ALTER TABLE public.payroll_runs
  ADD COLUMN run_type text NOT NULL DEFAULT 'monthly'
    CHECK (run_type IN ('weekly', 'monthly')),
  ADD COLUMN period_start date,
  ADD COLUMN period_end date,
  ADD CONSTRAINT payroll_runs_period_range_check
    CHECK (
      (period_start IS NULL AND period_end IS NULL)
      OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_end >= period_start)
    );

UPDATE public.payroll_runs
SET period_start = to_date(period || '-01', 'YYYY-MM-DD'),
    period_end = (date_trunc('month', to_date(period || '-01', 'YYYY-MM-DD'))
      + interval '1 month - 1 day')::date
WHERE period ~ '^\d{4}-\d{2}$';

CREATE UNIQUE INDEX payroll_runs_week_range_unique
  ON public.payroll_runs (period_start, period_end)
  WHERE run_type = 'weekly' AND period_start IS NOT NULL;

ALTER TABLE public.payslips
  ADD COLUMN basic_pay numeric(14, 2) CHECK (basic_pay IS NULL OR basic_pay >= 0),
  ADD COLUMN allowances numeric(14, 2) CHECK (allowances IS NULL OR allowances >= 0),
  ADD COLUMN attendance_days integer NOT NULL DEFAULT 0 CHECK (attendance_days >= 0),
  ADD COLUMN attendance_hours numeric(8, 2) NOT NULL DEFAULT 0 CHECK (attendance_hours >= 0),
  ADD COLUMN overtime_hours numeric(8, 2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0);

CREATE TABLE public.attendance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  event_type text NOT NULL DEFAULT 'punch',
  device_serial text NOT NULL DEFAULT '',
  source_file text,
  raw_event jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, occurred_at, event_type, device_serial)
);

CREATE INDEX attendance_logs_employee_occurred_at_idx
  ON public.attendance_logs (employee_id, occurred_at);

CREATE TABLE public.employee_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('leave', 'overtime')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  hours numeric(8, 2),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  manager_note text,
  requested_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  reviewed_by uuid REFERENCES auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (
    (request_type = 'leave' AND hours IS NULL)
    OR (request_type = 'overtime' AND hours > 0)
  ),
  CHECK (request_type <> 'overtime' OR start_date = end_date)
);

CREATE INDEX employee_requests_employee_created_at_idx
  ON public.employee_requests (employee_id, created_at DESC);

CREATE TABLE public.employee_id_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL UNIQUE REFERENCES public.employees (id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id)
);

CREATE TABLE public.payroll_compilations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL UNIQUE CHECK (period ~ '^\d{4}-\d{2}$'),
  status text NOT NULL DEFAULT 'compiled' CHECK (status = 'compiled'),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payroll_compilation_runs (
  compilation_id uuid NOT NULL REFERENCES public.payroll_compilations (id) ON DELETE CASCADE,
  run_id uuid NOT NULL UNIQUE REFERENCES public.payroll_runs (id) ON DELETE RESTRICT,
  PRIMARY KEY (compilation_id, run_id)
);

ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_id_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_compilations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_compilation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage attendance logs"
  ON public.attendance_logs FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()) AND imported_by = auth.uid());

CREATE POLICY "Employees view linked staff record"
  ON public.employees FOR SELECT
  USING (auth_user_id = auth.uid());

CREATE POLICY "Employees view own payslips"
  ON public.payslips FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.employees
      WHERE employees.id = payslips.employee_id
        AND employees.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Employees view own payroll run"
  ON public.payroll_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.payslips
      JOIN public.employees ON employees.id = payslips.employee_id
      WHERE payslips.run_id = payroll_runs.id
        AND employees.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Staff manage employee requests"
  ON public.employee_requests FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Employees view own requests"
  ON public.employee_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.employees
      WHERE employees.id = employee_requests.employee_id
        AND employees.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Employees submit own requests"
  ON public.employee_requests FOR INSERT
  WITH CHECK (
    status = 'pending'
    AND reviewed_by IS NULL
    AND requested_by = auth.uid()
    AND manager_note IS NULL
    AND EXISTS (
      SELECT 1 FROM public.employees
      WHERE employees.id = employee_requests.employee_id
        AND employees.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Staff manage employee ID cards"
  ON public.employee_id_cards FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()) AND issued_by = auth.uid());

CREATE POLICY "Staff manage payroll compilations"
  ON public.payroll_compilations FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Staff manage compilation runs"
  ON public.payroll_compilation_runs FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));
