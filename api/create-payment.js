// POST /api/create-payment
// Body: { cart: [{ productId, qty, size }], paymentMethod: 'card' | 'sbp', customer?: { name, phone, email } }
//
// Flow:
//  1. Re-price the cart server-side from the database (never trust prices sent by the browser).
//  2. Create a 'pending' order + order_items in Supabase.
//  3. Ask YooKassa to create a payment, get back a hosted checkout URL.
//  4. Return that URL so the frontend can redirect the customer to it.
//
// paymentMethod is deliberately open-ended in the DB (see schema.sql) so adding an
// installment provider later just means adding a new branch here, not restructuring.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // service role: bypasses RLS, server-side only
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cart, paymentMethod, customer } = req.body || {};

  if (!Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }
  if (!['card', 'sbp'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Unsupported payment method' });
  }

  // 1. Re-price from DB
  const productIds = cart.map((i) => i.productId);
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, name, price, stock')
    .in('id', productIds);

  if (prodErr) {
    console.error('product lookup error:', prodErr);
    return res.status(500).json({ error: 'Could not verify products' });
  }

  let total = 0;
  const items = [];
  for (const ci of cart) {
    const product = products.find((p) => p.id === ci.productId);
    if (!product) {
      return res.status(400).json({ error: `Unknown product: ${ci.productId}` });
    }
    const qty = Math.max(1, parseInt(ci.qty, 10) || 1);
    if (product.stock < qty) {
      return res.status(409).json({ error: `Not enough stock for ${product.name}` });
    }
    total += Number(product.price) * qty;
    items.push({
      product_id: product.id,
      product_name: product.name,
      size: ci.size || null,
      price: product.price,
      qty,
    });
  }

  // 2. Create pending order
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      status: 'pending',
      payment_method: paymentMethod,
      provider: 'yookassa',
      total,
      customer_name: customer?.name || null,
      customer_phone: customer?.phone || null,
      customer_email: customer?.email || null,
    })
    .select()
    .single();

  if (orderErr) {
    console.error('order insert error:', orderErr);
    return res.status(500).json({ error: 'Could not create order' });
  }

  const { error: itemsErr } = await supabase
    .from('order_items')
    .insert(items.map((i) => ({ ...i, order_id: order.id })));

  if (itemsErr) {
    console.error('order_items insert error:', itemsErr);
    return res.status(500).json({ error: 'Could not save order items' });
  }

  // 3. Create YooKassa payment
  const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
  const auth = Buffer.from(
    `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`
  ).toString('base64');

  const ykBody = {
    amount: { value: total.toFixed(2), currency: 'RUB' },
    confirmation: {
      type: 'redirect',
      return_url: `${siteUrl}/order-success.html?order=${order.id}`,
    },
    capture: true,
    description: `Заказ #${order.id.slice(0, 8)} — The Gabby`,
    metadata: { order_id: order.id },
  };
  if (paymentMethod === 'sbp') {
    ykBody.payment_method_data = { type: 'sbp' };
  }

  let ykRes, ykData;
  try {
    ykRes = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotence-Key': order.id, // safe to retry without double-charging
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(ykBody),
    });
    ykData = await ykRes.json();
  } catch (err) {
    console.error('YooKassa request failed:', err);
    await supabase.from('orders').update({ status: 'failed' }).eq('id', order.id);
    return res.status(502).json({ error: 'Payment provider unreachable' });
  }

  if (!ykRes.ok) {
    console.error('YooKassa error:', ykData);
    await supabase.from('orders').update({ status: 'failed' }).eq('id', order.id);
    return res.status(502).json({ error: 'Payment provider rejected the request' });
  }

  await supabase
    .from('orders')
    .update({ provider_payment_id: ykData.id })
    .eq('id', order.id);

  res.status(200).json({
    orderId: order.id,
    confirmationUrl: ykData.confirmation.confirmation_url,
  });
}
