import { env } from "./env";
import { darajaTimestamp } from "./time";

export class MpesaError extends Error {}

const baseUrl = () =>
  env().MPESA_BASE_URL ??
  (env().MPESA_ENV === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke");

export const callbackUrl = () =>
  `${env().MPESA_CALLBACK_BASE_URL.replace(/\/+$/, "")}/api/mpesa/callback/${env().MPESA_CALLBACK_TOKEN}`;

// Access tokens last an hour; reuse one per server instance.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const { MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET } = env();
  const basic = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString("base64");
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new MpesaError(`Daraja sign-in failed (${res.status})`);
  const data = (await res.json()) as { access_token?: string; expires_in?: string | number };
  if (!data.access_token) throw new MpesaError("Daraja sign-in returned no token");
  cachedToken = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3599) * 1000 };
  return cachedToken.value;
}

type DarajaReply = Record<string, unknown>;

async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; data: DarajaReply }> {
  const token = await accessToken();
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) cachedToken = null;
  let data: DarajaReply = {};
  try {
    data = (await res.json()) as DarajaReply;
  } catch {
    /* empty or non-JSON reply */
  }
  return { status: res.status, data };
}

function credentials() {
  const e = env();
  const timestamp = darajaTimestamp();
  const password = Buffer.from(e.MPESA_SHORTCODE + e.MPESA_PASSKEY + timestamp).toString("base64");
  return { BusinessShortCode: e.MPESA_SHORTCODE, Password: password, Timestamp: timestamp };
}

/** Sends the PIN prompt to the customer's phone. */
export async function stkPush(input: { phone: string; amount: number; reference: string; description: string }) {
  const e = env();
  const { status, data } = await post("/mpesa/stkpush/v1/processrequest", {
    ...credentials(),
    TransactionType: e.MPESA_TRANSACTION_TYPE,
    Amount: input.amount,
    PartyA: input.phone,
    PartyB: e.MPESA_PARTY_B ?? e.MPESA_SHORTCODE,
    PhoneNumber: input.phone,
    CallBackURL: callbackUrl(),
    AccountReference: input.reference.slice(0, 12),
    TransactionDesc: input.description.slice(0, 13),
  });
  if (status !== 200 || String(data.ResponseCode) !== "0" || typeof data.CheckoutRequestID !== "string") {
    throw new MpesaError(String(data.errorMessage ?? data.ResponseDescription ?? `STK push failed (${status})`));
  }
  return {
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: typeof data.MerchantRequestID === "string" ? data.MerchantRequestID : null,
  };
}

/**
 * Asks Safaricom directly how a request ended.
 * Returns null while it's still being processed or when the answer is unclear.
 */
export async function stkQuery(checkoutRequestId: string): Promise<{ resultCode: number; resultDesc: string } | null> {
  const { data } = await post("/mpesa/stkpushquery/v1/query", {
    ...credentials(),
    CheckoutRequestID: checkoutRequestId,
  });
  if (data.ResultCode === undefined || data.ResultCode === null || data.ResultCode === "") return null;
  const resultCode = Number(data.ResultCode);
  if (!Number.isFinite(resultCode) || resultCode === 4999) return null; // 4999: still processing
  return { resultCode, resultDesc: String(data.ResultDesc ?? "") };
}

/** Plain-language reason for a failed payment, shown to the player. */
export function failureMessage(code: number | null | undefined): string {
  switch (code) {
    case 1032:
      return "The M-Pesa request was cancelled on the phone.";
    case 1037:
      return "The phone didn’t respond to the M-Pesa request. Check it’s on and has signal, then try again.";
    case 1:
      return "The M-Pesa balance was too low for this payment.";
    case 2001:
      return "The M-Pesa PIN was wrong.";
    case 1019:
      return "The M-Pesa request expired before it was completed.";
    case 1001:
      return "Another M-Pesa payment was in progress on this phone. Wait a minute, then try again.";
    default:
      return "The payment didn’t go through.";
  }
}
