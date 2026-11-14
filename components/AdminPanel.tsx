"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type Status = "pending" | "paid" | "failed" | "removed" | "refund_due";
type Row = {
  id: string;
  slot: number | null;
  name: string;
  phone: string;
  status: Status;
  amount: number;
  receipt: string | null;
  note: string | null;
  createdAt: string;
  paidAt: string | null;
};
type Filter = "active" | "refund_due" | "all";

const KEY = "monday21:admin";
const LABEL: Record<Status, string> = {
  paid: "Paid",
  pending: "Paying",
  failed: "Failed",
  removed: "Removed",
  refund_due: "Refund due",
};
const FILTERS: { id: Filter; label: string }[] = [
  { id: "active", label: "On the list" },
  { id: "refund_due", label: "Refunds" },
  { id: "all", label: "Everything" },
];

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", weekday: "short", hour: "numeric", minute: "2-digit" });
const money = (n: number) => `KES ${n.toLocaleString("en-KE")}`;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

export default function AdminPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [gameId, setGameId] = useState("");
  const [setup, setSetup] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const signOut = useCallback(() => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
    setToken(null);
    setRows(null);
  }, []);

  const load = useCallback(
    async (t: string, quiet = false) => {
      if (!quiet) setBusy(true);
      setError("");
      try {
        const res = await fetch("/api/admin/spots", { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (Array.isArray(body.setup)) setSetup(body.setup);
        if (res.status === 401) {
          signOut();
          setError("Wrong admin password.");
          return;
        }
        if (!res.ok) {
          // Keep the person signed in on server trouble, and say what went wrong instead of a bare code.
          if (res.status === 503 && body.error?.includes("ADMIN_TOKEN")) signOut();
          throw new Error(body.error || `The server answered with error ${res.status}. Check the deployment logs.`);
        }
        setToken(t);
        try {
          sessionStorage.setItem(KEY, t);
        } catch {}
        setGameId(body.gameId);
        setRows(body.spots);
        setUpdated(new Date());
      } catch (err) {
        setError((err as Error).message || "Couldn’t load the list.");
      } finally {
        setBusy(false);
      }
    },
    [signOut],
  );

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(KEY);
    } catch {}
    if (saved) load(saved);
  }, [load]);

  useEffect(() => {
    if (!token) return;
    const t = setInterval(() => load(token, true), 10_000);
    return () => clearInterval(t);
  }, [token, load]);

  async function remove(id: string) {
    if (!token) return;
    if (confirming !== id) {
      setConfirming(id);
      setTimeout(() => setConfirming((c) => (c === id ? null : c)), 3000);
      return;
    }
    setConfirming(null);
    const res = await fetch(`/api/admin/spots/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn’t remove the player.");
    load(token, true);
  }

  function onSignIn(e: FormEvent) {
    e.preventDefault();
    if (input.trim()) load(input.trim());
    setInput("");
  }

  const stats = useMemo(() => {
    const all = rows ?? [];
    const paid = all.filter((r) => r.status === "paid");
    return {
      onList: all.filter((r) => r.slot !== null).length,
      paid: paid.length,
      pending: all.filter((r) => r.status === "pending").length,
      refunds: all.filter((r) => r.status === "refund_due").length,
      collected: paid.reduce((sum, r) => sum + r.amount, 0),
    };
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (filter === "active" && !(r.status === "paid" || r.status === "pending" || r.status === "refund_due")) return false;
      if (filter === "refund_due" && r.status !== "refund_due") return false;
      if (!q) return true;
      const digits = q.replace(/\s+/g, "");
      return r.name.toLowerCase().includes(q) || r.phone.includes(digits) || (r.receipt ?? "").toLowerCase().includes(q);
    });
  }, [rows, filter, query]);

  /* ---------- Sign in ---------- */
  if (!token) {
    return (
      <main className="adm adm-login">
        <section className="adm-card login">
          <div className="brand-mark" aria-hidden="true">21</div>
          <h1 className="adm-h1">Organiser</h1>
          <p className="adm-sub">Sign in with the admin password from your server settings.</p>
          <form onSubmit={onSignIn} noValidate>
            <label className="adm-label" htmlFor="token">Admin password</label>
            <input
              id="token"
              className="adm-input"
              type="password"
              autoComplete="current-password"
              placeholder="ADMIN_TOKEN"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
            <button className="adm-btn primary block" type="submit" disabled={busy || !input.trim()}>
              {busy ? <span className="spinner" /> : null}
              {busy ? "Signing in" : "Sign in"}
            </button>
            <p className="adm-error" role="alert">{error}</p>
          </form>
        </section>
      </main>
    );
  }

  /* ---------- Dashboard ---------- */
  return (
    <>
      <header className="adm-top">
        <div className="adm-top-in">
          <div className="adm-brand">
            <span className="brand-mark sm" aria-hidden="true">21</span>
            <div>
              <h1 className="adm-title">Organiser</h1>
              <p className="adm-meta">Game on {gameId}</p>
            </div>
          </div>
          <div className="adm-actions">
            <span className="live" title={updated ? `Updated ${updated.toLocaleTimeString("en-GB")}` : ""}>
              <i /> Live
            </span>
            <button className="adm-btn ghost" type="button" onClick={() => token && load(token)} disabled={busy}>Refresh</button>
            <button className="adm-btn ghost" type="button" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>

      <main className="adm">
        {setup.length > 0 && (
          <div className="adm-banner warn" role="status">
            <strong>Setup check</strong>
            <span>
              These settings are missing or invalid on the server: <code>{setup.join(", ")}</code>. Payments may not work until they’re fixed
              (then redeploy so Vercel picks them up).
            </span>
          </div>
        )}
        {refundsBanner(stats.refunds)}
        {error && <div className="adm-banner bad" role="alert">{error}</div>}

        <section className="stats" aria-label="Summary">
          <Stat label="On the list" value={`${stats.onList}`} hint="of 21" tone="" />
          <Stat label="Paid" value={`${stats.paid}`} hint="confirmed" tone="good" />
          <Stat label="Paying now" value={`${stats.pending}`} hint="awaiting PIN" tone="warn" />
          <Stat label="Collected" value={money(stats.collected)} hint="this game" tone="" />
        </section>

        <section className="adm-card list">
          <div className="toolbar">
            <div className="seg" role="tablist" aria-label="Filter">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>
                  {f.label}
                  {f.id === "refund_due" && stats.refunds > 0 ? <b>{stats.refunds}</b> : null}
                </button>
              ))}
            </div>
            <input
              className="adm-input search"
              type="search"
              placeholder="Search name, phone or receipt"
              aria-label="Search players"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <ul className="people">
            {visible.map((r) => (
              <li className={`person ${r.status}`} key={r.id}>
                <span className="avatar" aria-hidden="true">{r.slot ?? "–"}</span>
                <div className="who">
                  <p className="p-name">
                    {r.name} <span className={`chip ${r.status}`}>{LABEL[r.status]}</span>
                  </p>
                  <p className="p-detail">
                    <span>{r.phone}</span>
                    <span>{money(r.amount)}</span>
                    {r.receipt ? <span className="mono">{r.receipt}</span> : null}
                    <span>{r.paidAt ? `Paid ${when(r.paidAt)}` : `Started ${when(r.createdAt)}`}</span>
                  </p>
                  {r.status === "failed" && r.note ? <p className="p-note">{r.note}</p> : null}
                </div>
                {(r.status === "paid" || r.status === "pending") && (
                  <button className={confirming === r.id ? "rm confirm" : "rm"} type="button" onClick={() => remove(r.id)} aria-label={`Remove ${r.name}`}>
                    {confirming === r.id ? "Tap to confirm" : "Remove"}
                  </button>
                )}
              </li>
            ))}
          </ul>

          {rows && visible.length === 0 && (
            <p className="adm-empty">{query ? "No one matches that search." : filter === "refund_due" ? "No refunds due." : "No payments yet for this game."}</p>
          )}
          {!rows && <p className="adm-empty">Loading…</p>}
        </section>

        <p className="adm-foot">{updated ? `Updated ${updated.toLocaleTimeString("en-GB")} · refreshes every 10 seconds` : ""}</p>
      </main>
    </>
  );
}

function refundsBanner(n: number) {
  if (n === 0) return null;
  return (
    <div className="adm-banner bad" role="status">
      <strong>{n === 1 ? "1 payment needs a refund" : `${n} payments need a refund`}</strong>
      <span>They arrived after the spot was released. Refund in M-Pesa, then remove the player.</span>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "" | "good" | "warn" }) {
  return (
    <div className={`stat ${tone}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-hint">{hint}</span>
    </div>
  );
}
