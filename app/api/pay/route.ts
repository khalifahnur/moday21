import { z } from "zod";
import { currentGame } from "@/lib/time";
import { cleanName, logPhone, normalizePhone } from "@/lib/phone";
import { stkPush } from "@/lib/mpesa";
import { attachCheckout, checkLimits, ensureGame, markFailed, PayError, reconcileGame, reserveSpot } from "@/lib/spots";
import { BodyError, clientIp, isSameOrigin, json, readJson, verifyTurnstile } from "@/lib/security";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().max(100),
  phone: z.string().max(24),
  website: z.string().max(200).optional(), // honeypot: hidden from people, bots fill it in
  turnstileToken: z.string().max(4096).optional(),
});

// Holds a spot, then sends the M-Pesa PIN prompt to the phone.
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return json({ error: "Request blocked." }, 403);
  const ip = clientIp(req);

  let raw: unknown;
  try {
    raw = await readJson(req);
  } catch (err) {
    return json({ error: "Couldn’t read the request." }, err instanceof BodyError ? err.status : 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ error: "Couldn’t read the request." }, 400);
  if (parsed.data.website) return json({ error: "Couldn’t submit. Reload the page and try again." }, 400);

  const name = cleanName(parsed.data.name);
  if (!name) return json({ error: "Use 2 to 40 letters for your name.", field: "name" }, 400);
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return json({ error: "Enter a Safaricom number like 0712 345 678.", field: "phone" }, 400);

  try {
    if (!(await verifyTurnstile(parsed.data.turnstileToken, ip))) {
      return json({ error: "Couldn’t confirm you’re a person. Complete the check and try again." }, 403);
    }

    const game = await ensureGame(currentGame());
    await reconcileGame(game.id, 3).catch((e: Error) => console.warn("[pay] reconcile:", e.message));
    await checkLimits(phone, ip);
    const spot = await reserveSpot({ gameId: game.id, name, phone, ip });

    try {
      const push = await stkPush({
        phone,
        amount: spot.amount,
        reference: `MON21-${spot.slot}`,
        description: "Monday game",
      });
      await attachCheckout(spot.id, push.checkoutRequestId, push.merchantRequestId);
    } catch (err) {
      console.error(`[pay] STK push failed for ${logPhone(phone)}:`, (err as Error).message);
      await markFailed(spot.id, null, "STK push failed");
      return json({ error: "Couldn’t send the M-Pesa request. Try again in a moment." }, 502);
    }

    return json({ id: spot.id, slot: spot.slot, amount: spot.amount, gameId: game.id }, 201);
  } catch (err) {
    if (err instanceof PayError) return json({ error: err.message, field: err.field }, err.status);
    if ((err as { code?: string }).code === "23505") return json({ error: "That spot was just taken. Try again." }, 409);
    console.error("[pay]", (err as Error).message);
    return json({ error: "Something went wrong on our side. Try again in a moment." }, 500);
  }
}
