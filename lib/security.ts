import { createHash, timingSafeEqual } from "node:crypto";
import { adminToken, appOrigin, env } from "./env";

/** JSON response that is never cached by browsers or CDNs. */
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

/** Reads a small JSON body. Rejects other content types and oversized bodies. */
export async function readJson(req: Request, maxBytes = 4096): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new BodyError(415);
  const text = await req.text();
  if (text.length > maxBytes) throw new BodyError(413);
  try {
    return JSON.parse(text);
  } catch {
    throw new BodyError(400);
  }
}
export class BodyError extends Error {
  constructor(public status: number) {
    super("Bad request body");
  }
}

/**
 * The caller's IP. Trust these headers only behind a proxy that sets them
 * (Vercel, Netlify, Cloudflare, or your own Nginx with proxy_set_header).
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim().slice(0, 64);
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 64);
  return "unknown";
}

/** Blocks cross-site form posts and scripts on other sites calling our API from a browser. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = appOrigin();
  if (allowed) return origin === allowed;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Constant-time string comparison, safe for secrets of any length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Admin routes require `Authorization: Bearer <ADMIN_TOKEN>`. Returns an error response or null. */
export async function requireAdmin(req: Request): Promise<Response | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const expected = adminToken();
  if (!expected) {
    return json({ error: "ADMIN_TOKEN isn’t set on the server, or it’s shorter than 32 characters. Fix it in your hosting settings and redeploy." }, 503);
  }
  if (token && safeEqual(token, expected)) return null;
  await sleep(400 + Math.random() * 400); // slows down guessing
  return json({ error: "Wrong admin password." }, 401);
}

// Safaricom's published callback addresses. Override with MPESA_CALLBACK_IPS if they change.
const SAFARICOM_IPS = [
  "196.201.214.200", "196.201.214.206", "196.201.213.114", "196.201.214.207",
  "196.201.214.208", "196.201.213.44", "196.201.212.127", "196.201.212.138",
  "196.201.212.129", "196.201.212.136", "196.201.212.74", "196.201.212.69",
];

export function isSafaricomIp(ip: string): boolean {
  const custom = env().MPESA_CALLBACK_IPS;
  const list = custom ? custom.split(",").map((s) => s.trim()).filter(Boolean) : SAFARICOM_IPS;
  return list.includes(ip.replace(/^::ffff:/, ""));
}

/** Cloudflare Turnstile check. Skipped when TURNSTILE_SECRET_KEY isn't set. */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = env().TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
