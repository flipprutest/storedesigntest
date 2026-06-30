# The Gabby — setup guide

This is a static storefront (`index.html`) plus three small backend functions (`api/`) that
handle product listing, checkout, and payment confirmation. No framework, no build step.

## 1. Supabase (database)

1. Create a project at supabase.com (free tier is fine).
2. Open **SQL Editor → New query**, paste in the contents of `supabase/schema.sql`, and run it.
   This creates the `products`, `orders`, and `order_items` tables, sets up row-level security,
   and inserts the four placeholder products currently shown on the site.
3. Go to **Project Settings → API** and copy three values — you'll need them in step 3 below:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep this one secret — it bypasses all
     access restrictions and must never reach the browser)

## 2. YooKassa (payments)

1. Sign up at yookassa.ru and complete shop verification (this is the part that takes longest
   since it requires your business details).
2. In your shop's dashboard, find the **API keys** section and copy:
   - `shopId` → `YOOKASSA_SHOP_ID`
   - `Secret key` → `YOOKASSA_SECRET_KEY`
3. Once you have a live domain, go to **Settings → HTTP notifications** and set the webhook URL
   to `https://yourdomain.com/api/yookassa-webhook`, subscribed to at least the
   `payment.succeeded` and `payment.canceled` events. (You can skip this until you deploy —
   nothing else depends on it.)

## 3. Deploy to Vercel

1. Push this whole folder to a GitHub repo.
2. At vercel.com, **Add New → Project**, import that repo. No build configuration needed —
   Vercel auto-detects the static `index.html` plus the `api/` folder.
3. Before the first deploy (or right after, then redeploy), go to
   **Project → Settings → Environment Variables** and add every variable listed in
   `.env.example` with your real values.
4. Deploy. You'll get a `your-project.vercel.app` URL — the site and all three API routes work
   immediately under that domain.
5. Test a full purchase using YooKassa's test card numbers (available in their docs while your
   shop is in test mode) before flipping to live payments.

## How it fits together

- `index.html` calls `GET /api/products` on load to render the product grid (no more hardcoded
  products in HTML — edit them in Supabase instead, including price and stock).
- Adding to cart and checking out happens entirely client-side until the customer clicks
  "оплатить картой" / "оплатить через СБП".
- That click calls `POST /api/create-payment`, which re-prices the cart from the database
  (never trusts the price the browser sends), writes a `pending` order, and asks YooKassa for a
  hosted checkout link. The browser redirects there — card details never touch your server.
- After payment, YooKassa calls `POST /api/yookassa-webhook`. That function re-confirms the
  payment status directly with YooKassa's API (webhook bodies aren't signed, so they're not
  trusted blindly), marks the order `paid`, and decrements stock.
- `order-success.html` is just a friendly landing page after redirect — the order's real status
  is decided by the webhook, not by this page.

## Adding an installment provider later (e.g. Долями)

The `orders.payment_method` column is free text, not a fixed enum, specifically so this is easy:
add a new button in the cart UI, a new branch in `api/create-payment.js` that talks to that
provider's API instead of YooKassa's, and (if needed) a separate webhook file for their
notifications. Nothing else in the schema needs to change.

## Updating products later

Once you have real product photos and data, either edit rows directly in the Supabase
**Table Editor** (simplest for a small catalog), or build a tiny admin form later — the schema
doesn't need to change either way.
