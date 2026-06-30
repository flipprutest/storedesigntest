// POST /api/yookassa-webhook
// YooKassa calls this when a payment's status changes.
//
// IMPORTANT: YooKassa webhook bodies are not signed, so we never trust the
// body directly. We take the payment ID from the notification and make our
// own server-side GET request back to YooKassa's API to confirm the real
// status before updating anything.
//
// Register this URL in your YooKassa dashboard (Settings → HTTP notifications):
//   https://yourdomain.com/api/yookassa-webhook

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const paymentId = req.body?.object?.id;
  if (!paymentId) {
    // Nothing usable in the notification — acknowledge so YooKassa stops retrying.
    return res.status(200).end();
  }

  // Confirm the real status directly from YooKassa, ignoring whatever the
  // webhook body claims.
  const auth = Buffer.from(
    `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`
  ).toString('base64');

  let payment;
  try {
    const ykRes = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!ykRes.ok) throw new Error(`YooKassa lookup failed: ${ykRes.status}`);
    payment = await ykRes.json();
  } catch (err) {
    console.error('webhook: could not verify payment with YooKassa:', err);
    // Return 500 so YooKassa retries the notification later.
    return res.status(500).end();
  }

  const orderId = payment.metadata?.order_id;
  if (!orderId) {
    return res.status(200).end();
  }

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, status')
    .eq('id', orderId)
    .single();

  if (orderErr || !order) {
    console.error('webhook: order not found for', orderId);
    return res.status(200).end();
  }

  if (payment.status === 'succeeded' && order.status !== 'paid') {
    await supabase
      .from('orders')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', orderId);

    const { data: items } = await supabase
      .from('order_items')
      .select('product_id, qty')
      .eq('order_id', orderId);

    for (const item of items || []) {
      if (item.product_id) {
        await supabase.rpc('decrement_stock', { p_id: item.product_id, qty: item.qty });
      }
    }
  } else if (['canceled', 'failed'].includes(payment.status) && order.status === 'pending') {
    await supabase.from('orders').update({ status: 'failed' }).eq('id', orderId);
  }

  res.status(200).end();
}
