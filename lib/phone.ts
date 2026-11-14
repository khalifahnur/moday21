/** Accepts 07.., 01.., 7.., +2547.., 2547.. and returns 2547XXXXXXXX / 2541XXXXXXXX, or null. */
export function normalizePhone(raw: string): string | null {
  let s = String(raw).replace(/[\s\-().]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (/^0[17]\d{8}$/.test(s)) s = "254" + s.slice(1);
  else if (/^[17]\d{8}$/.test(s)) s = "254" + s;
  return /^254[17]\d{8}$/.test(s) ? s : null;
}

const local = (p: string) => "0" + p.slice(3);

/** 0712 ••• 678 — the only form other players ever see. */
export const maskPhone = (p: string) => `${local(p).slice(0, 4)} ••• ${local(p).slice(7)}`;

/** For logs: keeps just enough to trace a problem. */
export const logPhone = (p: string) => `${p.slice(0, 6)}****${p.slice(-2)}`;

/** Letters (any language), spaces, apostrophes, hyphens and dots; 2–40 characters. */
export function cleanName(raw: string): string | null {
  const name = String(raw).normalize("NFKC").replace(/\s+/g, " ").trim();
  return /^[\p{L}\p{M}][\p{L}\p{M}0-9 .'’-]{1,39}$/u.test(name) ? name : null;
}
