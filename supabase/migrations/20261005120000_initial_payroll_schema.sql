CREATE TYPE public.app_role AS ENUM ('admin', 'hr');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_no text NOT NULL UNIQUE,
  full_name text NOT NULL,
  position text NOT NULL,
  department text NOT NULL,
  phone text,
  bank_name text,
  account_no text,
  nssf_no text,
  base_salary numeric(14, 2) NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  allowances numeric(14, 2) NOT NULL DEFAULT 0 CHECK (allowances >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  hired_on date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'paid')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.payroll_runs (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  gross numeric(14, 2) NOT NULL CHECK (gross >= 0),
  paye numeric(14, 2) NOT NULL CHECK (paye >= 0),
  nssf_employee numeric(14, 2) NOT NULL CHECK (nssf_employee >= 0),
  nssf_employer numeric(14, 2) NOT NULL CHECK (nssf_employer >= 0),
  net numeric(14, 2) NOT NULL CHECK (net >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, employee_id)
);

CREATE INDEX payslips_employee_id_idx ON public.payslips (employee_id);
CREATE INDEX payslips_run_id_idx ON public.payslips (run_id);

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS roles
    WHERE roles.user_id = _user_id
      AND roles.role = _role
  );
$$;

CREATE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS roles
    WHERE roles.user_id = _user_id
      AND roles.role IN ('admin'::public.app_role, 'hr'::public.app_role)
  );
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own roles"
  ON public.user_roles FOR SELECT
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE POLICY "Staff manage employees"
  ON public.employees FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Staff manage payroll runs"
  ON public.payroll_runs FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Staff manage payslips"
  ON public.payslips FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.user_roles, public.employees, public.payroll_runs, public.payslips
  TO authenticated;
