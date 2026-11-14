import { z } from "zod";
import { env } from "@/lib/env";
import { applyCallback } from "@/lib/spots";
import { clientIp, isSafaricomIp, json, safeEqual } from "@/lib/security";

export const runtime = "nodejs";

const Item = z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]).optional() });
const Callback = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().optional(),
      CheckoutRequestID: z.string().min(1).max(100),
      ResultCode: z.coerce.number(),
      ResultDesc: z.string().max(500).optional(),
      CallbackMetadata: z.object({ Item: z.array(Item).max(20) }).optional(),
    }),
  }),
});

const accepted = () => json({ ResultCode: 0, ResultDesc: "Accepted" });

// Safaricom posts the payment result here. The secret token in the URL keeps everyone else out.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let settings;
  try {
    settings = env();
  } catch {
    return new Response(null, { status: 503 });
  }
  if (!safeEqual(token, settings.MPESA_CALLBACK_TOKEN)) return new Response("Not found", { status: 404 });

  const ip = clientIp(req);
  if (settings.MPESA_CHECK_CALLBACK_IP === "true" && !isSafaricomIp(ip)) {
    console.warn(`[mpesa] callback from unlisted IP ${ip} rejected`);
    return new Response("Forbidden", { status: 403 });
  }

  const text = await req.text();
  if (text.length > 16_384) return new Response("Too large", { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return accepted();
  }
  const parsed = Callback.safeParse(raw);
  if (!parsed.success) {
    console.warn("[mpesa] callback with unexpected shape ignored");
    return accepted();
  }

  const cb = parsed.data.Body.stkCallback;
  const items = new Map((cb.CallbackMetadata?.Item ?? []).map((i) => [i.Name, i.Value]));
  const value = (k: string) => (items.get(k) === undefined ? null : String(items.get(k)));
  const amount = value("Amount");

  try {
    await applyCallback({
      checkoutRequestId: cb.CheckoutRequestID,
      resultCode: cb.ResultCode,
      resultDesc: cb.ResultDesc ?? "",
      amount: amount === null || Number.isNaN(Number(amount)) ? null : Number(amount),
      receipt: value("MpesaReceiptNumber"),
      phone: value("PhoneNumber"),
    });
  } catch (err) {
    console.error("[mpesa] callback processing failed:", (err as Error).message);
    return json({ ResultCode: 1, ResultDesc: "Temporary error" }, 500);
  }
  return accepted();
}
