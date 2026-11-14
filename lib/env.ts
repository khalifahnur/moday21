import { z } from "zod";

// Server-only secrets. Read lazily so `next build` works without them.
const schema = z.object({
  DATABASE_URL: z.string().min(1),

  MPESA_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  MPESA_CONSUMER_KEY: z.string().min(1),
  MPESA_CONSUMER_SECRET: z.string().min(1),
  MPESA_SHORTCODE: z.string().regex(/^\d{5,7}$/),
  MPESA_PASSKEY: z.string().min(1),
  MPESA_TRANSACTION_TYPE: z.enum(["CustomerPayBillOnline", "CustomerBuyGoodsOnline"]).default("CustomerPayBillOnline"),
  MPESA_PARTY_B: z.string().regex(/^\d{5,7}$/).optional(),
  MPESA_CALLBACK_BASE_URL: z.string().url().refine((u) => u.startsWith("https://"), "must be https"),
  MPESA_CALLBACK_TOKEN: z.string().min(32),
  MPESA_CHECK_CALLBACK_IP: z.enum(["true", "false"]).default("true"),
  MPESA_CALLBACK_IPS: z.string().optional(),
  MPESA_BASE_URL: z.string().url().optional(), // only for testing against a mock

  ADMIN_TOKEN: z.string().min(32),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  APP_ORIGIN: z.string().url().optional(),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

/**
 * Cleans a pasted value: trims spaces/newlines and strips one pair of wrapping quotes.
 * Empty values count as "not set". Hosting dashboards make stray spaces and quotes easy to paste.
 */
function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1).trim();
  return v === "" ? undefined : v;
}

const source = () => Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, clean(v)]));

/** Names (never values) of settings that are missing or invalid. Empty when everything is fine. */
export function envIssues(): string[] {
  const parsed = schema.safeParse(source());
  return parsed.success ? [] : [...new Set(parsed.error.issues.map((i) => i.path.join(".")))];
}

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(source());
  if (!parsed.success) {
    const bad = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Missing or invalid environment variables: ${bad}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Narrow readers for routes that only need one setting. They don't depend on the
 * M-Pesa settings, so the organiser page keeps working while payments are being set up.
 */
export function adminToken(): string | undefined {
  const t = clean(process.env.ADMIN_TOKEN);
  return t && t.length >= 32 ? t : undefined;
}

export function appOrigin(): string | undefined {
  const o = clean(process.env.APP_ORIGIN);
  if (!o) return undefined;
  try {
    return new URL(o).origin;
  } catch {
    return undefined;
  }
}

export function databaseUrl(): string {
  const u = clean(process.env.DATABASE_URL);
  if (!u) throw new Error("DATABASE_URL is not set");
  return u;
}
