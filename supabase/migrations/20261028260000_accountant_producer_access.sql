CREATE FUNCTION public.is_finance_staff(_user_id uuid)
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
      AND roles.role IN (
        'admin'::public.app_role,
        'accountant'::public.app_role
      )
  );
$$;

CREATE FUNCTION public.has_finance_mfa()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(auth.jwt() ->> 'aal' = 'aal2', false);
$$;

CREATE FUNCTION public.is_verified_finance_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_finance_staff(_user_id) AND public.has_finance_mfa();
$$;

CREATE FUNCTION public.admin_list_user_access()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  roles public.app_role[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
    OR NOT public.has_finance_mfa()
  THEN
    RAISE EXCEPTION 'Administrator access with MFA verification is required to manage user access.';
  END IF;

  RETURN QUERY
  SELECT
    auth_user.id,
    auth_user.email::text,
    COALESCE(employee.full_name, '')::text,
    COALESCE(
      array_agg(user_role.role ORDER BY user_role.role)
        FILTER (WHERE user_role.role IS NOT NULL),
      ARRAY[]::public.app_role[]
    )
  FROM auth.users AS auth_user
  LEFT JOIN public.employees AS employee
    ON employee.auth_user_id = auth_user.id
  LEFT JOIN public.user_roles AS user_role
    ON user_role.user_id = auth_user.id
  WHERE auth_user.deleted_at IS NULL
  GROUP BY auth_user.id, auth_user.email, employee.full_name
  ORDER BY employee.full_name NULLS LAST, auth_user.email;
END;
$$;

CREATE FUNCTION public.admin_set_user_role(
  p_user_id uuid,
  p_role public.app_role,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
    OR NOT public.has_finance_mfa()
  THEN
    RAISE EXCEPTION 'Administrator access with MFA verification is required to manage user access.';
  END IF;
  IF p_role NOT IN (
    'hr'::public.app_role,
    'accountant'::public.app_role,
    'producer'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Only HR, accountant, and producer access can be managed here.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Choose an existing active user.';
  END IF;

  IF p_enabled THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, p_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = p_user_id
      AND role = p_role;

    IF p_role = 'producer'::public.app_role THEN
      UPDATE public.project_assignments
      SET is_active = false
      WHERE user_id = p_user_id AND is_active;
    END IF;
  END IF;
END;
$$;

CREATE TABLE public.user_role_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  role public.app_role NOT NULL,
  action text NOT NULL CHECK (action IN ('GRANT', 'REVOKE')),
  changed_by uuid DEFAULT auth.uid() REFERENCES auth.users (id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_role_audit_user_changed_idx
  ON public.user_role_audit_log (user_id, changed_at DESC);

CREATE FUNCTION public.record_user_role_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.user_role_audit_log (user_id, role, action, changed_by)
    VALUES (OLD.user_id, OLD.role, 'REVOKE', auth.uid());
    RETURN OLD;
  END IF;

  INSERT INTO public.user_role_audit_log (user_id, role, action, changed_by)
  VALUES (NEW.user_id, NEW.role, 'GRANT', auth.uid());
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_roles_audit
  AFTER INSERT OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.record_user_role_audit();

CREATE TABLE public.project_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (project_id, user_id)
);

CREATE INDEX project_assignments_user_active_idx
  ON public.project_assignments (user_id, project_id)
  WHERE is_active;

CREATE TABLE public.project_assignment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.project_assignments (id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE')),
  old_values jsonb,
  new_values jsonb NOT NULL,
  changed_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_assignment_audit_changed_idx
  ON public.project_assignment_audit_log (assignment_id, changed_at DESC);

CREATE FUNCTION public.validate_project_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_active AND NOT public.has_role(NEW.user_id, 'producer'::public.app_role) THEN
    RAISE EXCEPTION 'Only users with the producer role can be assigned to project teams.';
  END IF;
  IF NEW.is_active AND NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = NEW.project_id AND status NOT IN ('completed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Only open projects can have active producer assignments.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_assignments_validate
  BEFORE INSERT OR UPDATE OF user_id, is_active ON public.project_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_assignment();

CREATE FUNCTION public.record_project_assignment_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.project_assignment_audit_log (
    assignment_id, action, old_values, new_values, changed_by
  )
  VALUES (
    NEW.id, TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW), auth.uid()
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_assignments_audit
  AFTER INSERT OR UPDATE ON public.project_assignments
  FOR EACH ROW EXECUTE FUNCTION public.record_project_assignment_audit();

ALTER TABLE public.project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_assignment_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_role_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Administrators view financial accounts" ON public.financial_accounts;
DROP POLICY IF EXISTS "Administrators create financial accounts" ON public.financial_accounts;
DROP POLICY IF EXISTS "Administrators view financial transactions" ON public.financial_transactions;
DROP POLICY IF EXISTS "Administrators create financial transactions" ON public.financial_transactions;
DROP POLICY IF EXISTS "Administrators view financial audit log" ON public.financial_audit_log;
DROP POLICY IF EXISTS "Administrators view invoices" ON public.invoices;
DROP POLICY IF EXISTS "Administrators update invoices" ON public.invoices;
DROP POLICY IF EXISTS "Administrators view invoice line items" ON public.invoice_line_items;
DROP POLICY IF EXISTS "Administrators view invoice payments" ON public.invoice_payments;
DROP POLICY IF EXISTS "Administrators view invoice audit log" ON public.invoice_audit_log;
DROP POLICY IF EXISTS "Administrators view financial reconciliations"
  ON public.financial_reconciliations;
DROP POLICY IF EXISTS "Administrators create financial reconciliations"
  ON public.financial_reconciliations;
DROP POLICY IF EXISTS "Administrators delete open financial reconciliations"
  ON public.financial_reconciliations;
DROP POLICY IF EXISTS "Administrators view financial reconciliation items"
  ON public.financial_reconciliation_items;
DROP POLICY IF EXISTS "Administrators match financial reconciliation items"
  ON public.financial_reconciliation_items;
DROP POLICY IF EXISTS "Administrators remove matches from open reconciliations"
  ON public.financial_reconciliation_items;
DROP POLICY IF EXISTS "Administrators view financial budgets" ON public.financial_budgets;
DROP POLICY IF EXISTS "Administrators create financial budgets" ON public.financial_budgets;
DROP POLICY IF EXISTS "Administrators approve draft budgets" ON public.financial_budgets;
DROP POLICY IF EXISTS "Administrators view financial budget audit"
  ON public.financial_budget_audit_log;
DROP POLICY IF EXISTS "Staff view business parties" ON public.business_parties;
DROP POLICY IF EXISTS "Staff create business parties" ON public.business_parties;
DROP POLICY IF EXISTS "Staff update business parties" ON public.business_parties;
DROP POLICY IF EXISTS "Staff view projects" ON public.projects;
DROP POLICY IF EXISTS "Staff create projects" ON public.projects;
DROP POLICY IF EXISTS "Staff update projects" ON public.projects;
DROP POLICY IF EXISTS "Staff view business audit log" ON public.business_audit_log;
DROP POLICY IF EXISTS "Staff and requesters view expense requests"
  ON public.expense_requests;
DROP POLICY IF EXISTS "Staff and requesters view expense audit"
  ON public.expense_request_audit_log;

CREATE POLICY "Administrators view user role audit"
  ON public.user_role_audit_log FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.has_finance_mfa()
  );

CREATE POLICY "Finance staff view business parties"
  ON public.business_parties FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Finance staff create business parties"
  ON public.business_parties FOR INSERT
  WITH CHECK (
    public.is_verified_finance_staff(auth.uid())
    AND created_by = auth.uid()
  );
CREATE POLICY "Finance staff update business parties"
  ON public.business_parties FOR UPDATE
  USING (public.is_verified_finance_staff(auth.uid()))
  WITH CHECK (public.is_verified_finance_staff(auth.uid()));

CREATE POLICY "Finance staff view projects"
  ON public.projects FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Finance staff create projects"
  ON public.projects FOR INSERT
  WITH CHECK (
    public.is_verified_finance_staff(auth.uid())
    AND created_by = auth.uid()
  );
CREATE POLICY "Finance staff update projects"
  ON public.projects FOR UPDATE
  USING (public.is_verified_finance_staff(auth.uid()))
  WITH CHECK (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Assigned producers view projects"
  ON public.projects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_assignments AS assignment
      WHERE assignment.project_id = projects.id
        AND assignment.user_id = auth.uid()
        AND assignment.is_active
    )
  );

CREATE POLICY "Finance staff and assigned producers view assignments"
  ON public.project_assignments FOR SELECT
  USING (
    public.is_finance_staff(auth.uid())
    OR (user_id = auth.uid() AND is_active)
  );
CREATE POLICY "Managers manage project assignments"
  ON public.project_assignments FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'hr'::public.app_role)
  );
CREATE POLICY "Managers update project assignments"
  ON public.project_assignments FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'hr'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'hr'::public.app_role)
  );
