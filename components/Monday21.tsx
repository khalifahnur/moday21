"use client";

import Script from "next/script";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { cleanName, normalizePhone } from "@/lib/phone";

type Spot = { slot: number; name: string; phone: string; status: "pending" | "paid"; paidAt: string | null };
type Game = { id: string; kickoffAt: string; capacity: number; price: number; venue: string };
type Waiting = { step: "waiting"; id: string; slot: number; phone: string; name: string; gameId: string; startedAt: number };
type Flow =
  | { step: "form" }
  | Waiting
  | { step: "success"; slot: number; name: string; receipt: string | null }
  | { step: "failed"; slot: number; message: string };
type Errors = { name?: string; phone?: string; form?: string };
type Mine = { slot: number; name: string };

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

const TZ = "Africa/Nairobi";
const STK_WAIT_SECONDS = 60;
const PENDING_KEY = "monday21:pending";
const ME_KEY = "monday21:me";
const mineKey = (gameId: string) => `monday21:mine:${gameId}`;

const money = (n: number) => `KES ${n.toLocaleString("en-KE")}`;
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).toLowerCase();
const dateKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const isToday = (iso: string) => dateKey(new Date(iso)) === dateKey(new Date());
const prettyPhone = (p: string) => {
  const l = "0" + p.slice(3);
  return `${l.slice(0, 4)} ${l.slice(4, 7)} ${l.slice(7)}`;
};
const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] ?? "").join("").toUpperCase();

function read<T>(store: Storage | undefined, key: string, fallback: T): T {
  try {
    const v = store?.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(store: Storage | undefined, key: string, value: unknown) {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked */
  }
}
const local = () => (typeof window === "undefined" ? undefined : window.localStorage);
const session = () => (typeof window === "undefined" ? undefined : window.sessionStorage);

const Icon = {
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
    </svg>
  ),
  cash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  cross: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
};

