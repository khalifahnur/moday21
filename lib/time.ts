import { GAME } from "./config";

// Kenya is UTC+3 all year (no daylight saving), so a fixed offset is exact.
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/** The next Monday game whose kickoff hasn't passed yet. */
export function currentGame(now = Date.now()) {
  const [h, m] = GAME.kickoff.split(":").map(Number);
  const local = new Date(now + EAT_OFFSET_MS);
  const daysToMonday = (1 - local.getUTCDay() + 7) % 7;
  let kickoff = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + daysToMonday, h, m) - EAT_OFFSET_MS;
  if (kickoff <= now) kickoff += 7 * DAY_MS;
  const k = new Date(kickoff + EAT_OFFSET_MS);
  return {
    id: `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`,
    kickoffAt: new Date(kickoff),
  };
}

/** Daraja wants YYYYMMDDHHmmss in Nairobi time. */
export function darajaTimestamp(now = Date.now()) {
  const d = new Date(now + EAT_OFFSET_MS);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