CREATE POLICY "Finance staff view project assignment audit"
  ON public.project_assignment_audit_log FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Managers view business audit log"
  ON public.business_audit_log FOR SELECT
  USING (
    public.is_verified_finance_staff(auth.uid())
    OR public.has_role(auth.uid(), 'hr'::public.app_role)
  );

CREATE POLICY "Finance staff view financial accounts"
  ON public.financial_accounts FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Finance staff create financial accounts"
  ON public.financial_accounts FOR INSERT
  WITH CHECK (
    public.is_verified_finance_staff(auth.uid())
    AND created_by = auth.uid()
  );
CREATE POLICY "Finance staff view financial transactions"
  ON public.financial_transactions FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Finance staff create financial transactions"
  ON public.financial_transactions FOR INSERT
  WITH CHECK (
    public.is_verified_finance_staff(auth.uid())
    AND created_by = auth.uid()
  );
CREATE POLICY "Finance staff view financial audit log"
  ON public.financial_audit_log FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));

CREATE POLICY "Finance staff view invoices"
  ON public.invoices FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Finance staff update invoices"
  ON public.invoices FOR UPDATE
  USING (public.is_verified_finance_staff(auth.uid()))
  WITH CHECK (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Finance staff view invoice line items"
  ON public.invoice_line_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices
      WHERE invoices.id = invoice_id
        AND public.is_verified_finance_staff(auth.uid())
    )
  );
