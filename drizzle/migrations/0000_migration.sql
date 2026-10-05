create type public.app_role as enum ('admin','hr');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;

create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role in ('admin','hr')) $$;

create policy "Users see own roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

-- First user becomes admin
create or replace function public.handle_new_user_role()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.user_roles) then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  end if;
  return new;
end; $$;
create trigger on_auth_user_created_role after insert on auth.users
for each row execute function public.handle_new_user_role();

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_no text not null unique,
  full_name text not null,
  position text not null,
  department text not null,
  phone text,
  bank_name text,
  account_no text,
  nssf_no text,
  base_salary numeric(14,2) not null default 0,
  allowances numeric(14,2) not null default 0,
  status text not null default 'active',
  hired_on date not null default current_date,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.employees to authenticated;
grant all on public.employees to service_role;
alter table public.employees enable row level security;
create policy "Staff manage employees" on public.employees for all to authenticated
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period text not null unique,
  status text not null default 'draft',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.payroll_runs to authenticated;
grant all on public.payroll_runs to service_role;
alter table public.payroll_runs enable row level security;
create policy "Staff manage runs" on public.payroll_runs for all to authenticated
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  gross numeric(14,2) not null,
  paye numeric(14,2) not null,
  nssf_employee numeric(14,2) not null,
  nssf_employer numeric(14,2) not null,
  net numeric(14,2) not null,
  created_at timestamptz not null default now(),
  unique (run_id, employee_id)
);
grant select, insert, update, delete on public.payslips to authenticated;
grant all on public.payslips to service_role;
alter table public.payslips enable row level security;
create policy "Staff manage payslips" on public.payslips for all to authenticated
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));