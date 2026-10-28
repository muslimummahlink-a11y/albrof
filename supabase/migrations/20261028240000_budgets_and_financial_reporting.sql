ALTER TABLE public.financial_transactions
  ADD COLUMN project_id uuid REFERENCES public.projects (id) ON DELETE RESTRICT,
  ADD COLUMN cost_type text CHECK (cost_type IN ('direct', 'general')),
  ADD CONSTRAINT financial_transactions_project_cost_check
    CHECK (transaction_type <> 'expense' OR project_id IS NULL OR cost_type = 'direct');

CREATE INDEX financial_transactions_project_date_idx
  ON public.financial_transactions (project_id, transaction_date DESC)
  WHERE project_id IS NOT NULL;

ALTER TABLE public.expense_requests
  ADD COLUMN expected_payment_date date;

CREATE TABLE public.financial_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL CHECK (period_start = date_trunc('month', period_start)::date),
  category text NOT NULL CHECK (length(trim(category)) > 0),
  project_id uuid REFERENCES public.projects (id) ON DELETE RESTRICT,
  currency text NOT NULL CHECK (currency IN ('UGX', 'USD')),
  planned_amount numeric(16, 2) NOT NULL CHECK (planned_amount > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users (id),
  approved_at timestamptz,
  CHECK (
    (status = 'draft' AND approved_by IS NULL AND approved_at IS NULL)
    OR (status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX financial_budgets_period_category_project_unique
  ON public.financial_budgets (
    period_start,
    lower(category),
    currency,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX financial_budgets_period_idx
  ON public.financial_budgets (period_start DESC, status);

CREATE TABLE public.financial_budget_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES public.financial_budgets (id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE')),
  old_values jsonb,
  new_values jsonb NOT NULL,
  changed_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX financial_budget_audit_budget_changed_idx
  ON public.financial_budget_audit_log (budget_id, changed_at DESC);

CREATE FUNCTION public.validate_transaction_project()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.projects
    WHERE id = NEW.project_id
      AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Choose a valid, non-cancelled project for the transaction.';
  END IF;

  IF NEW.transaction_type = 'expense' AND NEW.project_id IS NULL
    AND NEW.cost_type IS DISTINCT FROM 'general'
  THEN
    RAISE EXCEPTION 'Classify expenses as direct project costs or general costs.';
  END IF;
  IF NEW.transaction_type = 'expense' AND NEW.project_id IS NOT NULL
    AND NEW.cost_type IS DISTINCT FROM 'direct'
  THEN
    RAISE EXCEPTION 'A project expense must be classified as a direct cost.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER financial_transactions_validate_project
  BEFORE INSERT ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.validate_transaction_project();

CREATE OR REPLACE FUNCTION public.record_invoice_payment_transaction()
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
    created_by,
    project_id
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
    NEW.created_by,
    invoice_row.project_id
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_expense_request(
  p_request_id uuid,
  p_account_id uuid,
  p_payment_date date,
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
  request_row public.expense_requests%ROWTYPE;
  account_currency text;
  supplier_name text;
  transaction_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Administrator access is required to pay an expense request.';
  END IF;

  SELECT * INTO request_row
  FROM public.expense_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF request_row.id IS NULL OR request_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved expense requests can be paid.';
  END IF;

  SELECT currency INTO account_currency
  FROM public.financial_accounts
  WHERE id = p_account_id;
  IF account_currency IS NULL OR account_currency <> request_row.currency THEN
    RAISE EXCEPTION 'Choose a financial account in the expense currency.';
  END IF;
  IF request_row.currency = 'UGX' AND (
    p_exchange_rate <> 1 OR p_exchange_rate_date <> p_payment_date
  ) THEN
    RAISE EXCEPTION 'UGX payments use rate 1 and the payment date.';
  END IF;

  SELECT name INTO supplier_name
  FROM public.business_parties
  WHERE id = request_row.supplier_id;

  INSERT INTO public.financial_transactions (
    account_id, transaction_date, transaction_type, direction, amount, currency,
    exchange_rate, exchange_rate_date, exchange_rate_source, category, counterparty,
    reference, description, reason, created_by, project_id, cost_type
  )
  VALUES (
    p_account_id, p_payment_date, 'expense', 'outflow', request_row.amount,
    request_row.currency, p_exchange_rate, p_exchange_rate_date,
    trim(p_exchange_rate_source), request_row.category, supplier_name,
    NULLIF(trim(p_reference), ''), request_row.description, trim(p_reason),
    auth.uid(), request_row.project_id, request_row.cost_type
  )
  RETURNING id INTO transaction_id;

  UPDATE public.expense_requests
  SET status = 'paid',
      paid_by = auth.uid(),
      paid_at = now(),
      payment_transaction_id = transaction_id
  WHERE id = p_request_id;

  RETURN transaction_id;
END;
$$;

CREATE FUNCTION public.approve_financial_budget(p_budget_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Administrator access is required to approve a budget.';
  END IF;

  UPDATE public.financial_budgets
  SET status = 'approved',
      approved_by = auth.uid(),
      approved_at = now()
  WHERE id = p_budget_id AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose a draft budget.';
  END IF;
END;
$$;

CREATE FUNCTION public.record_financial_budget_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.financial_budget_audit_log (
    budget_id, action, old_values, new_values, changed_by
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

CREATE TRIGGER financial_budgets_audit
  AFTER INSERT OR UPDATE ON public.financial_budgets
  FOR EACH ROW EXECUTE FUNCTION public.record_financial_budget_audit();

CREATE VIEW public.financial_budget_vs_actual
WITH (security_invoker = true)
AS
WITH actuals AS (
  SELECT
    date_trunc('month', transaction_date)::date AS period_start,
    category,
    project_id,
    currency,
    sum(amount)::numeric(18, 2) AS actual_amount
  FROM public.financial_transactions
  WHERE transaction_type = 'expense'
  GROUP BY date_trunc('month', transaction_date)::date, category, project_id, currency
)
SELECT
  budget.id,
  COALESCE(budget.period_start, actuals.period_start) AS period_start,
  COALESCE(budget.category, actuals.category) AS category,
  COALESCE(budget.project_id, actuals.project_id) AS project_id,
  COALESCE(budget.currency, actuals.currency) AS currency,
  budget.planned_amount,
  COALESCE(actuals.actual_amount, 0)::numeric(18, 2) AS actual_amount,
  (budget.planned_amount - COALESCE(actuals.actual_amount, 0))::numeric(18, 2) AS remaining_amount,
  budget.status,
  budget.notes
FROM public.financial_budgets AS budget
FULL OUTER JOIN actuals
  ON actuals.period_start = budget.period_start
  AND lower(actuals.category) = lower(budget.category)
  AND actuals.project_id IS NOT DISTINCT FROM budget.project_id
  AND actuals.currency = budget.currency;

CREATE VIEW public.financial_monthly_summary
WITH (security_invoker = true)
AS
SELECT
  date_trunc('month', transaction_date)::date AS period_start,
  currency,
  sum(amount) FILTER (WHERE transaction_type = 'income')::numeric(18, 2) AS income_amount,
  sum(amount) FILTER (WHERE transaction_type = 'expense')::numeric(18, 2) AS expense_amount,
  sum(amount_ugx) FILTER (WHERE transaction_type = 'income')::numeric(18, 2) AS income_ugx,
  sum(amount_ugx) FILTER (WHERE transaction_type = 'expense')::numeric(18, 2) AS expense_ugx,
  (
    COALESCE(sum(amount_ugx) FILTER (WHERE transaction_type = 'income'), 0)
    - COALESCE(sum(amount_ugx) FILTER (WHERE transaction_type = 'expense'), 0)
  )::numeric(18, 2) AS net_ugx
FROM public.financial_transactions
WHERE transaction_type IN ('income', 'expense')
GROUP BY date_trunc('month', transaction_date)::date, currency;

CREATE VIEW public.financial_project_profitability
WITH (security_invoker = true)
AS
SELECT
  project.id AS project_id,
  project.project_code,
  project.client_id,
  project.service,
  project.contract_value,
  project.contract_currency,
  project.status,
  COALESCE(
    sum(t.amount_ugx) FILTER (WHERE t.transaction_type = 'income'),
    0
  )::numeric(18, 2) AS collected_revenue_ugx,
  COALESCE(
    sum(t.amount_ugx) FILTER (WHERE t.transaction_type = 'expense'),
    0
  )::numeric(18, 2) AS direct_cost_ugx,
  (
    COALESCE(sum(t.amount_ugx) FILTER (WHERE t.transaction_type = 'income'), 0)
    - COALESCE(sum(t.amount_ugx) FILTER (WHERE t.transaction_type = 'expense'), 0)
  )::numeric(18, 2) AS collected_margin_ugx
FROM public.projects AS project
LEFT JOIN public.financial_transactions AS t
  ON t.project_id = project.id
  AND (
    t.transaction_type = 'income'
    OR (t.transaction_type = 'expense' AND t.cost_type = 'direct')
  )
GROUP BY project.id;

CREATE VIEW public.financial_upcoming_commitments
WITH (security_invoker = true)
AS
SELECT
  id,
  category,
  project_id,
  amount,
  currency,
  expected_payment_date,
  supplier_id,
  description,
  requested_by
FROM public.expense_requests
WHERE status = 'approved'
  AND expected_payment_date IS NOT NULL
  AND expected_payment_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90;

ALTER TABLE public.financial_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_budget_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Administrators view financial budgets"
  ON public.financial_budgets FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Administrators create financial budgets"
  ON public.financial_budgets FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND created_by = auth.uid()
    AND status = 'draft'
  );
CREATE POLICY "Administrators approve draft budgets"
  ON public.financial_budgets FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND status = 'draft'
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND status = 'approved'
    AND approved_by = auth.uid()
    AND approved_at IS NOT NULL
  );
CREATE POLICY "Administrators view financial budget audit"
  ON public.financial_budget_audit_log FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

GRANT SELECT, INSERT ON public.financial_budgets TO authenticated;
GRANT SELECT ON public.financial_budget_audit_log, public.financial_budget_vs_actual,
  public.financial_monthly_summary, public.financial_project_profitability,
  public.financial_upcoming_commitments TO authenticated;
REVOKE UPDATE, DELETE ON public.financial_budgets, public.financial_budget_audit_log
  FROM authenticated;
REVOKE ALL ON FUNCTION public.approve_financial_budget(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_financial_budget(uuid) TO authenticated;
