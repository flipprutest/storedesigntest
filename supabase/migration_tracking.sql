-- ============================================================
-- Migration: add buyer-facing delivery tracking
-- Run this in Supabase SQL Editor (your orders table already exists,
-- this just adds two columns to it — safe to run once).
-- ============================================================

alter table orders
  add column if not exists delivery_status text not null default 'processing',
  -- processing | shipped | delivered
  add column if not exists tracking_number text,
  add column if not exists carrier text not null default 'cdek';

-- Allow the public lookup page to read a safe subset of order fields by ID.
-- Order IDs are random UUIDs (effectively unguessable), so looking one up
-- by its exact ID is safe — like a tracking link. This does NOT expose
-- customer name/phone/email, only order + delivery status fields.
create or replace function get_order_status(p_order_id uuid)
returns table (
  id uuid,
  status text,
  delivery_status text,
  tracking_number text,
  carrier text,
  total numeric,
  created_at timestamptz
)
language sql
security definer
as $$
  select id, status, delivery_status, tracking_number, carrier, total, created_at
  from orders
  where id = p_order_id;
$$;
