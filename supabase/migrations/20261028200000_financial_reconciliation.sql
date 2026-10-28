CREATE TABLE public.financial_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.financial_accounts (id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  statement_opening_balance numeric(16, 2) NOT NULL CHECK (statement_opening_balance >= 0),
  statement_closing_balance numeric(16, 2) NOT NULL CHECK (statement_closing_balance >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reconciled')),
  notes text NOT NULL CHECK (length(trim(notes)) > 0),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reconciled_by uuid REFERENCES auth.users (id),
  reconciled_at timestamptz,
  CHECK (period_end >= period_start),
  CHECK (
    (status = 'open' AND reconciled_by IS NULL AND reconciled_at IS NULL)
    OR (status = 'reconciled' AND reconciled_by IS NOT NULL AND reconciled_at IS NOT NULL)
  )
);

CREATE INDEX financial_reconciliations_account_period_idx
  ON public.financial_reconciliations (account_id, period_end DESC);

CREATE TABLE public.financial_reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL
    REFERENCES public.financial_reconciliations (id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL
    REFERENCES public.financial_transactions (id) ON DELETE RESTRICT,
  statement_reference text,
  statement_date date NOT NULL,
  statement_amount numeric(16, 2) NOT NULL CHECK (statement_amount <> 0),
  matched_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  matched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reconciliation_id, transaction_id)
);

CREATE INDEX financial_reconciliation_items_transaction_idx
  ON public.financial_reconciliation_items (transaction_id);

CREATE FUNCTION public.validate_financial_reconciliation_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  reconciliation_row public.financial_reconciliations%ROWTYPE;
  transaction_row public.financial_transactions%ROWTYPE;
  expected_amount numeric(16, 2);
BEGIN
  SELECT * INTO reconciliation_row
  FROM public.financial_reconciliations
  WHERE id = NEW.reconciliation_id;

  IF reconciliation_row.id IS NULL OR reconciliation_row.status <> 'open' THEN
    RAISE EXCEPTION 'Items can only be matched to an open reconciliation.';
  END IF;

  SELECT * INTO transaction_row
  FROM public.financial_transactions
  WHERE id = NEW.transaction_id;

  IF transaction_row.id IS NULL
    OR transaction_row.transaction_date NOT BETWEEN reconciliation_row.period_start AND reconciliation_row.period_end
  THEN
    RAISE EXCEPTION 'The transaction date must be within the statement period.';
  END IF;

  IF transaction_row.account_id = reconciliation_row.account_id THEN
    expected_amount := CASE
      WHEN transaction_row.direction = 'inflow' THEN transaction_row.amount
      ELSE -transaction_row.amount
    END;
  ELSIF transaction_row.transfer_to_account_id = reconciliation_row.account_id
    AND transaction_row.transaction_type = 'transfer'
  THEN
    expected_amount := transaction_row.amount;
  ELSE
    RAISE EXCEPTION 'The transaction does not belong to the reconciled account.';
  END IF;

  IF NEW.statement_amount <> expected_amount
    OR NEW.statement_date NOT BETWEEN reconciliation_row.period_start AND reconciliation_row.period_end
  THEN
    RAISE EXCEPTION 'Matched statement amount must agree with the posted transaction and its date must be in the period.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER financial_reconciliation_items_validate
  BEFORE INSERT ON public.financial_reconciliation_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_financial_reconciliation_item();

CREATE FUNCTION public.prevent_reconciled_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'financial_reconciliations'
    AND OLD.status = 'reconciled'
  THEN
    RAISE EXCEPTION 'Finalized reconciliations cannot be changed or deleted.';
  END IF;

  IF TG_TABLE_NAME = 'financial_reconciliation_items' THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'Reconciliation matches cannot be edited.';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.financial_reconciliations
      WHERE id = OLD.reconciliation_id
        AND status = 'reconciled'
    ) THEN
      RAISE EXCEPTION 'Matches in a finalized reconciliation cannot be changed or deleted.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER financial_reconciliations_immutable
  BEFORE UPDATE OR DELETE ON public.financial_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_reconciled_mutation();

CREATE TRIGGER financial_reconciliation_items_immutable
  BEFORE UPDATE OR DELETE ON public.financial_reconciliation_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_reconciled_mutation();

CREATE FUNCTION public.prevent_posting_into_reconciled_period()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.financial_reconciliations
    WHERE status = 'reconciled'
      AND NEW.transaction_date BETWEEN period_start AND period_end
      AND (
        account_id = NEW.account_id
        OR (
          NEW.transaction_type = 'transfer'
          AND account_id = NEW.transfer_to_account_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Transactions cannot be posted into a finalized reconciliation period.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER financial_transactions_prevent_reconciled_period
  BEFORE INSERT ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_posting_into_reconciled_period();

CREATE FUNCTION public.finalize_financial_reconciliation(p_reconciliation_id uuid)
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
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Administrator access is required to finalize a reconciliation.';
  END IF;

  SELECT * INTO reconciliation_row
  FROM public.financial_reconciliations
  WHERE id = p_reconciliation_id
  FOR UPDATE;

  IF reconciliation_row.id IS NULL OR reconciliation_row.status <> 'open' THEN
    RAISE EXCEPTION 'Choose an open reconciliation.';
  END IF;

  SELECT count(*) INTO expected_transactions
  FROM public.financial_transactions AS t
  WHERE t.transaction_date BETWEEN reconciliation_row.period_start AND reconciliation_row.period_end
    AND (
      t.account_id = reconciliation_row.account_id
      OR (
        t.transaction_type = 'transfer'
        AND t.transfer_to_account_id = reconciliation_row.account_id
      )
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
  SET status = 'reconciled',
      reconciled_by = auth.uid(),
      reconciled_at = now()
  WHERE id = p_reconciliation_id;
END;
$$;

ALTER TABLE public.financial_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_reconciliation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Administrators view financial reconciliations"
  ON public.financial_reconciliations FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Administrators create financial reconciliations"
  ON public.financial_reconciliations FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND created_by = auth.uid()
    AND status = 'open'
  );
CREATE POLICY "Administrators delete open financial reconciliations"
  ON public.financial_reconciliations FOR DELETE
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND status = 'open'
  );

CREATE POLICY "Administrators view financial reconciliation items"
  ON public.financial_reconciliation_items FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Administrators match financial reconciliation items"
  ON public.financial_reconciliation_items FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND matched_by = auth.uid()
  );
CREATE POLICY "Administrators remove matches from open reconciliations"
  ON public.financial_reconciliation_items FOR DELETE
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.financial_reconciliations
      WHERE id = reconciliation_id
        AND status = 'open'
    )
  );

GRANT SELECT, INSERT, DELETE
  ON public.financial_reconciliations TO authenticated;
GRANT SELECT, INSERT, DELETE
  ON public.financial_reconciliation_items TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_financial_reconciliation(uuid) TO authenticated;
REVOKE UPDATE ON public.financial_reconciliations, public.financial_reconciliation_items
  FROM authenticated;
