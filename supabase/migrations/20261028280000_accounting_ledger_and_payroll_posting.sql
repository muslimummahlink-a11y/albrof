CREATE SEQUENCE public.chart_of_accounts_code_seq;

CREATE TABLE public.chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code text NOT NULL UNIQUE,
  name text NOT NULL,
  account_type text NOT NULL CHECK (
    account_type IN ('asset', 'liability', 'equity', 'income', 'expense')
  ),
  currency text NOT NULL CHECK (currency IN ('UGX', 'USD')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, account_type, currency)
);

CREATE TABLE public.accounting_category_mappings (
  transaction_type text NOT NULL,
  category text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('UGX', 'USD')),
  chart_account_id uuid NOT NULL REFERENCES public.chart_of_accounts (id) ON DELETE RESTRICT,
  PRIMARY KEY (transaction_type, category, currency),
  CHECK (transaction_type IN (
    'income', 'expense', 'refund', 'advance', 'employee_advance',
    'owner_contribution', 'loan', 'correction'
  ))
);

CREATE TABLE public.financial_account_ledger_mappings (
  financial_account_id uuid PRIMARY KEY
    REFERENCES public.financial_accounts (id) ON DELETE RESTRICT,
  chart_account_id uuid NOT NULL UNIQUE
    REFERENCES public.chart_of_accounts (id) ON DELETE RESTRICT
);

CREATE TABLE public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  description text NOT NULL CHECK (length(trim(description)) > 0),
  currency text NOT NULL CHECK (currency IN ('UGX', 'USD')),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);

