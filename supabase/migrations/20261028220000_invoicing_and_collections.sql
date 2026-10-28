CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE CHECK (length(trim(invoice_number)) > 0),
  client_id uuid NOT NULL REFERENCES public.business_parties (id) ON DELETE RESTRICT,
  project_id uuid REFERENCES public.projects (id) ON DELETE RESTRICT,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  currency text NOT NULL CHECK (currency IN ('UGX', 'USD')),
  tax_amount numeric(16, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'void')),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_date >= issue_date)
);

CREATE INDEX invoices_client_issue_idx ON public.invoices (client_id, issue_date DESC);
CREATE INDEX invoices_due_date_idx ON public.invoices (due_date) WHERE status = 'sent';

CREATE TABLE public.invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices (id) ON DELETE RESTRICT,
  description text NOT NULL CHECK (length(trim(description)) > 0),
  quantity numeric(12, 2) NOT NULL CHECK (quantity > 0),
  unit_price numeric(16, 2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(18, 2) GENERATED ALWAYS AS (round(quantity * unit_price, 2)) STORED
);

CREATE INDEX invoice_line_items_invoice_idx ON public.invoice_line_items (invoice_id);

CREATE TABLE public.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices (id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.financial_accounts (id) ON DELETE RESTRICT,
  payment_date date NOT NULL,
  amount numeric(16, 2) NOT NULL CHECK (amount > 0),
  exchange_rate numeric(18, 8) NOT NULL CHECK (exchange_rate > 0),
  exchange_rate_date date NOT NULL,
  exchange_rate_source text NOT NULL CHECK (length(trim(exchange_rate_source)) > 0),
  reference text,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invoice_payments_invoice_date_idx
  ON public.invoice_payments (invoice_id, payment_date DESC);

CREATE TABLE public.invoice_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL CHECK (table_name IN ('invoices', 'invoice_line_items', 'invoice_payments')),
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE')),
  old_values jsonb,
  new_values jsonb NOT NULL,
  changed_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invoice_audit_log_record_changed_idx
  ON public.invoice_audit_log (table_name, record_id, changed_at DESC);

CREATE VIEW public.invoice_balances
WITH (security_invoker = true)
AS
WITH line_totals AS (
  SELECT invoice_id, COALESCE(sum(line_total), 0)::numeric(18, 2) AS subtotal
  FROM public.invoice_line_items
  GROUP BY invoice_id
),
payment_totals AS (
  SELECT invoice_id, COALESCE(sum(amount), 0)::numeric(18, 2) AS amount_paid
  FROM public.invoice_payments
  GROUP BY invoice_id
)
SELECT
  invoice.id,
  invoice.invoice_number,
  invoice.client_id,
  invoice.project_id,
  invoice.issue_date,
  invoice.due_date,
  invoice.currency,
  invoice.status,
  invoice.tax_amount,
  COALESCE(line_totals.subtotal, 0)::numeric(18, 2) AS subtotal,
  (COALESCE(line_totals.subtotal, 0) + invoice.tax_amount)::numeric(18, 2) AS total_amount,
  COALESCE(payment_totals.amount_paid, 0)::numeric(18, 2) AS amount_paid,
  (COALESCE(line_totals.subtotal, 0) + invoice.tax_amount - COALESCE(payment_totals.amount_paid, 0))
    ::numeric(18, 2) AS balance_due,
  CASE
    WHEN invoice.status = 'void' THEN 'void'
    WHEN invoice.status = 'draft' THEN 'draft'
    WHEN COALESCE(payment_totals.amount_paid, 0) >= COALESCE(line_totals.subtotal, 0) + invoice.tax_amount
      THEN 'paid'
    WHEN COALESCE(payment_totals.amount_paid, 0) > 0 THEN 'partially_paid'
    WHEN invoice.due_date < CURRENT_DATE THEN 'overdue'
    ELSE 'sent'
  END AS payment_status,
  invoice.notes,
  invoice.created_by,
  invoice.created_at,
  invoice.updated_at
FROM public.invoices AS invoice
LEFT JOIN line_totals ON line_totals.invoice_id = invoice.id
LEFT JOIN payment_totals ON payment_totals.invoice_id = invoice.id;

CREATE FUNCTION public.validate_invoice_client_and_project()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.business_parties
    WHERE id = NEW.client_id
      AND party_type IN ('client', 'both')
  ) THEN
    RAISE EXCEPTION 'Choose a business contact registered as a client.';
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.projects
    WHERE id = NEW.project_id
      AND client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'The selected project must belong to the invoice client.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_validate_client_project
  BEFORE INSERT OR UPDATE OF client_id, project_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.validate_invoice_client_and_project();

