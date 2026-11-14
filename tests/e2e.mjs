// End-to-end checks against a fake Daraja server.
// Needs a local Postgres with db/schema.sql loaded into a database called "monday21" (user postgres, password pw).
// 1. node tests/mock-daraja.mjs
// 2. In a second terminal: load tests/.env.test, then  npm run build && npx next start -p 3100
// 3. node tests/e2e.mjs
// WARNING: this empties the spots table. Never point it at your real database.
import postgres from "postgres";
const sql = postgres("postgres://postgres:pw@localhost:5432/monday21");
const APP = "http://localhost:3100", MOCK = "http://localhost:4010";
const CB = "cbtoken_0123456789abcdef0123456789abcdef", ADMIN = "admintoken_0123456789abcdef0123456789abcdef";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok  ", m); } else { fail++; console.log("  FAIL", m); } };
const H = (ip, extra = {}) => ({ "content-type": "application/json", origin: APP, host: "localhost:3100", "x-real-ip": ip, ...extra });
const pay = (name, phone, ip = "1.1.1.1", extra = {}, h = {}) => fetch(`${APP}/api/pay`, { method: "POST", headers: { ...H(ip), ...h }, body: JSON.stringify({ name, phone, ...extra }) });
const status = async (id) => (await (await fetch(`${APP}/api/pay/${id}`)).json());
const callback = (body, ip = "196.201.214.200", token = CB) => fetch(`${APP}/api/mpesa/callback/${token}`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify(body) });
const cbBody = (checkout, code, { amount = 300, receipt = "TKG4X9P2QA", phone = 254712345678 } = {}) => ({ Body: { stkCallback: { MerchantRequestID: "m", CheckoutRequestID: checkout, ResultCode: code, ResultDesc: code === 0 ? "The service request is processed successfully." : "Request cancelled by user", ...(code === 0 ? { CallbackMetadata: { Item: [{ Name: "Amount", Value: amount }, { Name: "MpesaReceiptNumber", Value: receipt }, { Name: "TransactionDate", Value: 20261116183000 }, { Name: "PhoneNumber", Value: phone }] } } : {}) } } });
const setQuery = (id, code) => fetch(`${MOCK}/_set`, { method: "POST", body: JSON.stringify({ id, code }), headers: { authorization: "Bearer tok" } });
const checkoutOf = async (id) => (await sql`select checkout_request_id from spots where id = ${id}`)[0].checkout_request_id;
const reset = async () => { await sql`delete from spots`; };

console.log("Input and origin checks");
await reset();
ok((await fetch(`${APP}/api/pay`, { method: "POST", headers: { "content-type": "application/json", host: "localhost:3100" }, body: "{}" })).status === 403, "no Origin header is blocked");
ok((await pay("A B", "0712345678", "1.1.1.1", {}, { origin: "https://evil.example" })).status === 403, "foreign Origin is blocked");
ok((await fetch(`${APP}/api/pay`, { method: "POST", headers: { ...H("1.1.1.1"), "content-type": "text/plain" }, body: "x" })).status === 415, "non-JSON body rejected");
let r = await pay("Brian", "12345"); ok(r.status === 400 && (await r.json()).field === "phone", "bad phone rejected");
r = await pay("<script>", "0712345678"); ok(r.status === 400 && (await r.json()).field === "name", "script-like name rejected");
ok((await pay("Brian Otieno", "0712345678", "1.1.1.1", { website: "spam" })).status === 400, "honeypot filled is rejected");

console.log("Happy path");
r = await pay("Brian Otieno", "0712 345 678");
let a = await r.json(); ok(r.status === 201 && a.slot === 1, "first payment holds spot 1");
const pushes = await (await fetch(`${MOCK}/_pushes`, { headers: { authorization: "Bearer tok" } })).json();
const p = pushes.at(-1);
ok(p.PhoneNumber === "254712345678" && p.Amount === 300 && p.AccountReference === "MON21-1", "STK push has normalised phone, server price, reference");
ok(/^\d{14}$/.test(p.Timestamp) && Buffer.from(p.Password, "base64").toString() === "174379bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919" + p.Timestamp, "Daraja password and timestamp are correct");
ok(p.CallBackURL === `https://example.com/api/mpesa/callback/${CB}`, "callback URL carries the secret token");
ok((await status(a.id)).status === "pending", "status is pending");
let game = await (await fetch(`${APP}/api/game`)).json();
ok(game.spots[0].phone === "0712 ••• 678" && !JSON.stringify(game).includes("254712345678"), "public list only shows masked number");

const co = await checkoutOf(a.id);
ok((await callback(cbBody(co, 0), "196.201.214.200", "wrongtoken")).status === 404, "callback with wrong token is 404");
ok((await callback(cbBody(co, 0), "9.9.9.9")).status === 403, "callback from non-Safaricom IP is 403");
ok((await status(a.id)).status === "pending", "still pending after rejected callbacks");
await setQuery(co, 0);
ok((await callback(cbBody(co, 0))).status === 200, "genuine callback accepted");
let s = await status(a.id); ok(s.status === "paid" && s.receipt === "TKG4X9P2QA", "spot marked paid with receipt");
ok((await callback(cbBody(co, 0))).status === 200 && (await status(a.id)).status === "paid", "duplicate callback is harmless");