export default function Monday21({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const [data, setData] = useState<{ game: Game; spots: Spot[] } | null>(null);
  const [sync, setSync] = useState<"loading" | "live" | "stale">("loading");
  const [flow, setFlow] = useState<Flow>({ step: "form" });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Mine[]>([]);
  const [pops, setPops] = useState<Set<number>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [tsToken, setTsToken] = useState<string | null>(null);

  const trapRef = useRef<HTMLInputElement>(null);
  const tsBox = useRef<HTMLDivElement>(null);
  const tsWidget = useRef<string | null>(null);
  const prevPaid = useRef<Set<number> | null>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);
  const waitHeading = useRef<HTMLHeadingElement>(null);

  /* ---------- Load the list, every 5 s while the page is visible ---------- */
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/game", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
      setSync("live");
    } catch {
      setSync("stale");
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  /* ---------- Restore saved details and any payment still in progress ---------- */
  useEffect(() => {
    const me = read<{ name?: string; phone?: string } | null>(local(), ME_KEY, null);
    if (me) {
      setName(me.name ?? "");
      setPhone(me.phone ?? "");
    }
    const pending = read<Waiting | null>(session(), PENDING_KEY, null);
    if (pending && Date.now() - pending.startedAt < 20 * 60_000) setFlow(pending);
  }, []);

  const gameId = data?.game.id;
  useEffect(() => {
    if (gameId) setMine(read<Mine[]>(local(), mineKey(gameId), []));
  }, [gameId]);

  /* ---------- Pop a bib when it turns paid ---------- */
  useEffect(() => {
    if (!data) return;
    const paid = new Set(data.spots.filter((s) => s.status === "paid").map((s) => s.slot));
    const before = prevPaid.current;
    prevPaid.current = paid;
    if (!before) return;
    const fresh = [...paid].filter((n) => !before.has(n));
    if (!fresh.length) return;
    setPops(new Set(fresh));
    const t = setTimeout(() => setPops(new Set()), 600);
    return () => clearTimeout(t);
  }, [data]);

  /* ---------- Turnstile (only when a site key is set) ---------- */
  const renderTurnstile = useCallback(() => {
    if (!turnstileSiteKey || !window.turnstile || !tsBox.current || tsWidget.current) return;
    tsWidget.current = window.turnstile.render(tsBox.current, {
      sitekey: turnstileSiteKey,
      callback: (t: string) => setTsToken(t),
      "expired-callback": () => setTsToken(null),
      "error-callback": () => setTsToken(null),
    });
  }, [turnstileSiteKey]);
  useEffect(() => renderTurnstile(), [renderTurnstile]);
  const resetTurnstile = () => {
    if (tsWidget.current && window.turnstile) window.turnstile.reset(tsWidget.current);
    setTsToken(null);
  };

  /* ---------- Settle a payment ---------- */
  const finish = useCallback(
    (next: Flow, failedSlot?: { gameId: string; slot: number }) => {
      write(session(), PENDING_KEY, null);
      if (failedSlot) {
        const list = read<Mine[]>(local(), mineKey(failedSlot.gameId), []).filter((m) => m.slot !== failedSlot.slot);
        write(local(), mineKey(failedSlot.gameId), list);
        setMine(list);
      }
      setFlow(next);
      load();
    },
    [load],
  );

  /* ---------- While waiting: poll the payment and tick the countdown ---------- */
  useEffect(() => {
    if (flow.step !== "waiting") return;
    const w = flow;
    let active = true;
    const check = async () => {
      try {
        const res = await fetch(`/api/pay/${w.id}`, { cache: "no-store" });
        if (!active) return;
        if (res.status === 404) {
          finish({ step: "failed", slot: w.slot, message: "This payment couldn’t be found." }, w);
          return;
        }
        if (!res.ok) return;
        const s = (await res.json()) as { status: string; receipt: string | null; message: string | null };
        if (!active) return;
        if (s.status === "paid") finish({ step: "success", slot: w.slot, name: w.name, receipt: s.receipt });
        else if (s.status !== "pending") finish({ step: "failed", slot: w.slot, message: s.message ?? "The payment didn’t go through." }, w);
      } catch {
        /* keep waiting */
      }
    };
    check();
    const poll = setInterval(check, 2500);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [flow, finish]);

  useEffect(() => {
    if (flow.step === "waiting") waitHeading.current?.focus();
    if (flow.step === "success" || flow.step === "failed") doneHeading.current?.focus();
  }, [flow.step]);

  /* ---------- Derived state ---------- */
  const game = data?.game;
  const capacity = game?.capacity ?? 21;
  const bySlot = useMemo(() => new Map((data?.spots ?? []).map((s) => [s.slot, s])), [data]);
  const paid = data?.spots.filter((s) => s.status === "paid").length ?? 0;
  const held = data?.spots.filter((s) => s.status === "pending").length ?? 0;
  const taken = paid + held;
  const left = Math.max(0, capacity - taken);
  const locked = !!data && taken >= capacity;
  const isMine = (s: Spot) => mine.some((m) => m.slot === s.slot && m.name === s.name);

  /* ---------- Pay ---------- */
  async function onPay(e: FormEvent) {
    e.preventDefault();
    if (busy || !data || locked) return;
    const cleanedName = cleanName(name);
    const normalized = normalizePhone(phone);
    const next: Errors = {};
    if (!cleanedName) next.name = "Use 2 to 40 letters for your name.";
    if (!normalized) next.phone = "Enter a Safaricom number like 0712 345 678.";
    if (!next.name && !next.phone && turnstileSiteKey && !tsToken) next.form = "Complete the check above the button first.";
    setErrors(next);
    if (next.name || next.phone || next.form || !cleanedName || !normalized) return;

    write(local(), ME_KEY, { name: cleanedName, phone });
    setBusy(true);
    try {
      const res = await fetch("/api/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cleanedName,
          phone,
          website: trapRef.current?.value ?? "",
          turnstileToken: tsToken ?? undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body.error ?? "Something went wrong. Try again.";
        setErrors(body.field === "name" || body.field === "phone" ? { [body.field]: msg } : { form: msg });
        load();
        return;
      }
      const list = [...read<Mine[]>(local(), mineKey(body.gameId), []).filter((m) => m.slot !== body.slot), { slot: body.slot, name: cleanedName }];
      write(local(), mineKey(body.gameId), list);
      setMine(list);
      const waiting: Waiting = { step: "waiting", id: body.id, slot: body.slot, phone: normalized, name: cleanedName, gameId: body.gameId, startedAt: Date.now() };
      write(session(), PENDING_KEY, waiting);
      setNow(Date.now());
      setFlow(waiting);
      load();
    } catch {
      setErrors({ form: "Couldn’t reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
      resetTurnstile();
    }
  }

  function onDone() {
    if (flow.step === "success") setName("");
    setFlow({ step: "form" });
  }

  /* ---------- Text ---------- */
  const countHeadline = !data ? "Loading…" : left > 0 ? `${left} ${left === 1 ? "spot" : "spots"} left` : held > 0 ? "No spots left" : "Game full";
  const countSub = !data ? "" : left > 0 || held === 0 ? `${paid} of ${capacity} paid` : `${paid} paid, ${held} paying now`;
  const lede = !game
    ? "Loading the list…"
    : locked && held > 0
      ? "Every spot is paid for or being paid for right now. If a payment doesn’t go through, its spot reopens here."
      : locked
        ? `All ${capacity} spots are paid for. Next week’s list opens after Monday’s kickoff.`
        : `Pay ${money(game.price)} and your name goes on the list as soon as M-Pesa confirms it.`;

  const elapsed = flow.step === "waiting" ? (now - flow.startedAt) / 1000 : 0;
  const remaining = Math.max(0, Math.ceil(STK_WAIT_SECONDS - elapsed));

  return (
    <main className="wrap">
      {turnstileSiteKey && (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={renderTurnstile} />
      )}

      <section className="stage" aria-labelledby="title">
        <h1 id="title" className="title">Monday 21</h1>
        <p className="tagline">Twenty-one players, every Monday. Pay by M-Pesa to get your spot.</p>
        <ul className="facts">
          {game && (
            <>
              <li>{Icon.calendar}<span>{isToday(game.kickoffAt) ? "Tonight" : fmtDay(game.kickoffAt)}, {fmtTime(game.kickoffAt)}</span></li>
              <li>{Icon.pin}<span>{game.venue}</span></li>
              <li>{Icon.cash}<span>{money(game.price)} per player</span></li>
            </>
          )}
        </ul>

        <div className="count" aria-live="polite">
          <strong>{countHeadline}</strong>
          <span>{countSub}</span>
        </div>
        <div className="pitch" role="img" aria-label={`${taken} of ${capacity} spots taken`}>
          <div className="lines" aria-hidden="true"><span className="box l" /><span className="box r" /></div>
          <ol className="spots" aria-hidden="true">
            {Array.from({ length: capacity }, (_, i) => i + 1).map((n) => {
              const s = bySlot.get(n);
              const state = s ? s.status : "open";
              const cls = ["spot", state, s && isMine(s) ? "mine" : "", pops.has(n) ? "pop" : ""].filter(Boolean).join(" ");
              return <li key={n} className={cls}>{s?.status === "paid" ? initials(s.name) : n}</li>;
            })}
          </ol>
        </div>
        {held > 0 && (
          <p className="held">
            {held === 1
              ? "1 payment is in progress. Its spot reopens if it doesn’t go through."
              : `${held} payments are in progress. Their spots reopen if they don’t go through.`}
          </p>
        )}
      </section>

      <div className="side">
        <section className="card" aria-labelledby="joinTitle">
          {/* Form stays mounted so the Turnstile widget survives */}
          <div hidden={flow.step !== "form"}>
            <h2 id="joinTitle">{game && isToday(game.kickoffAt) ? "Join tonight’s game" : "Join this Monday"}</h2>
            <p className="lede">{lede}</p>
            <form onSubmit={onPay} noValidate>
              <div className="field">
                <label htmlFor="name">Your name</label>
                <input
                  id="name" autoComplete="name" maxLength={40} placeholder="e.g. Brian Otieno"
                  value={name} disabled={busy || locked || !game}
                  aria-invalid={!!errors.name} aria-describedby="nameErr"
                  onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }}
                />
                <p className="err" id="nameErr" role="alert">{errors.name}</p>
              </div>
              <div className="field">
                <label htmlFor="phone">M-Pesa number</label>
                <input
                  id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678"
                  value={phone} disabled={busy || locked || !game}
                  aria-invalid={!!errors.phone} aria-describedby="phoneHint phoneErr"
                  onChange={(e) => { setPhone(e.target.value); setErrors((x) => ({ ...x, phone: undefined })); }}
                />
                <p className="hint" id="phoneHint">The payment request goes to this phone.</p>
                <p className="err" id="phoneErr" role="alert">{errors.phone}</p>
              </div>
              <div className="trap" aria-hidden="true">
                <label htmlFor="website">Leave this empty</label>
                <input id="website" ref={trapRef} tabIndex={-1} autoComplete="off" defaultValue="" />
              </div>
              {turnstileSiteKey && <div className="turnstile" ref={tsBox} />}
              <button className="pay" type="submit" disabled={busy || locked || !game}>
                {busy ? (
                  <><span className="spinner" aria-hidden="true" /><span>Sending M-Pesa request…</span></>
                ) : locked ? (
                  <>{Icon.lock}<span>{held > 0 ? "All spots taken" : "Game full"}</span></>
                ) : (
                  <span>Pay {game ? money(game.price) : ""} with M-Pesa</span>
                )}
              </button>
              <p className="err form-err" role="alert">{errors.form}</p>
            </form>
            <p className="secure-note">You approve the payment on your own phone with your M-Pesa PIN. This site never asks for your PIN.</p>
          </div>

          {flow.step === "waiting" && (
            <div className="flow" aria-live="polite">
              <div className="flow-icon">{Icon.phone}</div>
              <h2 ref={waitHeading} tabIndex={-1}>Check your phone</h2>
              <p>
                An M-Pesa request for <b>{game ? money(game.price) : "the game fee"}</b> was sent to <b>{prettyPhone(flow.phone)}</b>. Enter your M-Pesa PIN to pay.
              </p>
              <div className="meter" aria-hidden="true">
                <span style={{ transform: `scaleX(${remaining / STK_WAIT_SECONDS})` }} />
              </div>
              <p className="small">
                {remaining > 0
                  ? `Spot ${flow.slot} is held for you. The request expires in 0:${String(remaining).padStart(2, "0")}.`
                  : `Spot ${flow.slot} is still held while M-Pesa confirms. This can take a minute.`}
              </p>
            </div>
          )}

          {(flow.step === "success" || flow.step === "failed") && (
            <div className="flow" aria-live="polite">
              <div className={flow.step === "success" ? "flow-icon" : "flow-icon bad"}>
                {flow.step === "success" ? Icon.check : Icon.cross}
              </div>
              <h2 ref={doneHeading} tabIndex={-1}>{flow.step === "success" ? "You’re in" : "Payment not completed"}</h2>
              <p>
                {flow.step === "success"
                  ? `${flow.name} has spot ${flow.slot}${game ? ` for ${fmtDay(game.kickoffAt)} at ${fmtTime(game.kickoffAt)}` : ""}. ${flow.receipt ? `M-Pesa receipt ${flow.receipt}.` : "M-Pesa will text you the receipt."}`
                  : `${flow.message} Spot ${flow.slot} was released.`}
              </p>
              <button className="btn" type="button" onClick={onDone}>
                {flow.step === "success" ? "Add another player" : "Try again"}
              </button>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="rosterTitle">
          <div className="roster-head">
            <h2 id="rosterTitle">Who’s playing</h2>
            <span className="tally">{data ? `${taken}/${capacity}` : ""}</span>
          </div>
          <p className="sync" data-state={sync}>
            {sync === "loading" ? "Loading the list…" : sync === "live" ? "Updates every few seconds." : "Can’t reach the list right now. It may be out of date."}
          </p>
          <ol className="players">
            {data?.spots.map((s) => (
              <li key={s.slot} className={s.status === "pending" ? "row pending" : "row"}>
                <span className="num">{s.slot}</span>
                <div className="who">
                  <span className="name">{s.name}{isMine(s) && <span className="you">You</span>}</span>
                  <span className="meta">{s.phone}</span>
                </div>
                <div className="end">
                  <span className="status">{s.status === "paid" && s.paidAt ? `Paid ${fmtTime(s.paidAt)}` : "Paying…"}</span>
                </div>
              </li>
            ))}
          </ol>
          {data && data.spots.length === 0 && (
            <p className="empty">No one’s on the list yet. The first payment takes spot 1.</p>
          )}
        </section>
      </div>
    </main>
  );
}
