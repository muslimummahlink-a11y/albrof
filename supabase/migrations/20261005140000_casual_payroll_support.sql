ALTER TABLE public.employees
  ADD COLUMN employment_type text NOT NULL DEFAULT 'salaried'
    CHECK (employment_type IN ('salaried', 'casual')),
  ADD COLUMN daily_rate numeric(14, 2)
    CHECK (daily_rate IS NULL OR daily_rate >= 0);

ALTER TABLE public.payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_run_type_check;

ALTER TABLE public.payroll_runs
  ADD CONSTRAINT payroll_runs_run_type_check
    CHECK (run_type IN ('weekly', 'monthly', 'ad_hoc'));

ALTER TABLE public.payslips
  ADD COLUMN overtime_pay numeric(14, 2) NOT NULL DEFAULT 0 CHECK (overtime_pay >= 0),
  ADD COLUMN rate_used numeric(14, 2) CHECK (rate_used IS NULL OR rate_used >= 0);

CREATE TABLE public.casual_overtime_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  work_date date NOT NULL,
  method text NOT NULL CHECK (method IN ('direct_amount', 'hours_rate', 'special_day_bonus')),
  overtime_hours numeric(8, 2),
  hourly_rate numeric(14, 2),
  amount numeric(14, 2),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date, method),
  CHECK (
    (method = 'direct_amount' AND amount > 0 AND overtime_hours IS NULL AND hourly_rate IS NULL)
    OR (
      method = 'hours_rate'
      AND overtime_hours > 0
      AND hourly_rate > 0
      AND amount IS NULL
    )
    OR (
      method = 'special_day_bonus'
      AND amount > 0
      AND overtime_hours IS NULL
      AND hourly_rate IS NULL
    )
  )
);

CREATE INDEX casual_overtime_entries_work_date_idx
  ON public.casual_overtime_entries (work_date, employee_id);

ALTER TABLE public.casual_overtime_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage casual overtime"
  ON public.casual_overtime_entries FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()) AND created_by = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.casual_overtime_entries TO authenticated;

CREATE FUNCTION public.import_casual_payroll(
  p_rows jsonb,
  p_period_start date,
  p_period_end date,
  p_period text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  item jsonb;
  imported_employee_id uuid;
  imported_run_id uuid;
  employee_number text;
  employee_name text;
  employee_position text;
  employee_phone text;
  paid_days integer;
  employee_rate numeric(14, 2);
  payment_amount numeric(14, 2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only authorised payroll staff can import casual payroll.';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Provide casual payroll rows as an array.';
  END IF;
  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Provide at least one casual payroll row.';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'The payroll period dates are invalid.';
  END IF;
  IF p_period IS NULL OR length(trim(p_period)) = 0 THEN
    RAISE EXCEPTION 'Provide a payroll period label.';
  END IF;
  IF (
    SELECT count(DISTINCT trim(row_item ->> 'employee_no'))
    FROM jsonb_array_elements(p_rows) AS rows(row_item)
  ) <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'Employee numbers in the import must be unique.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payroll_runs
    WHERE run_type = 'ad_hoc'
      AND period = p_period
  ) THEN
    RAISE EXCEPTION 'A casual payroll run with this period label already exists.';
  END IF;

  INSERT INTO public.payroll_runs (period, run_type, period_start, period_end, status)
  VALUES (trim(p_period), 'ad_hoc', p_period_start, p_period_end, 'draft')
  RETURNING id INTO imported_run_id;

  FOR item IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    employee_number := trim(item ->> 'employee_no');
    employee_name := trim(item ->> 'full_name');
    employee_position := trim(item ->> 'position');
    employee_phone := nullif(trim(item ->> 'phone'), '');
    paid_days := (item ->> 'attendance_days')::integer;
    employee_rate := (item ->> 'daily_rate')::numeric;
    payment_amount := (item ->> 'amount')::numeric;

    IF employee_number = ''
      OR employee_name = ''
      OR employee_position = ''
      OR paid_days <= 0
      OR employee_rate <= 0
      OR payment_amount < 0
      OR payment_amount <> paid_days * employee_rate
    THEN
      RAISE EXCEPTION 'Invalid casual payroll data for employee number %.', employee_number;
    END IF;

    INSERT INTO public.employees (
      employee_no,
      full_name,
      position,
      department,
      phone,
      base_salary,
      allowances,
      status,
      employment_type,
      daily_rate
    )
    VALUES (
      employee_number,
      employee_name,
      employee_position,
      'Casual workers',
      employee_phone,
      0,
      0,
      'active',
      'casual',
      employee_rate
    )
    ON CONFLICT (employee_no) DO UPDATE
      SET full_name = EXCLUDED.full_name,
          position = EXCLUDED.position,
          department = EXCLUDED.department,
          phone = coalesce(EXCLUDED.phone, employees.phone),
          base_salary = 0,
          allowances = 0,
          status = 'active',
          employment_type = 'casual',
          daily_rate = EXCLUDED.daily_rate
    RETURNING id INTO imported_employee_id;

    INSERT INTO public.payslips (
      run_id,
      employee_id,
      basic_pay,
      allowances,
      attendance_days,
      overtime_hours,
      overtime_pay,
      rate_used,
      gross,
      paye,
      nssf_employee,
      nssf_employer,
      net
    )
    VALUES (
      imported_run_id,
      imported_employee_id,
      payment_amount,
      0,
      paid_days,
      0,
      0,
      employee_rate,
      payment_amount,
      0,
      0,
      0,
      payment_amount
    );
  END LOOP;

  RETURN imported_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.import_casual_payroll(jsonb, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_casual_payroll(jsonb, date, date, text) TO authenticated;
