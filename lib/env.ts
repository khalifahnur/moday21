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

export function env(): Env {
  if (cached) return cached;
  // Treat empty values in .env as "not set".
  const source = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]));
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const bad = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing or invalid environment variables: ${bad}`);
  }
  cached = parsed.data;
  return cached;
}
