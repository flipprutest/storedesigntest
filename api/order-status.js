// GET /api/order-status?order=ORDER_ID
// Public lookup used by track.html. Returns only safe, non-personal fields —
// no name, phone, or email — since the order ID itself acts as the access
// token (like a tracking link). Uses the anon key; the get_order_status()
// Postgres function (see supabase/migration_tracking.sql) defines exactly
// which columns are exposed.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const orderId = req.query.order;
  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Missing order id' });
  }

  const { data, error } = await supabase.rpc('get_order_status', {
    p_order_id: orderId,
  });

  if (error) {
    console.error('order-status lookup error:', error);
    return res.status(500).json({ error: 'Lookup failed' });
  }

  if (!data || data.length === 0) {
    return res.status(404).json({ error: 'Order not found' });
  }

  res.status(200).json(data[0]);
}
