const { send, adminClient, requireUser } = require('../lib/shared');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUSINESS_ERRORS = /stok tidak cukup|tidak aktif|harga .* belum diatur|produk tidak ditemukan|keranjang kosong|jumlah tidak valid|produk dobel|terlalu banyak pesanan|nama wajib|pesanan sudah diproses|pesanan tidak ditemukan/i;

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function createOrder(req, res) {
  const body = req.body || {};
  // Kolom jebakan untuk bot: manusia tidak melihatnya. Pura-pura berhasil agar bot tidak mencoba lagi.
  if (typeof body.website === 'string' && body.website.trim() !== '') return send(res, 201, { order: { code: 'L0000', total_amount: 0 } });

  const name = text(body.customer_name, 60);
  if (!name) return send(res, 400, { error: 'Nama wajib diisi.' });
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) return send(res, 400, { error: 'Keranjang kosong atau terlalu banyak item.' });
  const clean = [];
  for (const item of items) {
    if (!item || typeof item.product_id !== 'string' || !UUID.test(item.product_id) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
      return send(res, 400, { error: 'Item pesanan tidak valid (maksimal 20 per menu).' });
    }
    clean.push({ product_id: item.product_id, quantity: item.quantity });
  }
  const { data, error } = await adminClient().rpc('place_order', {
    p_name: name,
    p_contact: text(body.customer_contact, 40) || null,
    p_notes: text(body.notes, 300) || null,
    p_items: clean
  });
  if (error) {
    const msg = error.message || '';
    if (BUSINESS_ERRORS.test(msg)) return send(res, 409, { error: msg });
    console.error('[api/orders POST]', error);
    return send(res, 500, { error: 'Pesanan gagal dikirim. Silakan coba lagi.' });
  }
  return send(res, 201, { order: data });
}

async function listOrders(req, res) {
  const result = await requireUser(req);
  if (result.error) return send(res, result.error.status, { error: result.error.message });
  const { supabase } = result;
  const recent = req.query && req.query.status === 'recent';
  let query = supabase.from('orders')
    .select('id,code,customer_name,customer_contact,notes,status,total_amount,created_at,handled_at,order_items(product_name,quantity,unit_price)');
  query = recent
    ? query.neq('status', 'pending').order('handled_at', { ascending: false, nullsFirst: false }).limit(20)
    : query.eq('status', 'pending').order('created_at', { ascending: true }).limit(100);
  const { data, error } = await query;
  if (error) { console.error('[api/orders GET]', error); return send(res, 500, { error: 'Gagal mengambil pesanan.' }); }
  return send(res, 200, { orders: data || [] });
}

async function updateOrder(req, res) {
  const result = await requireUser(req);
  if (result.error) return send(res, result.error.status, { error: result.error.message });
  const { supabase, user } = result;
  const body = req.body || {};
  if (typeof body.id !== 'string' || !UUID.test(body.id)) return send(res, 400, { error: 'ID pesanan tidak valid.' });
  if (body.action === 'complete') {
    const { data, error } = await supabase.rpc('complete_order', { p_order_id: body.id, p_cashier_id: user.id });
    if (error) {
      const msg = error.message || '';
      if (BUSINESS_ERRORS.test(msg)) return send(res, 409, { error: msg });
      console.error('[api/orders complete]', error);
      return send(res, 500, { error: 'Pesanan gagal diselesaikan. Tidak ada stok yang dikurangi.' });
    }
    return send(res, 200, { transaction: data });
  }
  if (body.action === 'cancel') {
    const { data, error } = await supabase.from('orders')
      .update({ status: 'cancelled', handled_by: user.id, handled_at: new Date().toISOString() })
      .eq('id', body.id).eq('status', 'pending').select('id').maybeSingle();
    if (error) { console.error('[api/orders cancel]', error); return send(res, 500, { error: 'Gagal membatalkan pesanan.' }); }
    if (!data) return send(res, 409, { error: 'Pesanan sudah diproses.' });
    return send(res, 200, { ok: true });
  }
  return send(res, 400, { error: 'Aksi tidak dikenal.' });
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') return await createOrder(req, res);
    if (req.method === 'GET') return await listOrders(req, res);
    if (req.method === 'PATCH') return await updateOrder(req, res);
    return send(res, 405, { error: 'Method tidak diizinkan.' });
  } catch (e) {
    console.error('[api/orders]', e);
    return send(res, 500, { error: 'Terjadi kesalahan server.' });
  }
};