CREATE TABLE public.journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL
    REFERENCES public.journal_entries (id) ON DELETE RESTRICT,
  chart_account_id uuid NOT NULL
    REFERENCES public.chart_of_accounts (id) ON DELETE RESTRICT,
  currency text NOT NULL CHECK (currency IN ('UGX', 'USD')),
  debit numeric(18, 2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(18, 2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description text NOT NULL DEFAULT '',
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE INDEX journal_entries_date_idx ON public.journal_entries (entry_date DESC);
CREATE INDEX journal_lines_entry_idx ON public.journal_lines (journal_entry_id);
CREATE INDEX journal_lines_account_idx ON public.journal_lines (chart_account_id);

CREATE TABLE public.payroll_run_postings (
  payroll_run_id uuid PRIMARY KEY
    REFERENCES public.payroll_runs (id) ON DELETE RESTRICT,
  financial_transaction_id uuid NOT NULL UNIQUE
    REFERENCES public.financial_transactions (id) ON DELETE RESTRICT,
  adjustment_journal_entry_id uuid UNIQUE
    REFERENCES public.journal_entries (id) ON DELETE RESTRICT,
  financial_account_id uuid NOT NULL
    REFERENCES public.financial_accounts (id) ON DELETE RESTRICT,
  payment_date date NOT NULL,
  posted_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id),
  posted_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.ensure_chart_account(
  p_name text,
  p_account_type text,
  p_currency text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  account_id uuid;
BEGIN
  INSERT INTO public.chart_of_accounts (account_code, name, account_type, currency)
  VALUES (
    CASE p_account_type
      WHEN 'asset' THEN '1'
      WHEN 'liability' THEN '2'
      WHEN 'equity' THEN '3'
      WHEN 'income' THEN '4'
      ELSE '5'
    END || '-' || lpad(nextval('public.chart_of_accounts_code_seq')::text, 5, '0'),
    trim(p_name),
    p_account_type,
    p_currency
  )
  ON CONFLICT (name, account_type, currency) DO NOTHING;

  SELECT id INTO account_id
  FROM public.chart_of_accounts
  WHERE name = trim(p_name)
    AND account_type = p_account_type
    AND currency = p_currency;
  RETURN account_id;
END;
$$;

CREATE FUNCTION public.insert_accounting_journal_entry(
  p_entry_date date,
  p_description text,
  p_currency text,
  p_source_type text,
  p_source_id uuid,
  p_created_by uuid,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  entry_id uuid;
BEGIN
  INSERT INTO public.journal_entries (
    entry_date, description, currency, source_type, source_id, created_by
  )
  VALUES (
    p_entry_date, trim(p_description), p_currency, p_source_type, p_source_id, p_created_by
  )
  RETURNING id INTO entry_id;

  INSERT INTO public.journal_lines (
    journal_entry_id, chart_account_id, currency, debit, credit, description
  )
  SELECT
    entry_id, line.chart_account_id, p_currency, line.debit, line.credit,
    COALESCE(line.description, '')
  FROM jsonb_to_recordset(p_lines) AS line(
    chart_account_id uuid, debit numeric, credit numeric, description text
  )
  WHERE COALESCE(line.debit, 0) > 0 OR COALESCE(line.credit, 0) > 0;
  RETURN entry_id;
END;
$$;

CREATE FUNCTION public.validate_journal_entry_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  entry_currency text;
  account_currency text;
BEGIN
  SELECT currency INTO entry_currency
  FROM public.journal_entries WHERE id = NEW.journal_entry_id;
  SELECT currency INTO account_currency
  FROM public.chart_of_accounts WHERE id = NEW.chart_account_id;
  IF entry_currency IS NULL OR NEW.currency <> entry_currency
    OR account_currency <> entry_currency
  THEN
    RAISE EXCEPTION 'Journal line currency must match its entry and chart account.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_lines_validate
  BEFORE INSERT ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.validate_journal_entry_line();

CREATE FUNCTION public.assert_journal_entry_balanced()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  total_debits numeric(18, 2);
  total_credits numeric(18, 2);
  line_count bigint;
BEGIN
  SELECT count(*), COALESCE(sum(debit), 0), COALESCE(sum(credit), 0)
    INTO line_count, total_debits, total_credits
  FROM public.journal_lines
  WHERE journal_entry_id = NEW.journal_entry_id;
  IF line_count < 2 OR total_debits <> total_credits THEN
    RAISE EXCEPTION 'Every journal entry must have at least two lines and balance by currency.';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER journal_entries_must_balance
  AFTER INSERT ON public.journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_journal_entry_balanced();

CREATE FUNCTION public.prevent_journal_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Posted journal entries and lines are immutable.';
END;
$$;

CREATE TRIGGER journal_entries_immutable
  BEFORE UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_journal_mutation();
CREATE TRIGGER journal_lines_immutable
  BEFORE UPDATE OR DELETE ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.prevent_journal_mutation();

CREATE VIEW public.accounting_account_balances
WITH (security_invoker = true)
AS
SELECT
  account.id,
  account.account_code,
  account.name,
  account.account_type,
  account.currency,
  COALESCE(sum(
    CASE
      WHEN account.account_type IN ('asset', 'expense')
        THEN line.debit - line.credit
      ELSE line.credit - line.debit
    END
  ), 0)::numeric(18, 2) AS balance
FROM public.chart_of_accounts AS account
LEFT JOIN public.journal_lines AS line
  ON line.chart_account_id = account.id
GROUP BY account.id;

CREATE VIEW public.accounting_journal_summary
WITH (security_invoker = true)
AS
SELECT
  entry.id,
  entry.entry_date,
  entry.description,
  entry.currency,
  entry.source_type,
  entry.source_id,
  entry.created_by,
  entry.created_at,
  COALESCE(sum(line.debit), 0)::numeric(18, 2) AS total_debits,
  COALESCE(sum(line.credit), 0)::numeric(18, 2) AS total_credits
FROM public.journal_entries AS entry
LEFT JOIN public.journal_lines AS line ON line.journal_entry_id = entry.id
GROUP BY entry.id;

CREATE FUNCTION public.create_financial_account_ledger_mapping()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ledger_account_id uuid;
  equity_account_id uuid;
BEGIN
  ledger_account_id := public.ensure_chart_account(
    NEW.name, 'asset', NEW.currency
  );
  INSERT INTO public.financial_account_ledger_mappings (
    financial_account_id, chart_account_id
  )
  VALUES (NEW.id, ledger_account_id);

  IF NEW.opening_balance > 0 THEN
    equity_account_id := public.ensure_chart_account(
      'Opening balances', 'equity', NEW.currency
    );
    PERFORM public.insert_accounting_journal_entry(
      NEW.opening_balance_date,
      'Opening balance · ' || NEW.name,
      NEW.currency,
      'opening_balance',
      NEW.id,
      NEW.created_by,
      jsonb_build_array(
        jsonb_build_object(
          'chart_account_id', ledger_account_id,
          'debit', NEW.opening_balance,
          'credit', 0,
          'description', 'Opening balance'
        ),
        jsonb_build_object(
          'chart_account_id', equity_account_id,
          'debit', 0,
          'credit', NEW.opening_balance,
          'description', 'Opening balance counterpart'
        )
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER financial_accounts_create_ledger_mapping
  AFTER INSERT ON public.financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.create_financial_account_ledger_mapping();

INSERT INTO public.financial_account_ledger_mappings (financial_account_id, chart_account_id)
SELECT account.id, public.ensure_chart_account(account.name, 'asset', account.currency)
FROM public.financial_accounts AS account
ON CONFLICT (financial_account_id) DO NOTHING;

DO $$
DECLARE
  account_row public.financial_accounts%ROWTYPE;
  ledger_account_id uuid;
  equity_account_id uuid;
BEGIN
  FOR account_row IN
    SELECT * FROM public.financial_accounts WHERE opening_balance > 0
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.journal_entries
      WHERE source_type = 'opening_balance' AND source_id = account_row.id
    ) THEN
      SELECT chart_account_id INTO ledger_account_id
      FROM public.financial_account_ledger_mappings
      WHERE financial_account_id = account_row.id;
      equity_account_id := public.ensure_chart_account(
        'Opening balances', 'equity', account_row.currency
      );
      PERFORM public.insert_accounting_journal_entry(
        account_row.opening_balance_date,
        'Opening balance · ' || account_row.name,
        account_row.currency,
        'opening_balance',
        account_row.id,
        account_row.created_by,
        jsonb_build_array(
          jsonb_build_object(
            'chart_account_id', ledger_account_id,
            'debit', account_row.opening_balance,
            'credit', 0,
            'description', 'Opening balance'
          ),
          jsonb_build_object(
            'chart_account_id', equity_account_id,
            'debit', 0,
            'credit', account_row.opening_balance,
            'description', 'Opening balance counterpart'
          )
        )
      );
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.financial_transactions
  ADD COLUMN transfer_to_amount numeric(16, 2),
  ADD COLUMN transfer_to_exchange_rate numeric(18, 8),
  ADD COLUMN transfer_to_exchange_rate_date date,
  ADD COLUMN transfer_to_exchange_rate_source text,
  ADD COLUMN payroll_run_id uuid UNIQUE
    REFERENCES public.payroll_runs (id) ON DELETE RESTRICT;

CREATE FUNCTION public.validate_financial_transaction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  source_currency text;
  destination_currency text;
BEGIN
  SELECT currency INTO source_currency
  FROM public.financial_accounts WHERE id = NEW.account_id;
  IF source_currency IS NULL OR source_currency <> NEW.currency THEN
    RAISE EXCEPTION 'Transaction currency must match the source account currency.';
  END IF;
  IF NEW.currency = 'UGX' AND (
    NEW.exchange_rate <> 1
    OR NEW.exchange_rate_date <> NEW.transaction_date
  ) THEN
    RAISE EXCEPTION 'UGX uses rate 1 and the transaction date.';
  END IF;

  IF NEW.transaction_type = 'transfer' THEN
    SELECT currency INTO destination_currency
    FROM public.financial_accounts WHERE id = NEW.transfer_to_account_id;
    IF destination_currency IS NULL OR NEW.transfer_to_account_id = NEW.account_id THEN
      RAISE EXCEPTION 'Choose a different destination financial account.';
    END IF;
    IF destination_currency = NEW.currency THEN
      IF NEW.transfer_to_amount IS DISTINCT FROM NEW.amount
        OR NEW.transfer_to_exchange_rate IS DISTINCT FROM NEW.exchange_rate
      THEN
        RAISE EXCEPTION 'Same-currency transfers must preserve their amount and rate.';
      END IF;
    ELSE
      IF NEW.transfer_to_amount IS NULL OR NEW.transfer_to_amount <= 0
        OR NEW.transfer_to_exchange_rate IS NULL OR NEW.transfer_to_exchange_rate <= 0
        OR NEW.transfer_to_exchange_rate_date IS NULL
        OR length(trim(COALESCE(NEW.transfer_to_exchange_rate_source, ''))) = 0
      THEN
        RAISE EXCEPTION 'Cross-currency transfers require a destination amount and documented conversion rate.';
      END IF;
      IF destination_currency = 'UGX' AND (
        NEW.transfer_to_exchange_rate <> 1
        OR NEW.transfer_to_exchange_rate_date <> NEW.transaction_date
      ) THEN
        RAISE EXCEPTION 'UGX destination uses rate 1 and the transfer date.';
      END IF;
    END IF;
  ELSIF NEW.transfer_to_account_id IS NOT NULL
    OR NEW.transfer_to_amount IS NOT NULL
    OR NEW.transfer_to_exchange_rate IS NOT NULL
    OR NEW.transfer_to_exchange_rate_date IS NOT NULL
    OR NEW.transfer_to_exchange_rate_source IS NOT NULL
  THEN
    RAISE EXCEPTION 'Transfer destination fields are only valid for transfers.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW public.financial_account_balances
WITH (security_invoker = false)
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
          THEN COALESCE(transactions.transfer_to_amount, transactions.amount)
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
WHERE public.is_verified_finance_staff(auth.uid())
GROUP BY accounts.id;

CREATE OR REPLACE FUNCTION public.validate_financial_reconciliation_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  reconciliation_row public.financial_reconciliations%ROWTYPE;
  transaction_row public.financial_transactions%ROWTYPE;
  expected_amount numeric(16, 2);
BEGIN
  SELECT * INTO reconciliation_row FROM public.financial_reconciliations
  WHERE id = NEW.reconciliation_id;
  IF reconciliation_row.id IS NULL OR reconciliation_row.status <> 'open' THEN
    RAISE EXCEPTION 'Items can only be matched to an open reconciliation.';
  END IF;
  SELECT * INTO transaction_row FROM public.financial_transactions
  WHERE id = NEW.transaction_id;
  IF transaction_row.id IS NULL
    OR transaction_row.transaction_date NOT BETWEEN reconciliation_row.period_start
      AND reconciliation_row.period_end
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
    expected_amount := COALESCE(transaction_row.transfer_to_amount, transaction_row.amount);
  ELSE
    RAISE EXCEPTION 'The transaction does not belong to the reconciled account.';
  END IF;
  IF NEW.statement_amount <> expected_amount
    OR NEW.statement_date NOT BETWEEN reconciliation_row.period_start
      AND reconciliation_row.period_end
  THEN
    RAISE EXCEPTION 'Matched statement amount must agree with the posted transaction and its date must be in the period.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.post_financial_transaction_to_ledger(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  transaction_row public.financial_transactions%ROWTYPE;
  source_ledger_id uuid;
  destination_ledger_id uuid;
  category_ledger_id uuid;
  clearing_ledger_id uuid;
  account_type text;
BEGIN
  SELECT * INTO transaction_row FROM public.financial_transactions
  WHERE id = p_transaction_id;
  IF transaction_row.id IS NULL THEN
    RAISE EXCEPTION 'Financial transaction was not found.';
  END IF;
  IF transaction_row.transaction_type = 'transfer' THEN
    SELECT chart_account_id INTO source_ledger_id
    FROM public.financial_account_ledger_mappings
    WHERE financial_account_id = transaction_row.account_id;
    SELECT chart_account_id INTO destination_ledger_id
    FROM public.financial_account_ledger_mappings
    WHERE financial_account_id = transaction_row.transfer_to_account_id;
    IF transaction_row.currency = (
      SELECT currency FROM public.financial_accounts
      WHERE id = transaction_row.transfer_to_account_id
    ) THEN
      PERFORM public.insert_accounting_journal_entry(
        transaction_row.transaction_date, transaction_row.description,
        transaction_row.currency, 'financial_transaction', transaction_row.id,
        transaction_row.created_by,
        jsonb_build_array(
          jsonb_build_object('chart_account_id', destination_ledger_id,
            'debit', transaction_row.amount, 'credit', 0, 'description', 'Transfer in'),
          jsonb_build_object('chart_account_id', source_ledger_id,
            'debit', 0, 'credit', transaction_row.amount, 'description', 'Transfer out')
        )
      );
    ELSE
      clearing_ledger_id := public.ensure_chart_account(
        'Foreign exchange transfer clearing', 'asset', transaction_row.currency
      );
      PERFORM public.insert_accounting_journal_entry(
        transaction_row.transaction_date, transaction_row.description,
        transaction_row.currency, 'transfer_source', transaction_row.id,
        transaction_row.created_by,
        jsonb_build_array(
          jsonb_build_object('chart_account_id', clearing_ledger_id,
            'debit', transaction_row.amount, 'credit', 0, 'description', 'Transfer clearing'),
          jsonb_build_object('chart_account_id', source_ledger_id,
            'debit', 0, 'credit', transaction_row.amount, 'description', 'Transfer out')
        )
      );
      clearing_ledger_id := public.ensure_chart_account(
        'Foreign exchange transfer clearing', 'asset',
        (SELECT currency FROM public.financial_accounts
          WHERE id = transaction_row.transfer_to_account_id)
      );
      PERFORM public.insert_accounting_journal_entry(
        transaction_row.transaction_date, transaction_row.description,
        (SELECT currency FROM public.financial_accounts
          WHERE id = transaction_row.transfer_to_account_id),
        'transfer_destination', transaction_row.id, transaction_row.created_by,
        jsonb_build_array(
          jsonb_build_object('chart_account_id', destination_ledger_id,
            'debit', transaction_row.transfer_to_amount, 'credit', 0,
            'description', 'Transfer in'),
          jsonb_build_object('chart_account_id', clearing_ledger_id,
            'debit', 0, 'credit', transaction_row.transfer_to_amount,
            'description', 'Transfer clearing')
        )
      );
    END IF;
    RETURN;
  END IF;

  SELECT chart_account_id INTO source_ledger_id
  FROM public.financial_account_ledger_mappings
  WHERE financial_account_id = transaction_row.account_id;
  account_type := CASE transaction_row.transaction_type
    WHEN 'income' THEN 'income'
    WHEN 'refund' THEN 'income'
    WHEN 'expense' THEN 'expense'
    WHEN 'owner_contribution' THEN 'equity'
    WHEN 'loan' THEN 'liability'
    WHEN 'advance' THEN 'asset'
    WHEN 'employee_advance' THEN 'asset'
    ELSE 'equity'
  END;

  INSERT INTO public.accounting_category_mappings (
    transaction_type, category, currency, chart_account_id
  )
  VALUES (
    transaction_row.transaction_type, transaction_row.category,
    transaction_row.currency,
    public.ensure_chart_account(transaction_row.category, account_type, transaction_row.currency)
  )
  ON CONFLICT (transaction_type, category, currency) DO NOTHING;
  SELECT chart_account_id INTO category_ledger_id
  FROM public.accounting_category_mappings
  WHERE transaction_type = transaction_row.transaction_type
    AND category = transaction_row.category
    AND currency = transaction_row.currency;

  IF transaction_row.transaction_type IN ('income', 'refund', 'owner_contribution')
    OR (transaction_row.transaction_type = 'loan' AND transaction_row.direction = 'inflow')
    OR (transaction_row.transaction_type IN ('advance', 'employee_advance')
      AND transaction_row.direction = 'inflow')
    OR (transaction_row.transaction_type = 'correction'
      AND transaction_row.direction = 'inflow')
  THEN
    PERFORM public.insert_accounting_journal_entry(
      transaction_row.transaction_date, transaction_row.description,
      transaction_row.currency, 'financial_transaction', transaction_row.id,
      transaction_row.created_by,
      jsonb_build_array(
        jsonb_build_object('chart_account_id', source_ledger_id,
          'debit', transaction_row.amount, 'credit', 0, 'description', transaction_row.category),
        jsonb_build_object('chart_account_id', category_ledger_id,
          'debit', 0, 'credit', transaction_row.amount, 'description', transaction_row.category)
      )
    );
  ELSE
    PERFORM public.insert_accounting_journal_entry(
      transaction_row.transaction_date, transaction_row.description,
      transaction_row.currency, 'financial_transaction', transaction_row.id,
      transaction_row.created_by,
      jsonb_build_array(
        jsonb_build_object('chart_account_id', category_ledger_id,
          'debit', transaction_row.amount, 'credit', 0, 'description', transaction_row.category),
        jsonb_build_object('chart_account_id', source_ledger_id,
          'debit', 0, 'credit', transaction_row.amount, 'description', transaction_row.category)
      )
    );
  END IF;
END;
$$;

CREATE FUNCTION public.record_financial_transaction_in_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.post_financial_transaction_to_ledger(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER financial_transactions_post_to_ledger
  AFTER INSERT ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.record_financial_transaction_in_ledger();

DO $$
DECLARE
  transaction_row public.financial_transactions%ROWTYPE;
BEGIN
  FOR transaction_row IN
    SELECT * FROM public.financial_transactions ORDER BY transaction_date, created_at
  LOOP
    PERFORM public.post_financial_transaction_to_ledger(transaction_row.id);
  END LOOP;
END;
$$;

CREATE FUNCTION public.post_cross_currency_transfer(
  p_source_account_id uuid,
  p_destination_account_id uuid,
  p_transfer_date date,
  p_source_amount numeric,
  p_destination_amount numeric,
  p_source_exchange_rate numeric,
  p_source_exchange_rate_date date,
  p_source_exchange_rate_source text,
  p_destination_exchange_rate numeric,
  p_destination_exchange_rate_date date,
  p_destination_exchange_rate_source text,
  p_fee_amount numeric,
  p_reference text,
  p_description text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  source_row public.financial_accounts%ROWTYPE;
  destination_row public.financial_accounts%ROWTYPE;
  transfer_id uuid;
  source_value_ugx numeric(18, 2);
  destination_value_ugx numeric(18, 2);
  fx_difference numeric(18, 2);
  fx_adjustment_account_id uuid;
  fx_clearing_account_id uuid;
BEGIN
  IF NOT public.is_verified_finance_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Verified finance staff access is required to post a transfer.';
  END IF;
  SELECT * INTO source_row FROM public.financial_accounts
  WHERE id = p_source_account_id;
  SELECT * INTO destination_row FROM public.financial_accounts
  WHERE id = p_destination_account_id;
  IF source_row.id IS NULL OR destination_row.id IS NULL
    OR source_row.id = destination_row.id
  THEN
    RAISE EXCEPTION 'Choose two different existing financial accounts.';
  END IF;
  IF p_source_amount <= 0 OR p_destination_amount <= 0
    OR COALESCE(p_fee_amount, 0) < 0
  THEN
    RAISE EXCEPTION 'Transfer and destination amounts must be positive; a fee cannot be negative.';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) = 0
    OR length(trim(COALESCE(p_description, ''))) = 0
  THEN
    RAISE EXCEPTION 'Enter a transfer description and audit reason.';
  END IF;
  IF source_row.currency = 'UGX' AND (
    p_source_exchange_rate <> 1
    OR p_source_exchange_rate_date <> p_transfer_date
  ) THEN
    RAISE EXCEPTION 'UGX source accounts use rate 1 and the transfer date.';
  END IF;
  IF source_row.currency = 'USD' AND (
    p_source_exchange_rate <= 0
    OR length(trim(COALESCE(p_source_exchange_rate_source, ''))) = 0
  ) THEN
    RAISE EXCEPTION 'USD source accounts require a documented positive UGX exchange rate.';
  END IF;
  IF destination_row.currency = 'UGX' AND (
    p_destination_exchange_rate <> 1
    OR p_destination_exchange_rate_date <> p_transfer_date
  ) THEN
    RAISE EXCEPTION 'UGX destination accounts use rate 1 and the transfer date.';
  END IF;
  IF destination_row.currency = 'USD' AND (
    p_destination_exchange_rate <= 0
    OR length(trim(COALESCE(p_destination_exchange_rate_source, ''))) = 0
  ) THEN
    RAISE EXCEPTION 'USD destination accounts require a documented positive UGX exchange rate.';
  END IF;
  IF source_row.currency = destination_row.currency
    AND p_source_amount <> p_destination_amount
  THEN
    RAISE EXCEPTION 'Same-currency transfers must preserve the amount.';
  END IF;

  INSERT INTO public.financial_transactions (
    account_id, transfer_to_account_id, transaction_date, transaction_type,
    direction, amount, currency, exchange_rate, exchange_rate_date,
    exchange_rate_source, transfer_to_amount, transfer_to_exchange_rate,
    transfer_to_exchange_rate_date, transfer_to_exchange_rate_source,
    category, reference, description, reason, created_by
  )
  VALUES (
    source_row.id, destination_row.id, p_transfer_date, 'transfer', 'outflow',
    p_source_amount, source_row.currency, p_source_exchange_rate,
    p_source_exchange_rate_date, trim(p_source_exchange_rate_source),
    p_destination_amount, p_destination_exchange_rate,
    p_destination_exchange_rate_date, trim(p_destination_exchange_rate_source),
    'Internal transfer', NULLIF(trim(p_reference), ''), trim(p_description),
    trim(p_reason), auth.uid()
  )
  RETURNING id INTO transfer_id;

  IF source_row.currency <> destination_row.currency THEN
    source_value_ugx := round(p_source_amount * p_source_exchange_rate, 2);
    destination_value_ugx := round(p_destination_amount * p_destination_exchange_rate, 2);
    fx_difference := source_value_ugx - destination_value_ugx;
    IF fx_difference <> 0 THEN
      fx_clearing_account_id := public.ensure_chart_account(
        'Foreign exchange transfer clearing', 'asset', 'UGX'
      );
      IF fx_difference > 0 THEN
        fx_adjustment_account_id := public.ensure_chart_account(
          'Realized foreign exchange loss', 'expense', 'UGX'
        );
        PERFORM public.insert_accounting_journal_entry(
          p_transfer_date, 'Foreign exchange difference · ' || trim(p_description),
          'UGX', 'transfer_fx_difference', transfer_id, auth.uid(),
          jsonb_build_array(
            jsonb_build_object('chart_account_id', fx_adjustment_account_id,
              'debit', fx_difference, 'credit', 0,
              'description', 'Realized foreign exchange loss'),
            jsonb_build_object('chart_account_id', fx_clearing_account_id,
              'debit', 0, 'credit', fx_difference,
              'description', 'Transfer valuation clearing')
          )
        );
      ELSE
        fx_adjustment_account_id := public.ensure_chart_account(
          'Realized foreign exchange gain', 'income', 'UGX'
        );
        PERFORM public.insert_accounting_journal_entry(
          p_transfer_date, 'Foreign exchange difference · ' || trim(p_description),
          'UGX', 'transfer_fx_difference', transfer_id, auth.uid(),
          jsonb_build_array(
            jsonb_build_object('chart_account_id', fx_clearing_account_id,
              'debit', abs(fx_difference), 'credit', 0,
              'description', 'Transfer valuation clearing'),
            jsonb_build_object('chart_account_id', fx_adjustment_account_id,
              'debit', 0, 'credit', abs(fx_difference),
              'description', 'Realized foreign exchange gain')
          )
        );
      END IF;
    END IF;
  END IF;

  IF COALESCE(p_fee_amount, 0) > 0 THEN
    INSERT INTO public.financial_transactions (
      account_id, transaction_date, transaction_type, direction, amount, currency,
      exchange_rate, exchange_rate_date, exchange_rate_source, category,
      reference, description, reason, created_by, cost_type
    )
    VALUES (
      source_row.id, p_transfer_date, 'expense', 'outflow', p_fee_amount,
      source_row.currency, p_source_exchange_rate, p_source_exchange_rate_date,
      trim(p_source_exchange_rate_source), 'Bank and transfer fees',
      NULLIF(trim(p_reference), ''), 'Fee for ' || trim(p_description),
      trim(p_reason), auth.uid(), 'general'
    );
  END IF;
  RETURN transfer_id;
END;
$$;

CREATE FUNCTION public.post_payroll_run(
  p_run_id uuid,
  p_financial_account_id uuid,
  p_payment_date date,
  p_reference text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  run_row public.payroll_runs%ROWTYPE;
  account_row public.financial_accounts%ROWTYPE;
  totals record;
  transaction_id uuid;
  adjustment_entry_id uuid;
  payroll_expense_id uuid;
  nssf_expense_id uuid;
  paye_liability_id uuid;
  nssf_liability_id uuid;
  adjustment_amount numeric(18, 2);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
    OR NOT public.has_finance_mfa()
  THEN
    RAISE EXCEPTION 'Administrator access with MFA verification is required to post payroll.';
  END IF;
  SELECT * INTO run_row FROM public.payroll_runs
  WHERE id = p_run_id FOR UPDATE;
  IF run_row.id IS NULL OR run_row.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft payroll run can be paid and posted.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payroll_run_postings WHERE payroll_run_id = p_run_id) THEN
    RAISE EXCEPTION 'This payroll run already has a payment posting.';
  END IF;
  SELECT * INTO account_row FROM public.financial_accounts
  WHERE id = p_financial_account_id;
  IF account_row.id IS NULL OR account_row.currency <> 'UGX' THEN
    RAISE EXCEPTION 'Choose a UGX financial account for payroll payment.';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Enter an audit reason for this payroll payment.';
  END IF;

  SELECT
    COALESCE(sum(gross), 0)::numeric(18, 2) AS gross,
    COALESCE(sum(paye), 0)::numeric(18, 2) AS paye,
    COALESCE(sum(nssf_employee), 0)::numeric(18, 2) AS nssf_employee,
    COALESCE(sum(nssf_employer), 0)::numeric(18, 2) AS nssf_employer,
    COALESCE(sum(net), 0)::numeric(18, 2) AS net
  INTO totals
  FROM public.payslips WHERE run_id = p_run_id;
  IF totals.net <= 0
    OR totals.gross <> totals.net + totals.paye + totals.nssf_employee
  THEN
    RAISE EXCEPTION 'Payroll totals must contain positive net pay and reconcile gross to net, PAYE, and employee NSSF.';
  END IF;

  INSERT INTO public.financial_transactions (
    account_id, transaction_date, transaction_type, direction, amount, currency,
    exchange_rate, exchange_rate_date, exchange_rate_source, category,
    reference, description, reason, created_by, cost_type, payroll_run_id
  )
  VALUES (
    account_row.id, p_payment_date, 'expense', 'outflow', totals.net, 'UGX',
    1, p_payment_date, 'UGX base currency', 'Payroll net pay',
    NULLIF(trim(p_reference), ''),
    'Net payroll payment · ' || COALESCE(run_row.period, p_run_id::text),
    trim(p_reason), auth.uid(), 'general', p_run_id
  )
  RETURNING id INTO transaction_id;

  adjustment_amount := totals.gross - totals.net + totals.nssf_employer;
  IF adjustment_amount > 0 THEN
    payroll_expense_id := public.ensure_chart_account('Payroll expense adjustment', 'expense', 'UGX');
    nssf_expense_id := public.ensure_chart_account('Employer NSSF expense', 'expense', 'UGX');
    paye_liability_id := public.ensure_chart_account('PAYE payable', 'liability', 'UGX');
    nssf_liability_id := public.ensure_chart_account('NSSF payable', 'liability', 'UGX');
    adjustment_entry_id := public.insert_accounting_journal_entry(
      p_payment_date,
      'Payroll statutory accrual · ' || COALESCE(run_row.period, p_run_id::text),
      'UGX',
      'payroll_adjustment',
      p_run_id,
      auth.uid(),
      jsonb_build_array(
        jsonb_build_object(
          'chart_account_id', payroll_expense_id,
          'debit', totals.gross - totals.net, 'credit', 0,
          'description', 'Gross pay less net pay'
        ),
        jsonb_build_object(
          'chart_account_id', nssf_expense_id,
          'debit', totals.nssf_employer, 'credit', 0,
          'description', 'Employer NSSF expense'
        ),
        jsonb_build_object(
          'chart_account_id', paye_liability_id,
          'debit', 0, 'credit', totals.paye,
          'description', 'PAYE payable'
        ),
        jsonb_build_object(
          'chart_account_id', nssf_liability_id,
          'debit', 0, 'credit', totals.nssf_employee + totals.nssf_employer,
          'description', 'Employee and employer NSSF payable'
        )
      )
    );
  END IF;
  INSERT INTO public.payroll_run_postings (
    payroll_run_id, financial_transaction_id, adjustment_journal_entry_id,
    financial_account_id, payment_date, posted_by
  )
  VALUES (
    p_run_id, transaction_id, adjustment_entry_id,
    account_row.id, p_payment_date, auth.uid()
  );
  UPDATE public.payroll_runs SET status = 'paid' WHERE id = p_run_id;
  RETURN transaction_id;
END;
$$;

CREATE FUNCTION public.require_payroll_posting_before_paid()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'paid'
    AND NOT EXISTS (
      SELECT 1 FROM public.payroll_run_postings
      WHERE payroll_run_id = NEW.id
    )
  THEN
    RAISE EXCEPTION 'Payroll must be posted to a financial account before it can be marked paid.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payroll_runs_require_financial_posting
  BEFORE UPDATE OF status ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.require_payroll_posting_before_paid();

DROP POLICY IF EXISTS "Finance staff view financial transactions"
  ON public.financial_transactions;
CREATE POLICY "Verified finance staff view non-payroll transactions"
  ON public.financial_transactions FOR SELECT
  USING (
    (
      public.is_verified_finance_staff(auth.uid())
      AND payroll_run_id IS NULL
    )
  );
CREATE POLICY "Payroll staff view payroll transactions"
  ON public.financial_transactions FOR SELECT
  USING (
    payroll_run_id IS NOT NULL
    AND public.has_role(auth.uid(), 'hr'::public.app_role)
  );
CREATE POLICY "Verified administrators view payroll transactions"
  ON public.financial_transactions FOR SELECT
  USING (
    payroll_run_id IS NOT NULL
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.has_finance_mfa()
  );

DROP POLICY IF EXISTS "Finance staff view financial audit log"
  ON public.financial_audit_log;
CREATE FUNCTION public.is_payroll_financial_transaction(p_transaction_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.financial_transactions
    WHERE id = p_transaction_id AND payroll_run_id IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION public.is_payroll_financial_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_payroll_financial_transaction(uuid) TO authenticated;

CREATE POLICY "Verified finance staff view non-payroll financial audit"
  ON public.financial_audit_log FOR SELECT
  USING (
    public.is_verified_finance_staff(auth.uid())
    AND (
      table_name <> 'financial_transactions'
      OR NOT public.is_payroll_financial_transaction(record_id)
    )
  );
CREATE POLICY "Payroll staff view payroll financial audit"
  ON public.financial_audit_log FOR SELECT
  USING (
    table_name = 'financial_transactions'
    AND public.is_payroll_financial_transaction(record_id)
    AND (
      public.has_role(auth.uid(), 'hr'::public.app_role)
      OR (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        AND public.has_finance_mfa()
      )
    )
  );

DROP POLICY IF EXISTS "Verified finance staff view journals" ON public.journal_entries;
CREATE POLICY "Verified finance staff view non-payroll journals"
  ON public.journal_entries FOR SELECT
  USING (
    public.is_verified_finance_staff(auth.uid())
    AND source_type <> 'payroll_adjustment'
    AND NOT public.is_payroll_financial_transaction(source_id)
  );
CREATE POLICY "Payroll staff view payroll journals"
  ON public.journal_entries FOR SELECT
  USING (
    (
      source_type = 'payroll_adjustment'
      OR public.is_payroll_financial_transaction(source_id)
    )
    AND (
      public.has_role(auth.uid(), 'hr'::public.app_role)
      OR (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        AND public.has_finance_mfa()
      )
    )
  );

DROP POLICY IF EXISTS "Verified finance staff view journal lines" ON public.journal_lines;
CREATE POLICY "Verified finance staff view non-payroll journal lines"
  ON public.journal_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries AS entry
      WHERE entry.id = journal_entry_id
        AND (
          (
            public.is_verified_finance_staff(auth.uid())
            AND entry.source_type <> 'payroll_adjustment'
            AND NOT public.is_payroll_financial_transaction(entry.source_id)
          )
          OR (
            (
              entry.source_type = 'payroll_adjustment'
              OR public.is_payroll_financial_transaction(entry.source_id)
            )
            AND (
              public.has_role(auth.uid(), 'hr'::public.app_role)
              OR (
                public.has_role(auth.uid(), 'admin'::public.app_role)
                AND public.has_finance_mfa()
              )
            )
          )
        )
    )
  );

CREATE OR REPLACE VIEW public.financial_monthly_summary
WITH (security_invoker = false)
AS
WITH monthly_activity AS (
  SELECT
    date_trunc('month', transaction_date)::date AS period_start,
    currency,
    sum(amount) FILTER (WHERE transaction_type = 'income')::numeric(18, 2) AS income_amount,
    sum(amount) FILTER (WHERE transaction_type = 'expense')::numeric(18, 2) AS expense_amount,
    sum(amount_ugx) FILTER (WHERE transaction_type = 'income')::numeric(18, 2) AS income_ugx,
    sum(amount_ugx) FILTER (WHERE transaction_type = 'expense')::numeric(18, 2) AS expense_ugx
  FROM public.financial_transactions
  WHERE transaction_type IN ('income', 'expense')
    AND public.is_verified_finance_staff(auth.uid())
  GROUP BY date_trunc('month', transaction_date)::date, currency
  UNION ALL
  SELECT
    date_trunc('month', entry.entry_date)::date,
    entry.currency,
    sum(line.credit - line.debit) FILTER (WHERE account.account_type = 'income'),
    sum(line.debit - line.credit) FILTER (WHERE account.account_type = 'expense'),
    sum(line.credit - line.debit) FILTER (WHERE account.account_type = 'income'),
    sum(line.debit - line.credit) FILTER (WHERE account.account_type = 'expense')
  FROM public.journal_entries AS entry
  JOIN public.journal_lines AS line ON line.journal_entry_id = entry.id
  JOIN public.chart_of_accounts AS account ON account.id = line.chart_account_id
  WHERE entry.source_type IN ('payroll_adjustment', 'transfer_fx_difference')
    AND public.is_verified_finance_staff(auth.uid())
  GROUP BY date_trunc('month', entry.entry_date)::date, entry.currency
)
SELECT
  period_start,
  currency,
  sum(income_amount)::numeric(18, 2) AS income_amount,
  sum(expense_amount)::numeric(18, 2) AS expense_amount,
  sum(income_ugx)::numeric(18, 2) AS income_ugx,
  sum(expense_ugx)::numeric(18, 2) AS expense_ugx,
  (COALESCE(sum(income_ugx), 0) - COALESCE(sum(expense_ugx), 0))::numeric(18, 2)
    AS net_ugx
FROM monthly_activity
GROUP BY period_start, currency;

CREATE OR REPLACE VIEW public.financial_budget_vs_actual
WITH (security_invoker = false)
AS
WITH actual_items AS (
  SELECT
    date_trunc('month', transaction_date)::date AS period_start,
    category,
    project_id,
    currency,
    amount AS actual_amount
  FROM public.financial_transactions
  WHERE transaction_type = 'expense'
    AND public.is_verified_finance_staff(auth.uid())
  UNION ALL
  SELECT
    date_trunc('month', entry.entry_date)::date,
    account.name,
    NULL::uuid,
    entry.currency,
    sum(line.debit - line.credit)::numeric(18, 2)
  FROM public.journal_entries AS entry
  JOIN public.journal_lines AS line ON line.journal_entry_id = entry.id
  JOIN public.chart_of_accounts AS account ON account.id = line.chart_account_id
  WHERE entry.source_type IN ('payroll_adjustment', 'transfer_fx_difference')
    AND account.account_type = 'expense'
    AND public.is_verified_finance_staff(auth.uid())
  GROUP BY date_trunc('month', entry.entry_date)::date, account.name, entry.currency
),
actuals AS (
  SELECT period_start, category, project_id, currency, sum(actual_amount)::numeric(18, 2)
    AS actual_amount
  FROM actual_items
  GROUP BY period_start, category, project_id, currency
)
SELECT
  budget.id,
  COALESCE(budget.period_start, actuals.period_start) AS period_start,
  COALESCE(budget.category, actuals.category) AS category,
  COALESCE(budget.project_id, actuals.project_id) AS project_id,
  COALESCE(budget.currency, actuals.currency) AS currency,
  budget.planned_amount,
  COALESCE(actuals.actual_amount, 0)::numeric(18, 2) AS actual_amount,
  (budget.planned_amount - COALESCE(actuals.actual_amount, 0))::numeric(18, 2)
    AS remaining_amount,
  budget.status,
  budget.notes
FROM public.financial_budgets AS budget
FULL OUTER JOIN actuals
  ON actuals.period_start = budget.period_start
  AND lower(actuals.category) = lower(budget.category)
  AND actuals.project_id IS NOT DISTINCT FROM budget.project_id
  AND actuals.currency = budget.currency
WHERE public.is_verified_finance_staff(auth.uid());

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_category_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_account_ledger_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_run_postings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Verified finance staff view chart accounts"
  ON public.chart_of_accounts FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Verified finance staff view category mappings"
  ON public.accounting_category_mappings FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Verified finance staff view financial account mappings"
  ON public.financial_account_ledger_mappings FOR SELECT
  USING (public.is_verified_finance_staff(auth.uid()));
CREATE POLICY "Payroll staff view payroll postings"
  ON public.payroll_run_postings FOR SELECT
  USING (
    public.has_role(auth.uid(), 'hr'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      AND public.has_finance_mfa()
    )
  );

GRANT SELECT ON public.chart_of_accounts, public.accounting_category_mappings,
  public.financial_account_ledger_mappings, public.journal_entries,
  public.journal_lines, public.payroll_run_postings,
  public.accounting_account_balances, public.accounting_journal_summary
  TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.chart_of_accounts,
  public.accounting_category_mappings, public.financial_account_ledger_mappings,
  public.journal_entries, public.journal_lines, public.payroll_run_postings
  FROM authenticated;
REVOKE ALL ON FUNCTION public.ensure_chart_account(text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.insert_accounting_journal_entry(
  date, text, text, text, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_financial_transaction_to_ledger(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_cross_currency_transfer(
  uuid, uuid, date, numeric, numeric, numeric, date, text, numeric, date, text,
  numeric, text, text, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_payroll_run(uuid, uuid, date, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_cross_currency_transfer(
  uuid, uuid, date, numeric, numeric, numeric, date, text, numeric, date, text,
  numeric, text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_payroll_run(uuid, uuid, date, text, text)
  TO authenticated;
