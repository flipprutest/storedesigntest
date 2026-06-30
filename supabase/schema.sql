-- ============================================================
-- The Gabby — database schema
-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query)
-- ============================================================

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ── PRODUCTS ──────────────────────────────────────────────────
create table products (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  price       numeric(10,2) not null,
  sizes       jsonb not null default '["S","M","L"]'::jsonb,
  stock       int not null default 0,
  image_url   text,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- ── ORDERS ────────────────────────────────────────────────────
-- payment_method is intentionally a free-text field (not an enum) so new
-- providers (installments, etc.) can be added later without a migration.
create table orders (
  id                  uuid primary key default gen_random_uuid(),
  status              text not null default 'pending', -- pending | paid | failed | cancelled
  payment_method      text not null default 'card',     -- card | sbp | (future: installment_*)
  provider            text not null default 'yookassa', -- which payment provider handled this
  provider_payment_id text,
  total               numeric(10,2) not null,
  customer_name       text,
  customer_phone      text,
  customer_email      text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);

-- ── ORDER ITEMS ───────────────────────────────────────────────
create table order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  product_id   uuid references products(id),
  product_name text not null,   -- snapshot at time of purchase
  size         text,
  price        numeric(10,2) not null, -- snapshot price, in case product price changes later
  qty          int not null
);

-- ── STOCK HELPER ──────────────────────────────────────────────
create or replace function decrement_stock(p_id uuid, qty int)
returns void
language sql
as $$
  update products set stock = greatest(stock - qty, 0) where id = p_id;
$$;

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
-- Products: anyone can read active products (needed for the public site).
-- Orders/order_items: NOT publicly readable or writable. Only the backend
-- (using the Supabase service role key, which bypasses RLS) touches these.
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

create policy "Public can view active products"
  on products for select
  using (active = true);

-- ── PLACEHOLDER PRODUCTS (swap for real data later) ───────────
insert into products (slug, name, price, stock, sort_order) values
  ('mayka-essential',      'майка essential',     8900,  20, 1),
  ('longsleeve-camille',   'лонгслив camille',    9500,  20, 2),
  ('kostyum-gabrielle',    'костюм gabrielle',   14900,  15, 3),
  ('bryuki-raimont',       'брюки raimont',      10200,  15, 4);
