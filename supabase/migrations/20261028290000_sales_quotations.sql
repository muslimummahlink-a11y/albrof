CREATE TABLE public.sales_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number text NOT NULL UNIQUE CHECK (length(trim(quotation_number)) > 0),
  client_id uuid NOT NULL REFERENCES public.business_parties (id) ON DELETE RESTRICT,
  project_id uuid REFERENCES public.projects (id) ON DELETE RESTRICT,
  issue_date date NOT NULL,
  valid_until date NOT NULL,
  currency text NOT NULL CHECK (currency IN ('UGX', 'USD')),
  tax_amount numeric(16, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'converted')),
  status_reason text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until >= issue_date)
);

CREATE INDEX sales_quotations_client_issue_idx
  ON public.sales_quotations (client_id, issue_date DESC);
CREATE INDEX sales_quotations_expiry_idx
  ON public.sales_quotations (valid_until) WHERE status IN ('sent', 'accepted');

CREATE TABLE public.quotation_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL
    REFERENCES public.sales_quotations (id) ON DELETE RESTRICT,
  description text NOT NULL CHECK (length(trim(description)) > 0),
  quantity numeric(12, 2) NOT NULL CHECK (quantity > 0),
  unit_price numeric(16, 2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(18, 2) GENERATED ALWAYS AS (round(quantity * unit_price, 2)) STORED
);
CREATE INDEX quotation_line_items_quotation_idx
  ON public.quotation_line_items (quotation_id);

ALTER TABLE public.invoices
  ADD COLUMN quotation_id uuid UNIQUE
  REFERENCES public.sales_quotations (id) ON DELETE RESTRICT;

CREATE TABLE public.quotation_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.sales_quotations (id) ON DELETE RESTRICT,
  table_name text NOT NULL CHECK (table_name IN ('sales_quotations', 'quotation_line_items')),
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE')),
  old_values jsonb,
  new_values jsonb NOT NULL,
  changed_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quotation_audit_log_record_changed_idx
  ON public.quotation_audit_log (quotation_id, changed_at DESC);

CREATE VIEW public.quotation_totals
WITH (security_invoker = true)
AS
WITH line_totals AS (
  SELECT quotation_id, COALESCE(sum(line_total), 0)::numeric(18, 2) AS subtotal
  FROM public.quotation_line_items
  GROUP BY quotation_id
)
SELECT
  quotation.id,
  quotation.quotation_number,
  quotation.client_id,
  quotation.project_id,
  quotation.issue_date,
  quotation.valid_until,
  quotation.currency,
  quotation.tax_amount,
  COALESCE(line_totals.subtotal, 0)::numeric(18, 2) AS subtotal,
  (COALESCE(line_totals.subtotal, 0) + quotation.tax_amount)::numeric(18, 2) AS total_amount,
  quotation.status,
  quotation.status_reason,
  quotation.notes,
  quotation.created_by,
  quotation.created_at,
  quotation.updated_at,
  invoice.id AS invoice_id,
  invoice.invoice_number AS converted_invoice_number
FROM public.sales_quotations AS quotation
LEFT JOIN line_totals ON line_totals.quotation_id = quotation.id
LEFT JOIN public.invoices AS invoice ON invoice.quotation_id = quotation.id;

CREATE FUNCTION public.validate_quotation_client_and_project()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_parties
    WHERE id = NEW.client_id AND party_type IN ('client', 'both')
  ) THEN
    RAISE EXCEPTION 'Choose a business contact registered as a client.';
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = NEW.project_id AND client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'The selected project must belong to the quotation client.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_quotations_validate_client_project
  BEFORE INSERT OR UPDATE OF client_id, project_id ON public.sales_quotations
  FOR EACH ROW EXECUTE FUNCTION public.validate_quotation_client_and_project();

CREATE FUNCTION public.validate_quotation_line_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  quotation_status text;
BEGIN
  SELECT status INTO quotation_status
  FROM public.sales_quotations
  WHERE id = COALESCE(NEW.quotation_id, OLD.quotation_id)
  FOR UPDATE;
  IF quotation_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Quotation line items can only be changed while the quotation is a draft.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quotation_line_items_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.quotation_line_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_quotation_line_item();

