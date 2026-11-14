import { GAME } from "@/lib/config";
import { currentGame } from "@/lib/time";
import { ensureGame, publicRoster, reconcileGame } from "@/lib/spots";
import { json } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public: this week's game and who's on the list (names and masked numbers only).
export async function GET() {
  try {
    const game = await ensureGame(currentGame());
    await reconcileGame(game.id, 2).catch((e: Error) => console.warn("[game] reconcile:", e.message));
    const spots = await publicRoster(game.id);
    return json({
      game: {
        id: game.id,
        kickoffAt: new Date(game.kickoff_at).toISOString(),
        capacity: game.capacity,
        price: game.price,
        venue: GAME.venue,
      },
      spots,
    });
  } catch (err) {
    console.error("[game]", (err as Error).message);
    return json({ error: "The list isn’t available right now." }, 503);
  }
}
