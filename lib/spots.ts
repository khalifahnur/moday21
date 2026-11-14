import type postgres from "postgres";
import { db } from "./db";
import { GAME, LIMITS } from "./config";
import { stkQuery } from "./mpesa";
import { maskPhone, logPhone } from "./phone";

export type SpotStatus = "pending" | "paid" | "failed" | "removed" | "refund_due";

export class PayError extends Error {
  constructor(public status: number, message: string, public field?: "name" | "phone") {
    super(message);
  }
}

type GameRow = { id: string; kickoff_at: Date; capacity: number; price: number };

export const nameKey = (name: string) => name.toLowerCase();

/** Creates this week's game the first time anyone looks at it. Price and capacity are fixed per game. */
export async function ensureGame(g: { id: string; kickoffAt: Date }): Promise<GameRow> {
  const sql = db();
  await sql`
    insert into games (id, kickoff_at, capacity, price)
    values (${g.id}, ${g.kickoffAt}, ${GAME.capacity}, ${GAME.price})
    on conflict (id) do nothing`;
  const [row] = await sql<GameRow[]>`select id, kickoff_at, capacity, price from games where id = ${g.id}`;
  return row;
}

/** Stops STK-prompt spam: per phone, per IP, and one open request per phone at a time. */
export async function checkLimits(phone: string, ip: string) {
  const [r] = await db()<{ by_ip: number; by_phone: number; open: number }[]>`
    select
      count(*) filter (where ip = ${ip})::int                          as by_ip,
      count(*) filter (where phone = ${phone})::int                    as by_phone,
      count(*) filter (where phone = ${phone} and status = 'pending')::int as open
    from spots
    where created_at > now() - ${LIMITS.windowMinutes}::int * interval '1 minute'
      and (ip = ${ip} or phone = ${phone})`;
  if (r.open > 0) {
    throw new PayError(409, "There’s already an M-Pesa request open for this number. Finish or cancel it on the phone first.", "phone");
  }
  if (r.by_phone >= LIMITS.perPhone) {
    throw new PayError(429, "Too many payment requests for this number. Try again in a few minutes.", "phone");
  }
  if (ip !== "unknown" && r.by_ip >= LIMITS.perIp) {
    throw new PayError(429, "Too many payment requests from this connection. Try again in a few minutes.");
  }
}

/**
 * Takes the lowest free spot inside a transaction that locks the game row,
 * so two people paying at the same moment can never both get spot 21.
 */
export async function reserveSpot(input: { gameId: string; name: string; phone: string; ip: string }) {
  return db().begin(async (t) => {
    const tx = t as unknown as postgres.Sql;
    const [game] = await tx<GameRow[]>`select id, capacity, price from games where id = ${input.gameId} for update`;
    if (!game) throw new PayError(503, "This week’s game isn’t set up yet. Try again in a moment.");

    const [dup] = await tx`
      select 1 from spots
      where game_id = ${input.gameId} and phone = ${input.phone} and name_key = ${nameKey(input.name)}
        and status in ('pending', 'paid')
      limit 1`;
    if (dup) throw new PayError(409, `${input.name} is already on this Monday’s list with this number.`, "name");

    const used = new Set(
      (await tx<{ slot: number }[]>`select slot from spots where game_id = ${input.gameId} and slot is not null`).map((r) => r.slot),
    );
    let slot = 0;
    for (let n = 1; n <= game.capacity; n++) {
      if (!used.has(n)) {
        slot = n;
        break;
      }
    }
    if (!slot) throw new PayError(409, "This Monday’s game is full.");

    const [row] = await tx<{ id: string; slot: number; amount: number }[]>`
      insert into spots (game_id, slot, name, name_key, phone, amount, ip, held_until)
      values (${input.gameId}, ${slot}, ${input.name}, ${nameKey(input.name)}, ${input.phone}, ${game.price}, ${input.ip},
              now() + ${GAME.holdSeconds}::int * interval '1 second')
      returning id, slot, amount`;
    return row;
  });
}

export async function attachCheckout(id: string, checkoutRequestId: string, merchantRequestId: string | null) {
  await db()`
    update spots set checkout_request_id = ${checkoutRequestId}, merchant_request_id = ${merchantRequestId}, updated_at = now()
    where id = ${id}`;
}

/** Releases the spot. Only touches requests that are still pending. */
export async function markFailed(id: string, code: number | null, desc: string) {
  await db()`
    update spots set status = 'failed', slot = null, result_code = ${code}, result_desc = ${desc.slice(0, 200)}, updated_at = now()
    where id = ${id} and status = 'pending'`;
}

/** Confirms the spot. Returns false if it wasn't pending any more. */
async function markPaid(id: string, receipt: string | null, desc: string): Promise<boolean> {
  const rows = await db()`
    update spots set status = 'paid', paid_at = now(), receipt = coalesce(${receipt}, receipt),
           result_code = 0, result_desc = ${desc.slice(0, 200)}, updated_at = now()
    where id = ${id} and status = 'pending'
    returning id`;
  return rows.length > 0;
}

type PendingRow = { id: string; checkout_request_id: string | null; created_at: Date };

