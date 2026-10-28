CREATE TABLE public.business_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type text NOT NULL CHECK (party_type IN ('client', 'supplier', 'both')),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  contact_person text,
  email text,
  phone text,
  billing_address text,
  tax_identifier text,
  preferred_currency text CHECK (preferred_currency IN ('UGX', 'USD')),
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX business_parties_active_name_unique
  ON public.business_parties (lower(name))
  WHERE is_active;
CREATE INDEX business_parties_type_name_idx
  ON public.business_parties (party_type, name);

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code text NOT NULL UNIQUE CHECK (length(trim(project_code)) > 0),
  client_id uuid NOT NULL REFERENCES public.business_parties (id) ON DELETE RESTRICT,
  service text NOT NULL CHECK (length(trim(service)) > 0),
  scope_description text NOT NULL DEFAULT '',
  contract_value numeric(16, 2) CHECK (contract_value IS NULL OR contract_value >= 0),
  contract_currency text NOT NULL DEFAULT 'UGX' CHECK (contract_currency IN ('UGX', 'USD')),
  budget_amount numeric(16, 2) CHECK (budget_amount IS NULL OR budget_amount >= 0),
  budget_currency text NOT NULL DEFAULT 'UGX' CHECK (budget_currency IN ('UGX', 'USD')),
  starts_on date,
  due_on date,
  responsible_person text,
  status text NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_on IS NULL OR due_on IS NULL OR due_on >= starts_on)
);

CREATE INDEX projects_client_status_idx ON public.projects (client_id, status);
CREATE INDEX projects_due_date_idx ON public.projects (due_on) WHERE status IN ('planning', 'active');

CREATE TABLE public.business_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL CHECK (table_name IN ('business_parties', 'projects')),
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE')),
  old_values jsonb,
  new_values jsonb NOT NULL,
  changed_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX business_audit_log_record_changed_idx
  ON public.business_audit_log (table_name, record_id, changed_at DESC);

CREATE FUNCTION public.validate_project_client()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.business_parties
    WHERE id = NEW.client_id
      AND is_active
      AND party_type IN ('client', 'both')
  ) THEN
    RAISE EXCEPTION 'Choose an active client record for the project.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_validate_client
  BEFORE INSERT OR UPDATE OF client_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_client();

CREATE FUNCTION public.touch_business_record()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER business_parties_touch_updated
  BEFORE UPDATE ON public.business_parties
  FOR EACH ROW EXECUTE FUNCTION public.touch_business_record();

CREATE TRIGGER projects_touch_updated
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_business_record();

CREATE FUNCTION public.record_business_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.business_audit_log (
    table_name, record_id, action, old_values, new_values, changed_by
  )
  VALUES (
    TG_TABLE_NAME,
    NEW.id,
    TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    auth.uid()
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER business_parties_audit
  AFTER INSERT OR UPDATE ON public.business_parties
  FOR EACH ROW EXECUTE FUNCTION public.record_business_audit();

CREATE TRIGGER projects_audit
  AFTER INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.record_business_audit();

ALTER TABLE public.business_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view business parties"
  ON public.business_parties FOR SELECT
  USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff create business parties"
  ON public.business_parties FOR INSERT
  WITH CHECK (
    public.is_staff(auth.uid())
    AND created_by = auth.uid()
  );
CREATE POLICY "Staff update business parties"
  ON public.business_parties FOR UPDATE
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Staff view projects"
  ON public.projects FOR SELECT
  USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff create projects"
  ON public.projects FOR INSERT
  WITH CHECK (
    public.is_staff(auth.uid())
    AND created_by = auth.uid()
  );
CREATE POLICY "Staff update projects"
  ON public.projects FOR UPDATE
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Staff view business audit log"
  ON public.business_audit_log FOR SELECT
  USING (public.is_staff(auth.uid()));

GRANT SELECT, INSERT, UPDATE
  ON public.business_parties, public.projects TO authenticated;
GRANT SELECT ON public.business_audit_log TO authenticated;
REVOKE DELETE ON public.business_parties, public.projects FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.business_audit_log FROM authenticated;