CREATE TRIGGER sales_quotations_touch_updated
  BEFORE UPDATE ON public.sales_quotations
  FOR EACH ROW EXECUTE FUNCTION public.touch_invoice_updated_at();

CREATE FUNCTION public.record_quotation_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent_quotation_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'sales_quotations' THEN
    parent_quotation_id := NEW.id;
  ELSE
    parent_quotation_id := NEW.quotation_id;
  END IF;
  INSERT INTO public.quotation_audit_log (
    quotation_id, table_name, record_id, action, old_values, new_values, changed_by
  )
  VALUES (
    parent_quotation_id, TG_TABLE_NAME, NEW.id, TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW), auth.uid()
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_quotations_audit
  AFTER INSERT OR UPDATE ON public.sales_quotations
  FOR EACH ROW EXECUTE FUNCTION public.record_quotation_audit();
CREATE TRIGGER quotation_line_items_audit
  AFTER INSERT ON public.quotation_line_items
  FOR EACH ROW EXECUTE FUNCTION public.record_quotation_audit();

CREATE FUNCTION public.create_sales_quotation(
  p_quotation_number text,
  p_client_id uuid,
  p_project_id uuid,
  p_issue_date date,
  p_valid_until date,
  p_currency text,
  p_tax_amount numeric,
  p_notes text,
  p_line_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  created_quotation_id uuid;
BEGIN
  IF NOT public.is_verified_finance_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Administrator or accountant access with MFA verification is required to create quotations.';
  END IF;
  IF length(trim(COALESCE(p_quotation_number, ''))) = 0
    OR p_valid_until < p_issue_date OR p_tax_amount < 0
    OR p_currency NOT IN ('UGX', 'USD')
  THEN
    RAISE EXCEPTION 'Check quotation number, dates, currency, and tax amount.';
  END IF;
  IF p_line_items IS NULL OR jsonb_typeof(p_line_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Quotation line items must be provided as a list.';
  END IF;
  IF jsonb_array_length(p_line_items) = 0 THEN
    RAISE EXCEPTION 'A quotation must contain at least one line item.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_line_items) AS item(description text, quantity numeric, unit_price numeric)
    WHERE length(trim(COALESCE(item.description, ''))) = 0
      OR item.quantity IS NULL OR item.quantity <= 0
      OR item.unit_price IS NULL OR item.unit_price < 0
  ) THEN
    RAISE EXCEPTION 'Each quotation line needs a description, positive quantity, and non-negative price.';
  END IF;

  INSERT INTO public.sales_quotations (
    quotation_number, client_id, project_id, issue_date, valid_until,
    currency, tax_amount, notes, created_by
  )
  VALUES (
    trim(p_quotation_number), p_client_id, p_project_id, p_issue_date, p_valid_until,
    p_currency, p_tax_amount, COALESCE(p_notes, ''), auth.uid()
  )
  RETURNING id INTO created_quotation_id;

  INSERT INTO public.quotation_line_items (quotation_id, description, quantity, unit_price)
  SELECT created_quotation_id, item.description, item.quantity, item.unit_price
  FROM jsonb_to_recordset(p_line_items) AS item(
    description text, quantity numeric, unit_price numeric
  );
  RETURN created_quotation_id;
END;
$$;

CREATE FUNCTION public.update_sales_quotation_status(
  p_quotation_id uuid,
  p_status text,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  quotation_row public.sales_quotations%ROWTYPE;
BEGIN
  IF NOT public.is_verified_finance_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Administrator or accountant access with MFA verification is required to update quotations.';
  END IF;
  SELECT * INTO quotation_row FROM public.sales_quotations
  WHERE id = p_quotation_id FOR UPDATE;
  IF quotation_row.id IS NULL OR length(trim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Choose a quotation and provide a status note.';
  END IF;
  IF (quotation_row.status = 'draft' AND p_status <> 'sent')
    OR (quotation_row.status = 'sent' AND p_status NOT IN ('accepted', 'rejected'))
    OR p_status NOT IN ('sent', 'accepted', 'rejected')
  THEN
    RAISE EXCEPTION 'Quotation status can only move from draft to sent, then to accepted or rejected.';
  END IF;
  IF quotation_row.valid_until < CURRENT_DATE AND p_status = 'accepted' THEN
    RAISE EXCEPTION 'An expired quotation cannot be marked accepted.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.quotation_line_items WHERE quotation_id = p_quotation_id
  ) THEN
    RAISE EXCEPTION 'A quotation needs at least one line item before it can be sent.';
  END IF;
  UPDATE public.sales_quotations
  SET status = p_status, status_reason = trim(p_reason)
  WHERE id = p_quotation_id;
END;
$$;

CREATE FUNCTION public.convert_sales_quotation_to_invoice(
  p_quotation_id uuid,
  p_invoice_number text,
  p_issue_date date,
  p_due_date date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  quotation_row public.sales_quotations%ROWTYPE;
  created_invoice_id uuid;
BEGIN
  IF NOT public.is_verified_finance_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Administrator or accountant access with MFA verification is required to convert quotations.';
  END IF;
  SELECT * INTO quotation_row FROM public.sales_quotations
  WHERE id = p_quotation_id FOR UPDATE;
  IF quotation_row.id IS NULL OR quotation_row.status <> 'accepted' THEN
    RAISE EXCEPTION 'Only an accepted quotation can be converted to an invoice.';
  END IF;
  IF quotation_row.valid_until < CURRENT_DATE THEN
    RAISE EXCEPTION 'This quotation has expired and cannot be converted.';
  END IF;
  IF length(trim(COALESCE(p_invoice_number, ''))) = 0 OR p_due_date < p_issue_date THEN
    RAISE EXCEPTION 'Enter an invoice number and valid invoice dates.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.quotation_line_items WHERE quotation_id = p_quotation_id
  ) THEN
    RAISE EXCEPTION 'The accepted quotation has no line items.';
  END IF;

  INSERT INTO public.invoices (
    invoice_number, client_id, project_id, quotation_id, issue_date,
    due_date, currency, tax_amount, notes, created_by
  )
  VALUES (
    trim(p_invoice_number), quotation_row.client_id, quotation_row.project_id,
    quotation_row.id, p_issue_date, p_due_date, quotation_row.currency,
    quotation_row.tax_amount, quotation_row.notes, auth.uid()
  )
  RETURNING id INTO created_invoice_id;

  INSERT INTO public.invoice_line_items (invoice_id, description, quantity, unit_price)
  SELECT created_invoice_id, description, quantity, unit_price
  FROM public.quotation_line_items WHERE quotation_id = p_quotation_id;

  UPDATE public.sales_quotations
  SET status = 'converted', status_reason = 'Converted to invoice ' || trim(p_invoice_number)
  WHERE id = p_quotation_id;
  RETURN created_invoice_id;
END;
$$;

ALTER TABLE public.sales_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Verified finance staff view quotations"
  ON public.sales_quotations FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Verified finance staff view quotation line items"
  ON public.quotation_line_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sales_quotations
      WHERE sales_quotations.id = quotation_id
        AND public.is_verified_finance_staff(auth.uid())
    )
  );
CREATE POLICY "Verified finance staff view quotation audit"
  ON public.quotation_audit_log FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));

GRANT SELECT ON public.sales_quotations, public.quotation_line_items,
  public.quotation_audit_log, public.quotation_totals TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sales_quotations,
  public.quotation_line_items, public.quotation_audit_log FROM authenticated;
REVOKE ALL ON FUNCTION public.create_sales_quotation(
  text, uuid, uuid, date, date, text, numeric, text, jsonb
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_sales_quotation_status(uuid, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.convert_sales_quotation_to_invoice(uuid, text, date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_quotation(
  text, uuid, uuid, date, date, text, numeric, text, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_sales_quotation_status(uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_sales_quotation_to_invoice(uuid, text, date, date)
  TO authenticated;
