CREATE TABLE public.vendor_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number text NOT NULL CHECK (length(trim(bill_number)) > 0),
  supplier_id uuid NOT NULL REFERENCES public.business_parties (id) ON DELETE RESTRICT,
  project_id uuid REFERENCES public.projects (id) ON DELETE RESTRICT,
  cost_type text NOT NULL CHECK (cost_type IN ('direct', 'general')),
  category text NOT NULL CHECK (length(trim(category)) > 0),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  bill_date date NOT NULL,
  due_date date NOT NULL,
  currency text NOT NULL CHECK (currency IN ('UGX', 'USD')),
  amount numeric(16, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  notes text NOT NULL DEFAULT '',
  requested_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users (id),
  reviewed_at timestamptz,
  manager_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_date >= bill_date),
  CHECK ((cost_type = 'general' AND project_id IS NULL) OR
    (cost_type = 'direct' AND project_id IS NOT NULL)),
  CHECK (
    (status = 'draft' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  UNIQUE (supplier_id, bill_number)
);

CREATE INDEX vendor_bills_supplier_due_idx
  ON public.vendor_bills (supplier_id, due_date DESC);
CREATE INDEX vendor_bills_status_due_idx
  ON public.vendor_bills (status, due_date);

CREATE TABLE public.vendor_bill_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_bill_id uuid NOT NULL REFERENCES public.vendor_bills (id) ON DELETE RESTRICT,
  financial_transaction_id uuid NOT NULL UNIQUE
    REFERENCES public.financial_transactions (id) ON DELETE RESTRICT,
  payment_date date NOT NULL,
  amount numeric(16, 2) NOT NULL CHECK (amount > 0),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_bill_payments_bill_date_idx
  ON public.vendor_bill_payments (vendor_bill_id, payment_date DESC);

CREATE TABLE public.vendor_bill_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_bill_id uuid NOT NULL REFERENCES public.vendor_bills (id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE')),
  old_values jsonb,
  new_values jsonb NOT NULL,
  changed_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_bill_audit_changed_idx
  ON public.vendor_bill_audit_log (vendor_bill_id, changed_at DESC);

CREATE FUNCTION public.validate_vendor_bill()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_parties
    WHERE id = NEW.supplier_id
      AND is_active
      AND party_type IN ('supplier', 'both')
  ) THEN
    RAISE EXCEPTION 'Choose an active supplier.';
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = NEW.project_id
      AND status NOT IN ('completed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Choose an open project for a direct vendor cost.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER vendor_bills_validate
  BEFORE INSERT OR UPDATE OF supplier_id, project_id ON public.vendor_bills
  FOR EACH ROW EXECUTE FUNCTION public.validate_vendor_bill();

CREATE FUNCTION public.record_vendor_bill_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.vendor_bill_audit_log (
    vendor_bill_id, action, old_values, new_values, changed_by
  )
  VALUES (
    NEW.id,
    TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    auth.uid()
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER vendor_bills_audit
  AFTER INSERT OR UPDATE ON public.vendor_bills
  FOR EACH ROW EXECUTE FUNCTION public.record_vendor_bill_audit();

CREATE VIEW public.vendor_bill_balances
WITH (security_invoker = true)
AS
WITH payments AS (
  SELECT vendor_bill_id, sum(amount)::numeric(18, 2) AS amount_paid
  FROM public.vendor_bill_payments
  GROUP BY vendor_bill_id
)
SELECT
  bill.id,
  bill.bill_number,
  bill.supplier_id,
  bill.project_id,
  bill.cost_type,
  bill.category,
  bill.description,
  bill.bill_date,
  bill.due_date,
  bill.currency,
  bill.amount AS total_amount,
  COALESCE(payments.amount_paid, 0)::numeric(18, 2) AS amount_paid,
  (bill.amount - COALESCE(payments.amount_paid, 0))::numeric(18, 2) AS balance_due,
  bill.status,
  CASE
    WHEN bill.status = 'rejected' THEN 'rejected'
    WHEN bill.status = 'draft' THEN 'draft'
    WHEN bill.amount <= COALESCE(payments.amount_paid, 0) THEN 'paid'
    WHEN bill.due_date < CURRENT_DATE THEN 'overdue'
    WHEN COALESCE(payments.amount_paid, 0) > 0 THEN 'partially_paid'
    ELSE 'approved'
  END AS payment_status,
  bill.requested_by,
  bill.reviewed_by,
  bill.manager_note
FROM public.vendor_bills AS bill
LEFT JOIN payments ON payments.vendor_bill_id = bill.id;

CREATE FUNCTION public.create_vendor_bill(
  p_bill_number text,
  p_supplier_id uuid,
  p_project_id uuid,
  p_cost_type text,
  p_category text,
  p_description text,
  p_bill_date date,
  p_due_date date,
  p_currency text,
  p_amount numeric,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  bill_id uuid;
BEGIN
  IF NOT public.is_verified_finance_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Verified accountant access is required to record vendor bills.';
  END IF;
  IF p_due_date < p_bill_date OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Check vendor bill dates and amount.';
  END IF;
  IF p_currency NOT IN ('UGX', 'USD') OR p_cost_type NOT IN ('direct', 'general') THEN
    RAISE EXCEPTION 'Check the vendor bill currency and cost classification.';
  END IF;
  IF (p_cost_type = 'direct' AND p_project_id IS NULL)
    OR (p_cost_type = 'general' AND p_project_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'Direct bills require a project; general bills cannot be project-linked.';
  END IF;

  INSERT INTO public.vendor_bills (
    bill_number, supplier_id, project_id, cost_type, category, description,
    bill_date, due_date, currency, amount, notes, requested_by
  )
  VALUES (
    trim(p_bill_number), p_supplier_id, p_project_id, p_cost_type,
    trim(p_category), trim(p_description), p_bill_date, p_due_date,
    p_currency, p_amount, COALESCE(p_notes, ''), auth.uid()
  )
  RETURNING id INTO bill_id;
  RETURN bill_id;
END;
$$;

CREATE FUNCTION public.review_vendor_bill(
  p_bill_id uuid,
  p_decision text,
  p_manager_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  bill_row public.vendor_bills%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
    OR NOT public.has_finance_mfa()
  THEN
    RAISE EXCEPTION 'Manager access with MFA verification is required to approve vendor bills.';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Choose approve or reject.';
  END IF;
  IF p_decision = 'rejected' AND length(trim(COALESCE(p_manager_note, ''))) = 0 THEN
    RAISE EXCEPTION 'Add a reason when rejecting a vendor bill.';
  END IF;

  SELECT * INTO bill_row FROM public.vendor_bills WHERE id = p_bill_id FOR UPDATE;
  IF bill_row.id IS NULL OR bill_row.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft vendor bills can be reviewed.';
  END IF;
  IF bill_row.requested_by = auth.uid() THEN
    RAISE EXCEPTION 'The person who entered a vendor bill cannot approve it.';
  END IF;

  UPDATE public.vendor_bills
  SET status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      manager_note = NULLIF(trim(COALESCE(p_manager_note, '')), '')
  WHERE id = p_bill_id;
END;
$$;

CREATE FUNCTION public.record_vendor_bill_payment(
  p_bill_id uuid,
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
  bill_row public.vendor_bills%ROWTYPE;
  supplier_name text;
  account_currency text;
  amount_paid numeric(18, 2);
  transaction_id uuid;
BEGIN
  IF NOT public.is_verified_finance_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Verified finance staff access is required to pay a vendor bill.';
  END IF;

  SELECT * INTO bill_row FROM public.vendor_bills WHERE id = p_bill_id FOR UPDATE;
  IF bill_row.id IS NULL OR bill_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved vendor bills can be paid.';
  END IF;
  SELECT currency INTO account_currency
  FROM public.financial_accounts WHERE id = p_account_id;
  IF account_currency IS NULL OR account_currency <> bill_row.currency THEN
    RAISE EXCEPTION 'Choose a financial account in the vendor bill currency.';
  END IF;
  IF bill_row.currency = 'UGX' AND (
    p_exchange_rate <> 1 OR p_exchange_rate_date <> p_payment_date
  ) THEN
    RAISE EXCEPTION 'UGX payments use rate 1 and the payment date.';
  END IF;
  IF bill_row.currency = 'USD' AND (
    p_exchange_rate <= 0 OR length(trim(COALESCE(p_exchange_rate_source, ''))) = 0
  ) THEN
    RAISE EXCEPTION 'USD payments require a documented positive exchange rate.';
  END IF;

  SELECT COALESCE(sum(amount), 0)::numeric(18, 2) INTO amount_paid
  FROM public.vendor_bill_payments WHERE vendor_bill_id = p_bill_id;
  IF p_amount <= 0 OR amount_paid + p_amount > bill_row.amount THEN
    RAISE EXCEPTION 'Payment must be positive and cannot exceed the remaining vendor bill balance.';
  END IF;

  SELECT name INTO supplier_name FROM public.business_parties WHERE id = bill_row.supplier_id;
  INSERT INTO public.financial_transactions (
    account_id, transaction_date, transaction_type, direction, amount, currency,
    exchange_rate, exchange_rate_date, exchange_rate_source, category, counterparty,
    reference, description, reason, created_by, project_id, cost_type
  )
  VALUES (
    p_account_id, p_payment_date, 'expense', 'outflow', p_amount, bill_row.currency,
    p_exchange_rate, p_exchange_rate_date, trim(p_exchange_rate_source),
    bill_row.category, supplier_name, NULLIF(trim(p_reference), ''),
    'Payment for vendor bill ' || bill_row.bill_number, trim(p_reason),
    auth.uid(), bill_row.project_id, bill_row.cost_type
  )
  RETURNING id INTO transaction_id;

  INSERT INTO public.vendor_bill_payments (
    vendor_bill_id, financial_transaction_id, payment_date, amount, created_by
  )
  VALUES (p_bill_id, transaction_id, p_payment_date, p_amount, auth.uid());
  RETURN transaction_id;
END;
$$;

CREATE VIEW public.financial_receivables_aging
WITH (security_invoker = true)
AS
SELECT
  invoice.id,
  invoice.invoice_number,
  invoice.client_id,
  invoice.project_id,
  invoice.due_date,
  invoice.currency,
  invoice.balance_due AS amount_due,
  greatest(CURRENT_DATE - invoice.due_date, 0) AS days_past_due,
  CASE
    WHEN invoice.due_date >= CURRENT_DATE THEN 'current'
    WHEN CURRENT_DATE - invoice.due_date <= 30 THEN '1-30'
    WHEN CURRENT_DATE - invoice.due_date <= 60 THEN '31-60'
    WHEN CURRENT_DATE - invoice.due_date <= 90 THEN '61-90'
    ELSE 'over-90'
  END AS aging_bucket
FROM public.invoice_balances AS invoice
WHERE invoice.status = 'sent'
  AND invoice.balance_due > 0;

CREATE VIEW public.financial_payables_aging
WITH (security_invoker = true)
AS
SELECT
  bill.id,
  bill.bill_number,
  bill.supplier_id,
  bill.project_id,
  bill.due_date,
  bill.currency,
  bill.balance_due AS amount_due,
  greatest(CURRENT_DATE - bill.due_date, 0) AS days_past_due,
  CASE
    WHEN bill.due_date >= CURRENT_DATE THEN 'current'
    WHEN CURRENT_DATE - bill.due_date <= 30 THEN '1-30'
    WHEN CURRENT_DATE - bill.due_date <= 60 THEN '31-60'
    WHEN CURRENT_DATE - bill.due_date <= 90 THEN '61-90'
    ELSE 'over-90'
  END AS aging_bucket
FROM public.vendor_bill_balances AS bill
WHERE bill.status = 'approved'
  AND bill.balance_due > 0;

CREATE VIEW public.financial_cash_flow_forecast
WITH (security_invoker = true)
AS
SELECT
  'invoice'::text AS source_type,
  invoice.id AS source_id,
  invoice.due_date AS expected_date,
  'inflow'::text AS direction,
  invoice.invoice_number AS reference,
  invoice.currency,
  invoice.balance_due AS amount,
  invoice.project_id
FROM public.invoice_balances AS invoice
WHERE invoice.status = 'sent'
  AND invoice.balance_due > 0
  AND invoice.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
UNION ALL
SELECT
  'vendor_bill'::text,
  bill.id,
  bill.due_date,
  'outflow'::text,
  bill.bill_number,
  bill.currency,
  bill.balance_due,
  bill.project_id
FROM public.vendor_bill_balances AS bill
WHERE bill.status = 'approved'
  AND bill.balance_due > 0
  AND bill.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
UNION ALL
SELECT
  'expense_request'::text,
  request.id,
  request.expected_payment_date,
  'outflow'::text,
  request.category,
  request.currency,
  request.amount,
  request.project_id
FROM public.expense_requests AS request
WHERE request.status = 'approved'
  AND request.expected_payment_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90;

ALTER TABLE public.vendor_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_bill_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_bill_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance staff view vendor bills"
  ON public.vendor_bills FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Finance staff view vendor bill payments"
  ON public.vendor_bill_payments FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Finance staff view vendor bill audit"
  ON public.vendor_bill_audit_log FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));

GRANT SELECT ON public.vendor_bills, public.vendor_bill_payments,
  public.vendor_bill_audit_log, public.vendor_bill_balances,
  public.financial_receivables_aging, public.financial_payables_aging,
  public.financial_cash_flow_forecast TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.vendor_bills, public.vendor_bill_payments,
  public.vendor_bill_audit_log FROM authenticated;
REVOKE ALL ON FUNCTION public.create_vendor_bill(text, uuid, uuid, text, text, text, date, date, text, numeric, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_vendor_bill(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_vendor_bill_payment(uuid, uuid, date, numeric, numeric, date, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_vendor_bill(text, uuid, uuid, text, text, text, date, date, text, numeric, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_vendor_bill(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_vendor_bill_payment(uuid, uuid, date, numeric, numeric, date, text, text, text)
  TO authenticated;
