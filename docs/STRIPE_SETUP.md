# AirStudio — Stripe Payments Setup (10 minutes)

AirStudio is **pre-wired for real Stripe payments**. Until you add your keys it
runs in demo-checkout mode; the moment the keys exist, the Studio's Upgrade
button becomes a real Stripe Checkout — no code changes.

## How the money → license flow works

```
Studio "Checkout with Stripe"
  → POST /api/checkout/stripe {plan}
  → Stripe-hosted payment page (cards, Apple Pay, etc.)
  → Stripe webhook  POST /api/webhook/stripe  (checkout.session.completed)
       server verifies the signature, mints an HMAC license key,
       stores it in issued-licenses.json
  → buyer lands back on /studio?checkout=success&session_id=…
  → Studio polls /api/license/by-session → auto-activates Premium ⭐
```

## Step 1 — Create the products in Stripe

In the [Stripe Dashboard](https://dashboard.stripe.com) → **Products** → create
one product **"AirStudio Premium"** with three prices:

| Price | Amount | Type | Env var to copy the `price_…` ID into |
|---|---|---|---|
| Monthly | $4.99 | Recurring · monthly | `STRIPE_PRICE_MONTHLY` |
| Yearly | $29.99 | Recurring · yearly | `STRIPE_PRICE_YEARLY` |
| Lifetime | $59.99 | One-time | `STRIPE_PRICE_LIFETIME` |

## Step 2 — API keys

Dashboard → **Developers → API keys** → copy the **Secret key** (`sk_test_…`
for testing, `sk_live_…` when live) into `STRIPE_SECRET_KEY`.

## Step 3 — Webhook

Dashboard → **Developers → Webhooks → Add endpoint**:

- URL: `https://YOUR-DOMAIN/api/webhook/stripe`
- Event: `checkout.session.completed`
- Copy the **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.

For local testing use the Stripe CLI instead:

```bash
stripe listen --forward-to localhost:3000/api/webhook/stripe
# it prints a whsec_… for your local server
```

## Step 4 — Configure & run

```bash
cd airstudio
export LICENSE_SECRET="a-long-random-secret-only-you-know"   # signs all keys!
export STRIPE_SECRET_KEY="sk_test_..."
export STRIPE_WEBHOOK_SECRET="whsec_..."
export STRIPE_PRICE_MONTHLY="price_..."
export STRIPE_PRICE_YEARLY="price_..."
export STRIPE_PRICE_LIFETIME="price_..."
export BASE_URL="https://YOUR-DOMAIN"     # where Stripe sends buyers back
export NODE_ENV=production                # disables demo keys/checkout
npm start
```

## Step 5 — Test the full purchase

1. Open the Studio → **Upgrade ⭐** → the button now reads *Checkout with Stripe*.
2. Pick a plan → pay with test card `4242 4242 4242 4242`, any future date/CVC.
3. You return to the Studio and Premium activates automatically within seconds.
4. Server log shows: `[stripe] paid (yearly) -> license AIRS-… for buyer@email`.

Every issued key is recorded in `issued-licenses.json` (session id, plan,
email, timestamp) — your source of truth for support/refunds.

## Going-live checklist

- [ ] Switch Stripe to **live mode**, swap in `sk_live_…` + live `price_…` IDs + live webhook secret
- [ ] `NODE_ENV=production` (demo endpoints self-disable)
- [ ] Strong, unique `LICENSE_SECRET` (rotating it invalidates old keys — set it once, keep it forever)
- [ ] Serve over HTTPS (required for phone camera access anyway)
- [ ] Optional: email keys as backup — hook Resend/SendGrid where the webhook handler logs `[stripe] paid …` (buyer already gets in-browser activation, so this is a safety net)
- [ ] Refunds: delete the record from `issued-licenses.json` **and** note that
      offline HMAC keys can't be remotely revoked until the next server check;
      the Studio re-verifies on every load, so add revoked-key checking to
      `/api/license/activate` if chargebacks become a concern.

> Selling from Nigeria / outside Stripe's supported countries? The identical
> flow works with **Paystack or Flutterwave**: point their webhook at a
> handler that calls the same `makeKey()`/`recordIssued()` logic — the
> license side doesn't care who collected the money.
