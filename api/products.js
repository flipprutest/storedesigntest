// GET /api/products
// Returns active products for the storefront to render.
// Uses the anon key (read-only, RLS-restricted to active=true) — safe to expose.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { data, error } = await supabase
    .from('products')
    .select('id, slug, name, price, sizes, stock, image_url')
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('products fetch error:', error);
    return res.status(500).json({ error: 'Could not load products' });
  }

  res.status(200).json(data);
}
