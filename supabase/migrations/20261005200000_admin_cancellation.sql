ALTER TABLE public.payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_status_check,
  ADD CONSTRAINT payroll_runs_status_check
    CHECK (status IN ('draft', 'paid', 'cancelled')),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES auth.users (id);

ALTER TABLE public.attendance_logs
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES auth.users (id);

DROP INDEX IF EXISTS public.payroll_runs_week_range_unique;
CREATE UNIQUE INDEX payroll_runs_week_range_unique
  ON public.payroll_runs (period_start, period_end)
  WHERE run_type = 'weekly' AND period_start IS NOT NULL AND status <> 'cancelled';

CREATE FUNCTION public.admin_cancel_payroll_run(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an administrator can cancel a payroll run.';
  END IF;

  UPDATE public.payroll_runs
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid()
  WHERE id = p_run_id
    AND status IN ('draft', 'paid');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run was not found or has already been cancelled.';
  END IF;
END;
$$;

CREATE FUNCTION public.admin_cancel_manual_attendance(p_log_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an administrator can cancel a manual attendance mark.';
  END IF;

  UPDATE public.attendance_logs
  SET cancelled_at = now(),
      cancelled_by = auth.uid()
  WHERE id = p_log_id
    AND event_type = 'manual_attendance'
    AND device_serial = 'MANUAL'
    AND cancelled_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manual attendance mark was not found or has already been cancelled.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_payroll_run(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_cancel_manual_attendance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_payroll_run(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_manual_attendance(uuid) TO authenticated;
