// Django API client. Replaces the hosted Supabase client while keeping the
// call sites in this application unchanged.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const TOKEN_KEY = "bmp.auth.token";
const USER_KEY = "bmp.auth.user";

const API_BASE =
  import.meta.env["VITE_API_BASE_URL"] ||
  (typeof window === "undefined" ? "http://127.0.0.1:8000" : "");

type Listener = (event: string, session: any) => void;
const listeners = new Set<Listener>();

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

function readUser(): any {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(token: string | null, user: any) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
  if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(USER_KEY);
}

function currentSession() {
  const token = readToken();
  if (!token) return null;
  return { access_token: token, token_type: "bearer", user: readUser() };
}

function emit(event: string, session: any = currentSession()) {
  listeners.forEach((listener) => {
    try {
      listener(event, session);
    } catch (error) {
      console.error(error);
    }
  });
}

function authHeaders(extra: Record<string, string> = {}) {
  const token = readToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function request(path: string, init: RequestInit = {}) {
  const headers = authHeaders({
    ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...((init.headers as Record<string, string>) || {}),
  });
  const response = await fetch(`${API_BASE}/api${path}`, { ...init, headers });
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

function errorFrom(response: Response, payload: any) {
  if (payload && payload.error) return payload.error;
  return { message: `Request failed (${response.status}).` };
}

function encodePath(path: string) {
  return String(path)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

type Filter = { op: string; column?: string; value?: any; filter?: Filter; filters?: Filter[] };

function normalizeInValue(value: any) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "");
    }
  }
  return value;
}

function makeFilter(column: string, op: string, value: any): Filter {
  if (op === "in" || op === "not.in") return { op: "in", column, value: normalizeInValue(value) };
  return { op, column, value };
}

function parseOr(expression: string): Filter {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of expression) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return {
    op: "or",
    filters: parts
      .map((part) => {
        const [column, operator, ...rest] = part.split(".");
        if (!column || !operator) return null;
        return makeFilter(column, operator, rest.join("."));
      })
      .filter((filter): filter is Filter => Boolean(filter?.column)),
  };
}

class QueryBuilder {
  table: string;
  body: any;
  shape: "single" | "maybeSingle" | null = null;

  constructor(table: string) {
    this.table = table;
    this.body = { action: "select", filters: [], order: [], select: "*" };
  }

  select(columns = "*", _options?: any) {
    this.body.select = columns || "*";
    if (this.body.action !== "select") this.body.returning = true;
    return this;
  }

  insert(values: any) {
    this.body.action = "insert";
    this.body.payload = values;
    return this;
  }

  update(values: any) {
    this.body.action = "update";
    this.body.payload = values;
    return this;
  }

  upsert(values: any, options?: any) {
    this.body.action = "upsert";
    this.body.payload = values;
    if (options?.onConflict) this.body.on_conflict = options.onConflict;
    return this;
  }

  delete() {
    this.body.action = "delete";
    return this;
  }

  private add(filter: Filter) {
    this.body.filters.push(filter);
    return this;
  }

  eq(column: string, value: any) {
    return this.add(makeFilter(column, "eq", value));
  }
  neq(column: string, value: any) {
    return this.add(makeFilter(column, "neq", value));
  }
  gt(column: string, value: any) {
    return this.add(makeFilter(column, "gt", value));
  }
  gte(column: string, value: any) {
    return this.add(makeFilter(column, "gte", value));
  }
  lt(column: string, value: any) {
    return this.add(makeFilter(column, "lt", value));
  }
  lte(column: string, value: any) {
    return this.add(makeFilter(column, "lte", value));
  }
  like(column: string, value: any) {
    return this.add(makeFilter(column, "like", value));
  }
  ilike(column: string, value: any) {
    return this.add(makeFilter(column, "ilike", value));
  }
  is(column: string, value: any) {
    return this.add(makeFilter(column, "is", value));
  }
  in(column: string, value: any) {
    return this.add(makeFilter(column, "in", value));
  }
  contains(column: string, value: any) {
    return this.add(makeFilter(column, "contains", value));
  }
  filter(column: string, operator: string, value: any) {
    return this.add(makeFilter(column, operator, value));
  }
  match(values: Record<string, any>) {
    Object.entries(values).forEach(([column, value]) => this.add(makeFilter(column, "eq", value)));
    return this;
  }
  not(column: string, operator: string, value: any) {
    return this.add({ op: "not", filter: makeFilter(column, operator, value) });
  }
  or(expression: string) {
    return this.add(parseOr(expression));
  }
  order(column: string, options: any = {}) {
    this.body.order.push({
      column,
      ascending: options.ascending !== false,
      nulls_first: options.nullsFirst,
    });
    return this;
  }
  limit(count: number) {
    this.body.limit = count;
    return this;
  }
  range(from: number, to: number) {
    this.body.offset = from;
    this.body.limit = to - from + 1;
    return this;
  }
  single() {
    this.shape = "single";
    return this;
  }
  maybeSingle() {
    this.shape = "maybeSingle";
    return this;
  }

  async execute() {
    this.body.single = this.shape === "single";
    this.body.maybe_single = this.shape === "maybeSingle";
    if (this.body.action === "select") this.body.returning = true;
    const { response, payload } = await request(`/db/${encodeURIComponent(this.table)}`, {
      method: "POST",
      body: JSON.stringify(this.body),
    });
    if (!response.ok) {
      return { data: null, error: errorFrom(response, payload), status: response.status };
    }
    return {
      data: payload?.data ?? null,
      error: payload?.error ?? null,
      status: response.status,
    };
  }

