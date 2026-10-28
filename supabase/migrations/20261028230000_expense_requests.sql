CREATE TABLE public.expense_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects (id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES public.business_parties (id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (length(trim(category)) > 0),
  cost_type text NOT NULL CHECK (cost_type IN ('direct', 'general')),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  amount numeric(16, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN ('UGX', 'USD')),
  receipt_reference text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  requested_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users (id),
  reviewed_at timestamptz,
  manager_note text,
  paid_by uuid REFERENCES auth.users (id),
  paid_at timestamptz,
  payment_transaction_id uuid UNIQUE
    REFERENCES public.financial_transactions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((cost_type = 'general') OR project_id IS NOT NULL),
  CHECK (
    (status IN ('pending', 'approved') AND paid_by IS NULL AND paid_at IS NULL AND payment_transaction_id IS NULL)
    OR (status = 'rejected' AND paid_by IS NULL AND paid_at IS NULL AND payment_transaction_id IS NULL)
    OR (status = 'paid' AND paid_by IS NOT NULL AND paid_at IS NOT NULL AND payment_transaction_id IS NOT NULL)
  ),
  CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected', 'paid') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX expense_requests_status_created_idx
  ON public.expense_requests (status, requested_at DESC);
CREATE INDEX expense_requests_project_status_idx
  ON public.expense_requests (project_id, status);
CREATE INDEX expense_requests_requester_idx
  ON public.expense_requests (requested_by, requested_at DESC);

CREATE TABLE public.expense_request_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_request_id uuid NOT NULL REFERENCES public.expense_requests (id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE')),
  old_values jsonb,
  new_values jsonb NOT NULL,
  changed_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX expense_request_audit_changed_idx
  ON public.expense_request_audit_log (expense_request_id, changed_at DESC);

CREATE FUNCTION public.validate_expense_request_parties()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.supplier_id IS NOT NULL AND NOT EXISTS (
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
  ) AND NEW.status = 'pending' THEN
    RAISE EXCEPTION 'Choose an open project for this expense request.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER expense_requests_validate
  BEFORE INSERT ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_expense_request_parties();

CREATE FUNCTION public.record_expense_request_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.expense_request_audit_log (
    expense_request_id, action, old_values, new_values, changed_by
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

CREATE TRIGGER expense_requests_audit
  AFTER INSERT OR UPDATE ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public.record_expense_request_audit();

CREATE FUNCTION public.review_expense_request(
  p_request_id uuid,
  p_decision text,
  p_manager_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_row public.expense_requests%ROWTYPE;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Authorised staff access is required to review expenses.';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Choose approve or reject.';
  END IF;
  IF p_decision = 'rejected' AND length(trim(COALESCE(p_manager_note, ''))) = 0 THEN
    RAISE EXCEPTION 'Add a reason when rejecting an expense request.';
  END IF;

  SELECT * INTO request_row
  FROM public.expense_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF request_row.id IS NULL OR request_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending expense requests can be reviewed.';
  END IF;
  IF request_row.requested_by = auth.uid() THEN
    RAISE EXCEPTION 'You cannot approve or reject your own expense request.';
  END IF;

  UPDATE public.expense_requests
  SET status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      manager_note = NULLIF(trim(COALESCE(p_manager_note, '')), '')
  WHERE id = p_request_id;
END;
$$;

CREATE FUNCTION public.settle_expense_request(
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
    p_account_id,
    p_payment_date,
    'expense',
    'outflow',
    request_row.amount,
    request_row.currency,
    p_exchange_rate,
    p_exchange_rate_date,
    trim(p_exchange_rate_source),
    request_row.category,
    supplier_name,
    NULLIF(trim(p_reference), ''),
    request_row.description,
    trim(p_reason),
    auth.uid()
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

ALTER TABLE public.expense_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_request_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff and requesters view expense requests"
  ON public.expense_requests FOR SELECT
  USING (public.is_staff(auth.uid()) OR requested_by = auth.uid());
CREATE POLICY "Employees submit expense requests"
  ON public.expense_requests FOR INSERT
  WITH CHECK (
    requested_by = auth.uid()
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND manager_note IS NULL
    AND paid_by IS NULL
    AND paid_at IS NULL
    AND payment_transaction_id IS NULL
    AND (
      public.is_staff(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.employees
        WHERE employees.auth_user_id = auth.uid()
          AND employees.status = 'active'
      )
    )
  );

CREATE POLICY "Staff and requesters view expense audit"
  ON public.expense_request_audit_log FOR SELECT
  USING (
    public.is_staff(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.expense_requests
      WHERE expense_requests.id = expense_request_id
        AND expense_requests.requested_by = auth.uid()
    )
  );

GRANT SELECT, INSERT ON public.expense_requests TO authenticated;
GRANT SELECT ON public.expense_request_audit_log TO authenticated;
REVOKE UPDATE, DELETE ON public.expense_requests, public.expense_request_audit_log
  FROM authenticated;
REVOKE ALL ON FUNCTION public.review_expense_request(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_expense_request(uuid, uuid, date, numeric, date, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_expense_request(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_expense_request(uuid, uuid, date, numeric, date, text, text, text)
  TO authenticated;
