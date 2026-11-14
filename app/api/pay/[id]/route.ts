import { db } from "@/lib/db";
import { failureMessage } from "@/lib/mpesa";
import { reconcileSpot, type SpotStatus } from "@/lib/spots";
import { json } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The payer's page polls this while waiting. The id is a random UUID only the payer has.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return json({ error: "Not found." }, 404);
  try {
    await reconcileSpot(id).catch((e: Error) => console.warn("[status] reconcile:", e.message));
    const [row] = await db()<{ status: SpotStatus; slot: number | null; receipt: string | null; result_code: number | null }[]>`
      select status, slot, receipt, result_code from spots where id = ${id}`;
    if (!row) return json({ error: "Not found." }, 404);

    const message =
      row.status === "failed" ? failureMessage(row.result_code)
      : row.status === "refund_due" ? "Your payment arrived after your spot was released. The organiser will refund you."
      : row.status === "removed" ? "The organiser removed this spot."
      : null;
    return json({
      status: row.status,
      slot: row.slot,
      receipt: row.status === "paid" ? row.receipt : null,
      message,
    });
  } catch (err) {
    console.error("[status]", (err as Error).message);
    return json({ error: "Couldn’t check the payment right now." }, 503);
  }
}