/**
 * Settles holds whose time ran out without a callback, by asking Safaricom directly.
 * Rows are claimed with SKIP LOCKED so parallel requests never query the same payment twice.
 */
export async function reconcileGame(gameId: string, limit = 3) {
  const rows = await db()<PendingRow[]>`
    update spots set held_until = now() + interval '20 seconds', updated_at = now()
    where id in (
      select id from spots
      where game_id = ${gameId} and status = 'pending' and held_until < now()
      order by held_until
      limit ${limit}
      for update skip locked)
    returning id, checkout_request_id, created_at`;
  await Promise.all(rows.map(resolvePending));
}

export async function reconcileSpot(id: string) {
  const rows = await db()<PendingRow[]>`
    update spots set held_until = now() + interval '20 seconds', updated_at = now()
    where id in (
      select id from spots where id = ${id} and status = 'pending' and held_until < now()
      for update skip locked)
    returning id, checkout_request_id, created_at`;
  await Promise.all(rows.map(resolvePending));
}

async function resolvePending(row: PendingRow) {
  if (!row.checkout_request_id) {
    await markFailed(row.id, null, "STK push was never sent");
    return;
  }
  let answer: Awaited<ReturnType<typeof stkQuery>> = null;
  try {
    answer = await stkQuery(row.checkout_request_id);
  } catch (err) {
    console.warn("[mpesa] status query failed", (err as Error).message);
  }
  if (answer && answer.resultCode === 0) {
    await markPaid(row.id, null, answer.resultDesc);
  } else if (answer) {
    await markFailed(row.id, answer.resultCode, answer.resultDesc);
  } else if (Date.now() - new Date(row.created_at).getTime() > GAME.maxPendingMinutes * 60_000) {
    await markFailed(row.id, null, "No answer from M-Pesa");
  }
}

type CallbackInput = {
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  amount: number | null;
  receipt: string | null;
  phone: string | null;
};

type SpotRow = { id: string; status: SpotStatus; amount: number; phone: string; checkout_request_id: string };

/** Applies Safaricom's callback. Safe to receive the same callback more than once. */
export async function applyCallback(cb: CallbackInput) {
  const sql = db();
  const find = async () =>
    (await sql<SpotRow[]>`
      select id, status, amount, phone, checkout_request_id from spots
      where checkout_request_id = ${cb.checkoutRequestId}`)[0];

  let spot = await find();
  if (!spot) {
    await new Promise((r) => setTimeout(r, 1500)); // the push reply may still be saving
    spot = await find();
  }
  if (!spot) {
    console.warn("[mpesa] callback for unknown request ignored");
    return;
  }

  if (cb.resultCode !== 0) {
    await markFailed(spot.id, cb.resultCode, cb.resultDesc);
    return;
  }

  // Success claims are checked before anyone is marked as paid.
  if (!cb.receipt || !/^[A-Z0-9]{8,12}$/.test(cb.receipt)) {
    console.warn("[mpesa] success callback without a valid receipt ignored");
    return;
  }
  if (cb.amount === null || cb.amount < spot.amount) {
    console.warn(`[mpesa] amount mismatch for ${logPhone(spot.phone)}: got ${cb.amount}, expected ${spot.amount}`);
    return;
  }
  if (cb.phone && /^\d{12}$/.test(cb.phone) && cb.phone !== spot.phone) {
    console.warn(`[mpesa] phone mismatch for ${logPhone(spot.phone)}`);
    return;
  }
  // Second opinion straight from Safaricom, so a forged callback can't mark anyone as paid.
  try {
    const answer = await stkQuery(spot.checkout_request_id);
    if (answer && answer.resultCode !== 0) {
      console.warn("[mpesa] callback said paid but status query disagrees; ignored");
      await markFailed(spot.id, answer.resultCode, answer.resultDesc);
      return;
    }
  } catch {
    /* query unavailable: the secret URL, IP check and matching request ID still apply */
  }

  try {
    if (await markPaid(spot.id, cb.receipt, cb.resultDesc)) return;
    // Already settled: fill in the receipt, or flag a refund if the spot had been released.
    await sql`
      update spots set
        receipt = coalesce(receipt, ${cb.receipt}),
        status = case when status in ('failed', 'removed') then 'refund_due' else status end,
        updated_at = now()
      where id = ${spot.id}`;
  } catch (err) {
    // Unique receipt constraint: the same receipt was already used. Treat as a replay.
    console.warn("[mpesa] receipt already recorded; ignored", (err as Error).message);
  }
}

export type PublicSpot = { slot: number; name: string; phone: string; status: "pending" | "paid"; paidAt: string | null };

/** What every visitor sees: names and masked numbers only. */
export async function publicRoster(gameId: string): Promise<PublicSpot[]> {
  const rows = await db()<{ slot: number; name: string; phone: string; status: SpotStatus; paid_at: Date | null }[]>`
    select slot, name, phone, status, paid_at from spots
    where game_id = ${gameId} and slot is not null
    order by slot`;
  return rows.map((r) => ({
    slot: r.slot,
    name: r.name,
    phone: maskPhone(r.phone),
    status: r.status === "paid" ? "paid" : "pending",
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
  }));
}