  then(onFulfilled?: any, onRejected?: any) {
    return this.execute().then(onFulfilled, onRejected);
  }
}

async function fetchUser() {
  const { response, payload } = await request("/auth/me");
  if (!response.ok) {
    if (response.status === 401) writeSession(null, null);
    return { user: null, error: errorFrom(response, payload) };
  }
  const user = payload.user;
  const token = readToken();
  if (token) writeSession(token, user);
  return { user, error: null };
}

const auth: any = {
  async signInWithPassword({ email, password }: any) {
    const { response, payload } = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      return { data: { user: null, session: null }, error: errorFrom(response, payload) };
    }
    writeSession(payload.access_token, payload.user);
    const session = currentSession();
    emit("SIGNED_IN", session);
    return { data: { user: payload.user, session }, error: null };
  },

  async signOut() {
    try {
      await request("/auth/logout", { method: "POST" });
    } finally {
      writeSession(null, null);
      emit("SIGNED_OUT", null);
    }
    return { error: null };
  },

  async getSession() {
    const token = readToken();
    if (!token) return { data: { session: null }, error: null };
    let user = readUser();
    if (!user) {
      const result = await fetchUser();
      if (result.error) return { data: { session: null }, error: null };
      user = result.user;
    }
    return { data: { session: currentSession() }, error: null };
  },

  async getUser() {
    const token = readToken();
    if (!token) return { data: { user: null }, error: null };
    const result = await fetchUser();
    return { data: { user: result.user }, error: result.error };
  },

  async updateUser(attributes: any) {
    const body: any = {};
    if (attributes?.email) body.email = attributes.email;
    if (attributes?.password) body.password = attributes.password;
    if (attributes?.data) body.data = attributes.data;
    const { response, payload } = await request("/auth/user", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return { data: { user: readUser() }, error: errorFrom(response, payload) };
    }
    writeSession(readToken(), payload.user);
    emit("USER_UPDATED", currentSession());
    return { data: { user: payload.user }, error: null };
  },

  async getClaims() {
    const { data } = await auth.getSession();
    return { data: { claims: data.session ? {} : null }, error: null };
  },

  async setSession(session: any) {
    if (session?.access_token) writeSession(session.access_token, session.user || null);
    return { data: { session: currentSession() }, error: null };
  },

  onAuthStateChange(callback: Listener) {
    listeners.add(callback);
    setTimeout(() => callback("INITIAL_SESSION", currentSession()), 0);
    return {
      data: {
        subscription: {
          unsubscribe: () => listeners.delete(callback),
        },
      },
    };
  },

  mfa: {
    async listFactors() {
      const { response, payload } = await request("/auth/mfa/factors");
      if (!response.ok) return { data: null, error: errorFrom(response, payload) };
      return { data: payload, error: null };
    },
    async getAuthenticatorAssuranceLevel() {
      const { response, payload } = await request("/auth/mfa/aal");
      if (!response.ok) return { data: null, error: errorFrom(response, payload) };
      return { data: payload, error: null };
    },
    async enroll({ factorType, friendlyName }: any) {
      const { response, payload } = await request("/auth/mfa/enroll", {
        method: "POST",
        body: JSON.stringify({ factor_type: factorType, friendly_name: friendlyName }),
      });
      if (!response.ok) return { data: null, error: errorFrom(response, payload) };
      return { data: payload, error: null };
    },
    async challengeAndVerify({ factorId, code }: any) {
      const { response, payload } = await request("/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ factor_id: factorId, code }),
      });
      if (!response.ok) return { data: null, error: errorFrom(response, payload) };
      return { data: payload, error: null };
    },
    async unenroll({ factorId }: any) {
      const { response, payload } = await request(`/auth/mfa/factors/${factorId}`, {
        method: "DELETE",
      });
      if (!response.ok) return { data: null, error: errorFrom(response, payload) };
      return { data: payload, error: null };
    },
  },
};

const storage: any = {
  from(bucket: string) {
    return {
      async upload(path: string, file: File, _options?: any) {
        const form = new FormData();
        form.append("file", file, file.name || path.split("/").pop() || "upload");
        const { response, payload } = await request(
          `/storage/${encodeURIComponent(bucket)}/${encodePath(path)}`,
          { method: "POST", body: form },
        );
        if (!response.ok) return { data: null, error: errorFrom(response, payload) };
        return { data: payload.data, error: null };
      },
      async createSignedUrl(path: string, expiresIn = 300) {
        const { response, payload } = await request(`/storage/${encodeURIComponent(bucket)}/sign`, {
          method: "POST",
          body: JSON.stringify({ path, expires_in: expiresIn }),
        });
        if (!response.ok) return { data: null, error: errorFrom(response, payload) };
        return { data: payload.data, error: null };
      },
      async remove(_paths: string[]) {
        return { data: null, error: null };
      },
    };
  },
};

const client: any = {
  from: (table: string) => new QueryBuilder(table),
  rpc: async (name: string, args: Record<string, any> = {}) => {
    const { response, payload } = await request(`/rpc/${encodeURIComponent(name)}`, {
      method: "POST",
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      return { data: null, error: errorFrom(response, payload), status: response.status };
    }
    return { data: payload?.data ?? null, error: payload?.error ?? null, status: response.status };
  },
  auth,
  storage,
  channel: () => ({
    on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
    subscribe: () => ({ unsubscribe: () => {} }),
    unsubscribe: () => {},
  }),
  removeChannel: () => {},
};

export const supabase = client as unknown as SupabaseClient<Database>;
