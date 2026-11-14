import { db } from "@/lib/db";
import { currentGame } from "@/lib/time";
import { json, requireAdmin } from "@/lib/security";
import { envIssues } from "@/lib/env";
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
      // Names only, never values. Lets the organiser page say what still needs setting up.
      setup: envIssues(),
    });
  } catch (err) {
    const message = (err as Error).message;
    console.error("[admin]", message);
    // The caller is already signed in as the organiser, so a short reason is safe to show.
    const noDb = /DATABASE_URL/.test(message);
    const noTable = /relation .* does not exist/.test(message);
    return json(
      {
        error: noDb
          ? "DATABASE_URL isn’t set on the server."
          : noTable
            ? "The database tables are missing. Run db/schema.sql in your database."
            : "Couldn’t reach the database. Check DATABASE_URL.",
        setup: envIssues(),
      },
      503,
    );
  }
}