CREATE POLICY "Finance staff view invoice payments"
  ON public.invoice_payments FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Finance staff view invoice audit log"
  ON public.invoice_audit_log FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));

CREATE POLICY "Finance staff view financial budgets"
  ON public.financial_budgets FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Accountants create draft financial budgets"
  ON public.financial_budgets FOR INSERT
  WITH CHECK (
    public.is_verified_finance_staff(auth.uid())
    AND created_by = auth.uid()
    AND status = 'draft'
  );

CREATE POLICY "Finance staff and requesters view expense requests"
  ON public.expense_requests FOR SELECT
  USING (
    public.is_verified_finance_staff(auth.uid())
    OR requested_by = auth.uid()
  );
CREATE POLICY "Producers submit assigned-project expenses"
  ON public.expense_requests FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'producer'::public.app_role)
    AND requested_by = auth.uid()
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND manager_note IS NULL
    AND paid_by IS NULL
    AND paid_at IS NULL
    AND payment_transaction_id IS NULL
    AND (
      project_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.project_assignments AS assignment
        WHERE assignment.project_id = expense_requests.project_id
          AND assignment.user_id = auth.uid()
          AND assignment.is_active
      )
    )
  );
CREATE POLICY "Finance staff view expense audit"
  ON public.expense_request_audit_log FOR SELECT
  USING (
    public.is_verified_finance_staff(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.expense_requests
      WHERE expense_requests.id = expense_request_id
        AND expense_requests.requested_by = auth.uid()
    )
  );

CREATE FUNCTION public.attach_expense_receipt(p_request_id uuid, p_storage_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_row public.expense_requests%ROWTYPE;
BEGIN
  SELECT * INTO request_row
  FROM public.expense_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF request_row.id IS NULL
    OR request_row.status <> 'pending'
    OR (
      request_row.requested_by <> auth.uid()
      AND NOT public.is_verified_finance_staff(auth.uid())
    )
  THEN
    RAISE EXCEPTION 'Only the requester can attach a receipt to a pending expense request.';
  END IF;
  IF p_storage_key IS NULL
    OR split_part(p_storage_key, '/', 1) <> p_request_id::text
    OR position('..' IN p_storage_key) > 0
  THEN
    RAISE EXCEPTION 'The receipt path does not belong to this expense request.';
  END IF;

  UPDATE public.expense_requests
  SET receipt_reference = p_storage_key
  WHERE id = p_request_id;
END;
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Requesters and finance staff read expense receipts"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'expense-receipts'
    AND (
      public.has_role(auth.uid(), 'hr'::public.app_role)
      OR public.is_verified_finance_staff(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.expense_requests AS request
        WHERE request.id::text = (storage.foldername(name))[1]
          AND request.requested_by = auth.uid()
      )
    )
  );