CREATE FUNCTION public.validate_invoice_line_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  invoice_status text;
BEGIN
  SELECT status INTO invoice_status
  FROM public.invoices
  WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id)
  FOR UPDATE;

  IF invoice_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Invoice line items can only be changed while the invoice is a draft.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_line_items_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_invoice_line_item();

CREATE FUNCTION public.touch_invoice_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_touch_updated
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_invoice_updated_at();

CREATE FUNCTION public.record_invoice_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.invoice_audit_log (
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

CREATE TRIGGER invoices_audit
  AFTER INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.record_invoice_audit();

CREATE TRIGGER invoice_line_items_audit
  AFTER INSERT ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.record_invoice_audit();

CREATE TRIGGER invoice_payments_audit
  AFTER INSERT ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.record_invoice_audit();

CREATE FUNCTION public.record_invoice_payment_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  invoice_row public.invoices%ROWTYPE;
  client_name text;
  account_currency text;
BEGIN
  SELECT * INTO invoice_row FROM public.invoices WHERE id = NEW.invoice_id;
  SELECT currency INTO account_currency
  FROM public.financial_accounts
  WHERE id = NEW.account_id;
  SELECT name INTO client_name
  FROM public.business_parties
  WHERE id = invoice_row.client_id;

  INSERT INTO public.financial_transactions (
    account_id,
    transaction_date,
    transaction_type,
    direction,
    amount,
    currency,
    exchange_rate,
    exchange_rate_date,
    exchange_rate_source,
    category,
    counterparty,
    reference,
    description,
    reason,
    created_by
  )
  VALUES (
    NEW.account_id,
    NEW.payment_date,
    'income',
    'inflow',
    NEW.amount,
    account_currency,
    NEW.exchange_rate,
    NEW.exchange_rate_date,
    NEW.exchange_rate_source,
    'Invoice collection',
    client_name,
    NEW.reference,
    'Payment received for invoice ' || invoice_row.invoice_number,
    NEW.reason,
    NEW.created_by
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_payments_create_financial_transaction
  AFTER INSERT ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.record_invoice_payment_transaction();

CREATE FUNCTION public.create_sales_invoice(
  p_invoice_number text,
  p_client_id uuid,
  p_project_id uuid,
  p_issue_date date,
  p_due_date date,
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
  created_invoice_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Administrator access is required to create invoices.';
  END IF;
  IF p_due_date < p_issue_date OR p_tax_amount < 0 THEN
    RAISE EXCEPTION 'Check invoice dates and tax amount.';
  END IF;
  IF p_line_items IS NULL THEN
    RAISE EXCEPTION 'An invoice must contain at least one line item.';
  END IF;
  IF jsonb_typeof(p_line_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invoice line items must be provided as a list.';
  END IF;
  IF jsonb_array_length(p_line_items) = 0 THEN
    RAISE EXCEPTION 'An invoice must contain at least one line item.';
  END IF;

  INSERT INTO public.invoices (
    invoice_number, client_id, project_id, issue_date, due_date, currency,
    tax_amount, notes, created_by
  )
  VALUES (
    trim(p_invoice_number), p_client_id, p_project_id, p_issue_date, p_due_date,
    p_currency, p_tax_amount, COALESCE(p_notes, ''), auth.uid()
  )
  RETURNING id INTO created_invoice_id;

  INSERT INTO public.invoice_line_items (invoice_id, description, quantity, unit_price)
  SELECT
    created_invoice_id,
    item.description,
    item.quantity,
    item.unit_price
  FROM jsonb_to_recordset(p_line_items) AS item(
    description text,
    quantity numeric,
    unit_price numeric
  );

  RETURN created_invoice_id;
END;
$$;

CREATE FUNCTION public.mark_sales_invoice_sent(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Administrator access is required to issue invoices.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoice_line_items WHERE invoice_id = p_invoice_id
  ) THEN
    RAISE EXCEPTION 'An invoice needs at least one line item before it can be issued.';
  END IF;

  UPDATE public.invoices
  SET status = 'sent'
  WHERE id = p_invoice_id AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose a draft invoice.';
  END IF;
END;
$$;

CREATE FUNCTION public.add_sales_invoice_payment(
  p_invoice_id uuid,
  p_account_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_exchange_rate numeric,
  p_exchange_rate_date date,
  p_exchange_rate_source text,
  p_reference text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  invoice_row public.invoices%ROWTYPE;
  account_currency text;
  invoice_total numeric(18, 2);
  amount_paid numeric(18, 2);
  payment_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Administrator access is required to record invoice payments.';
  END IF;

  SELECT * INTO invoice_row
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF invoice_row.id IS NULL OR invoice_row.status <> 'sent' THEN
    RAISE EXCEPTION 'Payments can only be recorded against issued invoices.';
  END IF;

  SELECT currency INTO account_currency
  FROM public.financial_accounts
  WHERE id = p_account_id;
  IF account_currency IS NULL OR account_currency <> invoice_row.currency THEN
    RAISE EXCEPTION 'Choose a financial account in the invoice currency.';
  END IF;

  SELECT (COALESCE(sum(line_total), 0) + invoice_row.tax_amount)::numeric(18, 2)
    INTO invoice_total
  FROM public.invoice_line_items
  WHERE invoice_id = p_invoice_id;
  SELECT COALESCE(sum(amount), 0)::numeric(18, 2)
    INTO amount_paid
  FROM public.invoice_payments
  WHERE invoice_id = p_invoice_id;

  IF p_amount <= 0 OR amount_paid + p_amount > invoice_total THEN
    RAISE EXCEPTION 'Payment must be positive and cannot exceed the remaining invoice balance.';
  END IF;
  IF invoice_row.currency = 'UGX' AND (
    p_exchange_rate <> 1 OR p_exchange_rate_date <> p_payment_date
  ) THEN
    RAISE EXCEPTION 'UGX payments use rate 1 and the payment date.';
  END IF;

  INSERT INTO public.invoice_payments (
    invoice_id, account_id, payment_date, amount, exchange_rate,
    exchange_rate_date, exchange_rate_source, reference, reason, created_by
  )
  VALUES (
    p_invoice_id, p_account_id, p_payment_date, p_amount, p_exchange_rate,
    p_exchange_rate_date, trim(p_exchange_rate_source), NULLIF(trim(p_reference), ''),
    trim(p_reason), auth.uid()
  )
  RETURNING id INTO payment_id;

  RETURN payment_id;
END;
$$;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Administrators view invoices"
  ON public.invoices FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Administrators update invoices"
  ON public.invoices FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Administrators view invoice line items"
  ON public.invoice_line_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices
      WHERE invoices.id = invoice_id
        AND public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );

CREATE POLICY "Administrators view invoice payments"
  ON public.invoice_payments FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Administrators view invoice audit log"
  ON public.invoice_audit_log FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

GRANT SELECT ON public.invoices, public.invoice_line_items, public.invoice_payments,
  public.invoice_audit_log, public.invoice_balances TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.invoices, public.invoice_line_items,
  public.invoice_payments, public.invoice_audit_log FROM authenticated;
REVOKE ALL ON FUNCTION public.create_sales_invoice(text, uuid, uuid, date, date, text, numeric, text, jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_sales_invoice_sent(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_sales_invoice_payment(uuid, uuid, date, numeric, numeric, date, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_invoice(text, uuid, uuid, date, date, text, numeric, text, jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_sales_invoice_sent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_sales_invoice_payment(uuid, uuid, date, numeric, numeric, date, text, text, text)
  TO authenticated;
