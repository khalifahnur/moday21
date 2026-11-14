"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Row = {
  id: string;
  slot: number | null;
  name: string;
  phone: string;
  status: "pending" | "paid" | "failed" | "removed" | "refund_due";
  amount: number;
  receipt: string | null;
  note: string | null;
  createdAt: string;
  paidAt: string | null;
};

const KEY = "monday21:admin";
const LABEL: Record<Row["status"], string> = {
  paid: "Paid",
  pending: "Paying",
  failed: "Failed",
  removed: "Removed",
  refund_due: "Refund due",
};
const time = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", weekday: "short", hour: "numeric", minute: "2-digit" });

export default function AdminPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [gameId, setGameId] = useState("");
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(KEY);
    setToken(null);
    setRows(null);
  }, []);

  const load = useCallback(
    async (t: string) => {
      setError("");
      try {
        const res = await fetch("/api/admin/spots", { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          signOut();
          setError("Wrong admin password.");
          return;
        }
        if (!res.ok) throw new Error(body.error);
        setToken(t);
        sessionStorage.setItem(KEY, t);
        setGameId(body.gameId);
        setRows(body.spots);
      } catch (err) {
        setError((err as Error).message || "Couldn’t load the list.");
      }
    },
    [signOut],
  );

  useEffect(() => {
    const saved = sessionStorage.getItem(KEY);
    if (saved) load(saved);
  }, [load]);

  useEffect(() => {
    if (!token) return;
    const t = setInterval(() => load(token), 10_000);
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
    load(token);
  }

  function onSignIn(e: FormEvent) {
    e.preventDefault();
    if (input.trim()) load(input.trim());
    setInput("");
  }

  if (!token) {
    return (
      <main className="admin">
        <h1 className="title">Organiser</h1>
        <section className="card">
          <h2>Sign in</h2>
          <p className="lede">Use the admin password from your server settings (ADMIN_TOKEN).</p>
          <form onSubmit={onSignIn}>
            <div className="field">
              <label htmlFor="token">Admin password</label>
              <input id="token" type="password" autoComplete="current-password" value={input} onChange={(e) => setInput(e.target.value)} />
            </div>
            <button className="pay" type="submit">Sign in</button>
            <p className="err form-err" role="alert">{error}</p>
          </form>
        </section>
      </main>
    );
  }

  const visible = (rows ?? []).filter((r) => showAll || r.status === "paid" || r.status === "pending" || r.status === "refund_due");
  const refunds = (rows ?? []).filter((r) => r.status === "refund_due").length;

  return (
    <main className="admin">
      <div className="admin-head">
        <h1 className="title">Organiser</h1>
        <button className="btn" type="button" onClick={signOut}>Sign out</button>
      </div>

      <section className="card">
        <div className="roster-head">
          <h2>Game on {gameId}</h2>
          <span className="tally">{(rows ?? []).filter((r) => r.slot !== null).length} on the list</span>
        </div>
        {refunds > 0 && (
          <p className="err">{refunds === 1 ? "1 payment needs" : `${refunds} payments need`} a refund: they arrived after the spot was released.</p>
        )}
        <p className="err" role="alert">{error}</p>
        <label className="hint" style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show failed and removed payments too
        </label>

        <div>
          {visible.map((r) => (
            <div className="admin-row" key={r.id}>
              <span className="slot">{r.slot ?? "–"}</span>
              <div>
                <span className="name">{r.name} <span className={`chip ${r.status}`}>{LABEL[r.status]}</span></span>
                <span className="detail">
                  {r.phone}, KES {r.amount}
                  {r.receipt ? `, receipt ${r.receipt}` : ""}
                  {`, ${r.paidAt ? `paid ${time(r.paidAt)}` : `started ${time(r.createdAt)}`}`}
                  {r.status === "failed" && r.note ? `. ${r.note}` : ""}
                </span>
              </div>
              {(r.status === "paid" || r.status === "pending") && (
                <button className={confirming === r.id ? "remove confirm" : "remove"} type="button" onClick={() => remove(r.id)}>
                  {confirming === r.id ? "Confirm" : "Remove"}
                </button>
              )}
            </div>
          ))}
          {rows && visible.length === 0 && <p className="empty">No payments yet for this game.</p>}
        </div>
      </section>
    </main>
  );
}
