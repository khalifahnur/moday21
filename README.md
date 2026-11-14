# Monday 21

Weekly 21-player sign-up. Players pay by M-Pesa STK push; the list locks at 21.

Next.js 16 + Postgres (Supabase works) + Safaricom Daraja.

## Set up

1. **Database.** In Supabase, open **SQL Editor**, paste all of `db/schema.sql`, click **Run**.
2. **Daraja app.** On developer.safaricom.co.ke, create an app with **M-Pesa Express**. Copy the Consumer Key and Consumer Secret.
3. **Settings.** Copy `.env.example` to `.env.local` and fill it in. For the two secrets, use a password generator (40+ characters).
4. **Run.** `npm install`, then `npm run dev`, then open http://localhost:3000.

## Test real STK pushes (sandbox)

Safaricom has to reach your site, so test on a deployed copy:

1. Push the project to GitHub and import it in Vercel.
2. In Vercel, open **Settings > Environment Variables** and add everything from `.env.local`.
3. Set `MPESA_CALLBACK_BASE_URL` and `APP_ORIGIN` to your Vercel address.
4. Open the site and pay with your own Safaricom number.

## Go live

1. In Daraja, click **Go Live** and get your production shortcode, passkey, key and secret.
2. Update those four settings and set `MPESA_ENV=production`.
3. Set `MPESA_CHECK_CALLBACK_IP=true`.
4. Recommended: add Cloudflare Turnstile keys.

## Organiser page

Open `/admin` and sign in with `ADMIN_TOKEN`. You'll see full numbers and receipts, can remove players, and get a warning for payments that need a refund. Refunds themselves are done in M-Pesa.

## Security features

**Payments**
- Daraja keys, passkey and full phone numbers stay on the server. Browsers only see `0712 ••• 678`.
- Price comes from the server, never from the browser.
- The callback address contains a secret token; wrong token returns 404.
- Callbacks are accepted only from Safaricom's IP addresses (in production).
- Every "paid" callback is double-checked with Safaricom's STK Query API, so a forged callback can't put anyone on the list.
- Amount, phone and receipt format are checked. Receipts are unique, so a replayed callback can't pay for a second player.
- If a callback is lost, the status query settles the payment anyway.
- A payment that arrives after its spot was released is flagged as "Refund due", never silently lost.

**The 21-player limit**
- Spots are taken inside a database transaction that locks the game, plus a unique (game, spot) constraint. Tested with 12 people paying at the same instant for 3 spots: exactly 3 got in.
- A spot is held while its STK request is open and only released on a definite answer.

**Abuse**
- Max 3 requests per number and 6 per connection every 10 minutes, and one open request per number. This stops strangers' phones being spammed with PIN prompts.
- Hidden honeypot field for bots; optional Cloudflare Turnstile check.
- Same name and number can't join twice.
- Strict input checks on name and phone.

**Web**
- Requests from other websites are blocked (Origin check, JSON only, small bodies).
- Security headers: Content-Security-Policy, HSTS, no framing, nosniff, strict referrer.
- Organiser password compared in constant time, with a delay on wrong guesses.
- Supabase row-level security is switched on so the public Supabase API can't read the tables.

## Tests

`tests/` has a fake Daraja server and 42 end-to-end checks (forged callbacks, replays, race for the last spot, rate limits, timeouts, admin access). They need a local Postgres; see the top of `tests/e2e.mjs`.
