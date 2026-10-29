import { createClient } from "npm:@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json" };
const dayMs = 24 * 60 * 60 * 1000;

function getKampalaDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const jobSecret = Deno.env.get("CONTRACT_JOB_SECRET");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!jobSecret || !resendApiKey || !fromEmail || !supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Contract email service is not configured." }), {
      status: 503,
      headers: jsonHeaders,
    });
  }
  if (request.headers.get("x-contract-job-secret") !== jobSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const today = getKampalaDate();
  const cutoff = addDays(today, 30);
  const { data: contracts, error: contractsError } = await supabase
    .from("employee_contracts")
    .select("id, end_date, contract_type, employees(full_name, employee_no)")
    .eq("status", "active")
    .gte("end_date", today)
    .lte("end_date", cutoff);
  if (contractsError) throw contractsError;
  if (!contracts.length) {
    return new Response(JSON.stringify({ sent: 0 }), { headers: jsonHeaders });
  }

  const { data: roles, error: rolesError } = await supabase
    .from("user_roles")
    .select("user_id")
    .in("role", ["admin", "hr"]);
  if (rolesError) throw rolesError;
  const userIds = [...new Set(roles.map((role) => role.user_id))];
  if (!userIds.length) {
    return new Response(JSON.stringify({ sent: 0, reason: "No HR or administrator accounts." }), {
      headers: jsonHeaders,
    });
  }

  const contractIds = contracts.map((contract) => contract.id);
  const { data: sentLogs, error: logError } = await supabase
    .from("contract_expiry_email_log")
    .select("contract_id, contract_end_date, recipient_user_id")
    .in("contract_id", contractIds)
    .in("recipient_user_id", userIds);
  if (logError) throw logError;
  const alreadySent = new Set(
    sentLogs.map((log) => `${log.contract_id}:${log.contract_end_date}:${log.recipient_user_id}`),
  );

  let sent = 0;
  for (const userId of userIds) {
    const { data: userResult, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError) throw userError;
    const email = userResult.user.email;
    if (!email) {
      console.error(`Skipping contract email reminders for HR user ${userId}: no email address.`);
      continue;
    }

    for (const contract of contracts) {
      const logKey = `${contract.id}:${contract.end_date}:${userId}`;
      if (alreadySent.has(logKey)) continue;

      const employee = contract.employees;
      const employeeName = employee?.full_name ?? "Employee";
      const employeeNumber = employee?.employee_no ?? "—";
      const endDate = contract.end_date;
      const subject = `Contract expiry reminder: ${employeeName}`;
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [email],
          subject,
          html: `<p>This is a reminder that <strong>${escapeHtml(employeeName)}</strong> (${escapeHtml(employeeNumber)}) has an active employment contract expiring on <strong>${escapeHtml(endDate)}</strong>.</p><p>Please review the contract in BMP Media Production before it expires.</p>`,
        }),
      });
      if (!response.ok) {
        throw new Error(`Resend failed for HR user ${userId}: ${await response.text()}`);
      }

      const { error: insertError } = await supabase.from("contract_expiry_email_log").insert({
        contract_id: contract.id,
        contract_end_date: contract.end_date,
        recipient_user_id: userId,
      });
      if (insertError) throw insertError;
      alreadySent.add(logKey);
      sent += 1;
    }
  }

  return new Response(JSON.stringify({ sent, window: { from: today, through: cutoff } }), {
    headers: jsonHeaders,
  });
});
