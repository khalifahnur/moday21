import { db } from "@/lib/db";
import { currentGame } from "@/lib/time";
import { json, requireAdmin } from "@/lib/security";
import type { SpotStatus } from "@/lib/spots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Organiser view: full numbers and receipts, for refunds and disputes.
export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const param = new URL(req.url).searchParams.get("game");
  const gameId = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : currentGame().id;
  try {
    const rows = await db()<{
      id: string; slot: number | null; name: string; phone: string; status: SpotStatus; amount: number;
      receipt: string | null; result_desc: string | null; created_at: Date; paid_at: Date | null;
    }[]>`
      select id, slot, name, phone, status, amount, receipt, result_desc, created_at, paid_at
      from spots where game_id = ${gameId} order by created_at`;
    return json({
      gameId,
      spots: rows.map((r) => ({
        id: r.id,
        slot: r.slot,
        name: r.name,
        phone: "0" + r.phone.slice(3),
        status: r.status,
        amount: r.amount,
        receipt: r.receipt,
        note: r.result_desc,
        createdAt: new Date(r.created_at).toISOString(),
        paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
      })),
    });
  } catch (err) {
    console.error("[admin]", (err as Error).message);
    return json({ error: "Couldn’t load the list." }, 503);
  }
}