console.log("Forgery and replay");
r = await pay("Mary Wanjiku", "0722000001", "2.2.2.2"); const b = await r.json();
const cob = await checkoutOf(b.id);
await callback(cbBody(cob, 0, { phone: 254722000001, receipt: "TKG4X9P2QA" }));
ok((await status(b.id)).status === "pending", "replayed receipt doesn't mark a second player paid");
await callback(cbBody(cob, 0, { phone: 254722000001, amount: 1, receipt: "TKH1111111" }));
ok((await status(b.id)).status === "pending", "underpaid amount is ignored");
await callback(cbBody(cob, 0, { phone: 254799999999, receipt: "TKH2222222" }));
ok((await status(b.id)).status === "pending", "callback for a different phone is ignored");
await setQuery(cob, 1032);
await callback(cbBody(cob, 0, { phone: 254722000001, receipt: "TKH3333333" }));
s = await status(b.id); ok(s.status === "failed", "success callback contradicted by Safaricom query is rejected");

console.log("Cancel, limits, duplicates");
r = await pay("Brian Otieno", "0712345678", "3.3.3.3"); ok(r.status === 409, "same name + number can’t join twice");
r = await pay("Kevin", "0733000001", "4.4.4.4"); const c = await r.json();
r = await pay("Kevin Two", "0733000001", "4.4.4.5"); ok(r.status === 409 && (await r.json()).field === "phone", "one open request per phone");
await callback(cbBody(await checkoutOf(c.id), 1032));
s = await status(c.id); ok(s.status === "failed" && /cancelled/.test(s.message), "cancel callback releases spot with clear message");
r = await pay("Kevin", "0733000001", "4.4.4.6"); const c2 = await r.json(); await callback(cbBody(await checkoutOf(c2.id), 1032));
r = await pay("Kevin", "0733000001", "4.4.4.7"); const c3 = await r.json(); await callback(cbBody(await checkoutOf(c3.id), 1032));
r = await pay("Kevin", "0733000001", "4.4.4.8"); ok(r.status === 429, "4th attempt from one number in 10 min is rate limited");
for (let i = 0; i < 5; i++) { const x = await (await pay(`Ip Test ${String.fromCharCode(65 + i)}`, `07440000${10 + i}`, "5.5.5.5")).json(); if (x.id) await callback(cbBody(await checkoutOf(x.id), 1032)); }
r = await pay("Ip Test F", "0744000020", "5.5.5.5"); ok(r.status === 201, "6th from one IP allowed");
const ipx = await r.json(); await callback(cbBody(await checkoutOf(ipx.id), 1032));
r = await pay("Ip Test G", "0744000021", "5.5.5.5"); ok(r.status === 429, "7th from one IP is rate limited");
r = await pay("Bad Push", "0700000099", "6.6.6.6"); ok(r.status === 502, "Daraja rejection is reported and spot freed");

console.log("Capacity and race");
await reset();
const results = await Promise.all(Array.from({ length: 12 }, (_, i) => pay(`Racer ${String.fromCharCode(65 + i)}`, `07550000${10 + i}`, `7.7.7.${i}`)));
const codes = results.map((x) => x.status);
ok(codes.filter((x) => x === 201).length === 3 && codes.filter((x) => x === 409).length === 9, `12 people at once, capacity 3: exactly 3 get spots (${codes.join(",")})`);
const slots = (await sql`select slot from spots where slot is not null order by slot`).map((x) => x.slot);
ok(JSON.stringify(slots) === "[1,2,3]", "no duplicate spot numbers");
game = await (await fetch(`${APP}/api/game`)).json(); ok(game.spots.length === 3, "list shows 3 holds, game locked");

console.log("Timeouts and late payments");
const [p1, p2, p3] = await sql`select id, checkout_request_id, phone from spots order by slot`;
await sql`update spots set held_until = now() - interval '1 minute'`;
await setQuery(p1.checkout_request_id, 0); await setQuery(p2.checkout_request_id, 1037);
await fetch(`${APP}/api/game`); await new Promise((r) => setTimeout(r, 300));
ok((await status(p1.id)).status === "paid", "expired hold confirmed paid via status query");
ok((await status(p2.id)).status === "failed", "expired hold that failed is released");
ok((await status(p3.id)).status === "pending", "unanswered request keeps its spot");
await sql`update spots set created_at = now() - interval '20 minutes', held_until = now() - interval '1 minute' where id = ${p3.id}`;
await status(p3.id);
ok((await status(p3.id)).status === "failed", "request with no answer for 15 min is released");
await setQuery(p3.checkout_request_id, 0);
await callback(cbBody(p3.checkout_request_id, 0, { phone: Number(p3.phone), receipt: "TKL9999999" }));
const row = (await sql`select status, receipt from spots where id = ${p3.id}`)[0];
ok(row.status === "refund_due" && row.receipt === "TKL9999999", "late payment after release is flagged for refund");

console.log("Organiser");
ok((await fetch(`${APP}/api/admin/spots`)).status === 401, "admin list needs the password");
ok((await fetch(`${APP}/api/admin/spots`, { headers: { authorization: "Bearer wrong" } })).status === 401, "wrong password rejected");
const adm = await (await fetch(`${APP}/api/admin/spots`, { headers: { authorization: `Bearer ${ADMIN}` } })).json();
ok(adm.spots.some((x) => x.phone.startsWith("07")), "admin sees full numbers");
ok((await fetch(`${APP}/api/admin/spots/${p1.id}`, { method: "DELETE", headers: { authorization: `Bearer ${ADMIN}`, origin: APP, host: "localhost:3100" } })).status === 200, "admin can remove a player");
ok((await fetch(`${APP}/api/admin/spots/${p1.id}`, { method: "DELETE", headers: { authorization: `Bearer ${ADMIN}`, origin: "https://evil.example", host: "localhost:3100" } })).status === 403, "cross-site admin delete blocked");

console.log(`\n${pass} passed, ${fail} failed`);
await sql.end();
process.exit(fail ? 1 : 0);
