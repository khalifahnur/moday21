// Game settings. Change them with environment variables (see .env.example).
const int = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const kickoff = process.env.GAME_KICKOFF ?? "";

export const GAME = {
  capacity: int(process.env.GAME_CAPACITY, 21),
  price: int(process.env.GAME_PRICE, 300),
  kickoff: /^([01]?\d|2[0-3]):[0-5]\d$/.test(kickoff) ? kickoff : "19:00", // Monday, Nairobi time
  venue: process.env.GAME_VENUE || "Astro Turf, Pitch 2",
  holdSeconds: 180, // a spot is held this long while its M-Pesa request is open
  maxPendingMinutes: 15, // after this, an unanswered request is given up
};

// Abuse limits for payment requests, per rolling window.
export const LIMITS = {
  windowMinutes: 10,
  perIp: 6,
  perPhone: 3,
};