CREATE POLICY "Requesters upload receipts to own pending requests"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND EXISTS (
      SELECT 1 FROM public.expense_requests AS request
      WHERE request.id::text = (storage.foldername(name))[1]
        AND request.requested_by = auth.uid()
        AND request.status = 'pending'
    )
  );

CREATE OR REPLACE FUNCTION public.review_expense_request(
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
  IF NOT public.is_verified_finance_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Verified manager or accountant access is required to review expenses.';
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

CREATE POLICY "Finance staff view financial reconciliations"
  ON public.financial_reconciliations FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Finance staff create financial reconciliations"
  ON public.financial_reconciliations FOR INSERT
  WITH CHECK (
    public.is_verified_finance_staff(auth.uid())
    AND created_by = auth.uid()
    AND status = 'open'
  );
CREATE POLICY "Finance staff delete open financial reconciliations"
  ON public.financial_reconciliations FOR DELETE
  USING (
    public.is_verified_finance_staff(auth.uid())
    AND status = 'open'
  );
CREATE POLICY "Finance staff view financial reconciliation items"
  ON public.financial_reconciliation_items FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Finance staff match financial reconciliation items"
  ON public.financial_reconciliation_items FOR INSERT
  WITH CHECK (
    public.is_verified_finance_staff(auth.uid())
    AND matched_by = auth.uid()
  );
CREATE POLICY "Finance staff remove matches from open reconciliations"
  ON public.financial_reconciliation_items FOR DELETE
  USING (
    public.is_verified_finance_staff(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.financial_reconciliations
      WHERE id = reconciliation_id AND status = 'open'
    )
  );

CREATE OR REPLACE FUNCTION public.finalize_financial_reconciliation(p_reconciliation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  reconciliation_row public.financial_reconciliations%ROWTYPE;
  expected_transactions bigint;
  matched_transactions bigint;
  matched_statement_movement numeric(16, 2);
BEGIN
  IF NOT public.is_verified_finance_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Verified finance staff access is required to finalize a reconciliation.';
  END IF;

  SELECT * INTO reconciliation_row FROM public.financial_reconciliations
  WHERE id = p_reconciliation_id FOR UPDATE;
  IF reconciliation_row.id IS NULL OR reconciliation_row.status <> 'open' THEN
    RAISE EXCEPTION 'Choose an open reconciliation.';
  END IF;

  SELECT count(*) INTO expected_transactions
  FROM public.financial_transactions AS t
  WHERE t.transaction_date BETWEEN reconciliation_row.period_start AND reconciliation_row.period_end
    AND (
      t.account_id = reconciliation_row.account_id
      OR (t.transaction_type = 'transfer'
        AND t.transfer_to_account_id = reconciliation_row.account_id)
    );
  SELECT count(*), COALESCE(sum(item.statement_amount), 0)
    INTO matched_transactions, matched_statement_movement
  FROM public.financial_reconciliation_items AS item
  WHERE item.reconciliation_id = p_reconciliation_id;

  IF matched_transactions <> expected_transactions THEN
    RAISE EXCEPTION 'Match every posted transaction in the statement period before finalizing.';
  END IF;
  IF reconciliation_row.statement_opening_balance + matched_statement_movement
    <> reconciliation_row.statement_closing_balance
  THEN
    RAISE EXCEPTION 'The statement closing balance does not agree with the matched transactions.';
  END IF;

  UPDATE public.financial_reconciliations
  SET status = 'reconciled', reconciled_by = auth.uid(), reconciled_at = now()
  WHERE id = p_reconciliation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_financial_budget(p_budget_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
    OR NOT public.has_finance_mfa()
  THEN
    RAISE EXCEPTION 'Administrator access with MFA verification is required to approve a budget.';
  END IF;

  UPDATE public.financial_budgets
  SET status = 'approved', approved_by = auth.uid(), approved_at = now()
  WHERE id = p_budget_id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose a draft budget.'; END IF;
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
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
    OR NOT public.has_finance_mfa()
  THEN
    RAISE EXCEPTION 'Administrator access with MFA verification is required to pay an expense request.';
  END IF;

  SELECT * INTO request_row FROM public.expense_requests
  WHERE id = p_request_id FOR UPDATE;
  IF request_row.id IS NULL OR request_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved expense requests can be paid.';
  END IF;

  SELECT currency INTO account_currency
  FROM public.financial_accounts WHERE id = p_account_id;
  IF account_currency IS NULL OR account_currency <> request_row.currency THEN
    RAISE EXCEPTION 'Choose a financial account in the expense currency.';
  END IF;
  IF request_row.currency = 'UGX' AND (
    p_exchange_rate <> 1 OR p_exchange_rate_date <> p_payment_date
  ) THEN
    RAISE EXCEPTION 'UGX payments use rate 1 and the payment date.';
  END IF;
  IF request_row.currency = 'USD' AND (
    p_exchange_rate <= 0 OR length(trim(COALESCE(p_exchange_rate_source, ''))) = 0
  ) THEN
    RAISE EXCEPTION 'USD payments require a documented positive exchange rate.';
  END IF;

  SELECT name INTO supplier_name
  FROM public.business_parties WHERE id = request_row.supplier_id;
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
  SET status = 'paid', paid_by = auth.uid(), paid_at = now(),
      payment_transaction_id = transaction_id
  WHERE id = p_request_id;
  RETURN transaction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_user_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.app_role, boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_expense_receipt(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_list_user_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, public.app_role, boolean)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attach_expense_receipt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_finance_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_finance_mfa() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_verified_finance_staff(uuid) TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.project_assignments TO authenticated;
GRANT SELECT ON public.project_assignment_audit_log TO authenticated;
GRANT SELECT ON public.user_role_audit_log TO authenticated;
GRANT SELECT ON public.financial_account_balances, public.invoice_balances,
  public.financial_budget_vs_actual, public.financial_monthly_summary,
  public.financial_project_profitability, public.financial_upcoming_commitments
  TO authenticated;

CREATE OR REPLACE FUNCTION public.create_sales_invoice(
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
  IF NOT public.is_verified_finance_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Verified finance staff access is required to create invoices.';
  END IF;
  IF p_due_date < p_issue_date OR p_tax_amount < 0 THEN
    RAISE EXCEPTION 'Check invoice dates and tax amount.';
  END IF;
  IF p_line_items IS NULL OR jsonb_typeof(p_line_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_line_items) = 0
  THEN
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
  SELECT created_invoice_id, item.description, item.quantity, item.unit_price
  FROM jsonb_to_recordset(p_line_items) AS item(
    description text, quantity numeric, unit_price numeric
  );

  RETURN created_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_sales_invoice_sent(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_verified_finance_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Verified finance staff access is required to issue invoices.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoice_line_items WHERE invoice_id = p_invoice_id
  ) THEN
    RAISE EXCEPTION 'An invoice needs at least one line item before it can be issued.';
  END IF;

  UPDATE public.invoices SET status = 'sent'
  WHERE id = p_invoice_id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose a draft invoice.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_sales_invoice_payment(
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
  IF NOT public.is_verified_finance_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Verified finance staff access is required to record invoice payments.';
  END IF;

  SELECT * INTO invoice_row FROM public.invoices
  WHERE id = p_invoice_id FOR UPDATE;
  IF invoice_row.id IS NULL OR invoice_row.status <> 'sent' THEN
    RAISE EXCEPTION 'Payments can only be recorded against issued invoices.';
  END IF;

  SELECT currency INTO account_currency FROM public.financial_accounts WHERE id = p_account_id;
  IF account_currency IS NULL OR account_currency <> invoice_row.currency THEN
    RAISE EXCEPTION 'Choose a financial account in the invoice currency.';
  END IF;

  SELECT (COALESCE(sum(line_total), 0) + invoice_row.tax_amount)::numeric(18, 2)
    INTO invoice_total
  FROM public.invoice_line_items WHERE invoice_id = p_invoice_id;
  SELECT COALESCE(sum(amount), 0)::numeric(18, 2) INTO amount_paid
  FROM public.invoice_payments WHERE invoice_id = p_invoice_id;
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
