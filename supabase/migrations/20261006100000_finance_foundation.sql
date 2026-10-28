CREATE TABLE public.financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('cash', 'bank', 'mobile_money', 'other')),
  provider text,
  currency text NOT NULL CHECK (currency IN ('UGX', 'USD')),
  opening_balance numeric(16, 2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  opening_balance_date date NOT NULL,
  notes text NOT NULL CHECK (length(trim(notes)) > 0),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, currency)
);

CREATE TABLE public.financial_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.financial_accounts (id) ON DELETE RESTRICT,
  transfer_to_account_id uuid REFERENCES public.financial_accounts (id) ON DELETE RESTRICT,
  transaction_date date NOT NULL,
  transaction_type text NOT NULL CHECK (
    transaction_type IN (
      'income', 'expense', 'transfer', 'refund', 'advance',
      'employee_advance', 'owner_contribution', 'loan', 'correction'
    )
  ),
  direction text NOT NULL CHECK (direction IN ('inflow', 'outflow')),
  amount numeric(16, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN ('UGX', 'USD')),
  exchange_rate numeric(18, 8) NOT NULL CHECK (exchange_rate > 0),
  exchange_rate_date date NOT NULL,
  exchange_rate_source text NOT NULL CHECK (length(trim(exchange_rate_source)) > 0),
  amount_ugx numeric(18, 2) GENERATED ALWAYS AS (round(amount * exchange_rate, 2)) STORED,
  category text NOT NULL CHECK (length(trim(category)) > 0),
  counterparty text,
  reference text,
  description text NOT NULL CHECK (length(trim(description)) > 0),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (currency = 'UGX' AND exchange_rate = 1)
    OR currency = 'USD'
  ),
  CHECK (
    (transaction_type = 'transfer'
      AND direction = 'outflow'
      AND transfer_to_account_id IS NOT NULL
      AND transfer_to_account_id <> account_id)
    OR
    (transaction_type <> 'transfer' AND transfer_to_account_id IS NULL)
  ),
  CHECK (
    (transaction_type <> 'income' OR direction = 'inflow')
    AND (transaction_type <> 'expense' OR direction = 'outflow')
    AND (transaction_type <> 'refund' OR direction = 'inflow')
    AND (transaction_type <> 'advance' OR direction = 'outflow')
    AND (transaction_type <> 'employee_advance' OR direction = 'outflow')
    AND (transaction_type <> 'owner_contribution' OR direction = 'inflow')
  )
);

CREATE INDEX financial_transactions_account_date_idx
  ON public.financial_transactions (account_id, transaction_date DESC);
CREATE INDEX financial_transactions_transfer_target_idx
  ON public.financial_transactions (transfer_to_account_id)
  WHERE transfer_to_account_id IS NOT NULL;

CREATE TABLE public.financial_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL CHECK (table_name IN ('financial_accounts', 'financial_transactions')),
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE')),
  old_values jsonb,
  new_values jsonb NOT NULL,
  reason text NOT NULL,
  changed_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX financial_audit_log_record_changed_idx
  ON public.financial_audit_log (table_name, record_id, changed_at DESC);

CREATE FUNCTION public.validate_financial_transaction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  account_currency text;
  destination_currency text;
BEGIN
  SELECT currency INTO account_currency
  FROM public.financial_accounts
  WHERE id = NEW.account_id;

  IF account_currency IS NULL OR account_currency <> NEW.currency THEN
    RAISE EXCEPTION 'Transaction currency must match the source account currency.';
  END IF;

  IF NEW.currency = 'UGX' AND NEW.exchange_rate_date <> NEW.transaction_date THEN
    RAISE EXCEPTION 'UGX base currency uses an exchange-rate date matching the transaction date.';
  END IF;

  IF NEW.transaction_type = 'transfer' THEN
    SELECT currency INTO destination_currency
    FROM public.financial_accounts
    WHERE id = NEW.transfer_to_account_id;

    IF destination_currency IS NULL OR destination_currency <> NEW.currency THEN
      RAISE EXCEPTION 'Transfers currently require source and destination accounts in the same currency.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER financial_transactions_validate
  BEFORE INSERT ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.validate_financial_transaction();

CREATE FUNCTION public.record_financial_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  audit_reason text;
BEGIN
  audit_reason := CASE
    WHEN TG_TABLE_NAME = 'financial_transactions' THEN NEW.reason
    ELSE to_jsonb(NEW)->>'notes'
  END;

  INSERT INTO public.financial_audit_log (
    table_name, record_id, action, old_values, new_values, reason, changed_by
  )
  VALUES (
    TG_TABLE_NAME,
    NEW.id,
    TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    audit_reason,
    auth.uid()
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER financial_accounts_audit
  AFTER INSERT OR UPDATE ON public.financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.record_financial_audit();

CREATE TRIGGER financial_transactions_audit
  AFTER INSERT ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.record_financial_audit();

CREATE FUNCTION public.prevent_financial_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Posted financial transactions cannot be changed or deleted. Record a correction with an audit reason.';
END;
$$;

CREATE TRIGGER financial_transactions_immutable
  BEFORE UPDATE OR DELETE ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_transaction_mutation();

CREATE VIEW public.financial_account_balances
WITH (security_invoker = true)
AS
SELECT
  accounts.id,
  accounts.name,
  accounts.account_type,
  accounts.provider,
  accounts.currency,
  accounts.opening_balance,
  accounts.opening_balance_date,
  accounts.created_at,
  accounts.created_by,
  accounts.opening_balance + COALESCE(
    SUM(
      CASE
        WHEN transactions.transaction_type = 'transfer'
          AND transactions.transfer_to_account_id = accounts.id
          THEN transactions.amount
        WHEN transactions.direction = 'inflow' THEN transactions.amount
        ELSE -transactions.amount
      END
    ),
    0
  ) AS current_balance
FROM public.financial_accounts AS accounts
LEFT JOIN public.financial_transactions AS transactions
  ON transactions.account_id = accounts.id
  OR transactions.transfer_to_account_id = accounts.id
GROUP BY accounts.id;

ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Administrators view financial accounts"
  ON public.financial_accounts FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Administrators create financial accounts"
  ON public.financial_accounts FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND created_by = auth.uid()
  );

CREATE POLICY "Administrators view financial transactions"
  ON public.financial_transactions FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Administrators create financial transactions"
  ON public.financial_transactions FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND created_by = auth.uid()
  );

CREATE POLICY "Administrators view financial audit log"
  ON public.financial_audit_log FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

GRANT SELECT, INSERT ON public.financial_accounts, public.financial_transactions TO authenticated;
GRANT SELECT ON public.financial_audit_log, public.financial_account_balances TO authenticated;
REVOKE UPDATE, DELETE ON public.financial_accounts, public.financial_transactions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.financial_audit_log FROM authenticated;
