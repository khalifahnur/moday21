import { db } from "@/lib/db";
import { isSameOrigin, json, requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Organiser removes a player (for example after a refund). Frees the spot.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return json({ error: "Request blocked." }, 403);
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  if (!UUID.test(id)) return json({ error: "Not found." }, 404);
  try {
    const rows = await db()`
      update spots set status = 'removed', slot = null, updated_at = now()
      where id = ${id} and status in ('pending', 'paid')
      returning id`;
    if (!rows.length) return json({ error: "That player isn’t on the list." }, 404);
    console.info(`[admin] removed spot ${id}`);
    return json({ ok: true });
  } catch (err) {
    console.error("[admin]", (err as Error).message);
    return json({ error: "Couldn’t remove the player." }, 503);
  }
}
