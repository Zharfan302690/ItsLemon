const { send, adminClient, requireUser, ONLINE_PREFIX, buildOnlineNotes, parseOnlineNotes } = require('../lib/shared');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUSINESS_ERRORS = /stok tidak cukup|tidak aktif|harga .* belum diatur|produk tidak ditemukan|keranjang kosong|jumlah/i;
const MAX_ONLINE_PER_10_MIN = 30;

// Pelanggan memesan: dicatat langsung sebagai transaksi di tabel yang sudah ada (transactions + transaction_items)
// lewat fungsi process_sale yang sama dengan kasir. Stok dikurangi atomik di sana. cashier_id dikosongkan untuk pesanan online.
async function createOrder(req, res) {
  const body = req.body || {};
  // Kolom jebakan untuk bot: manusia tidak melihatnya. Pura-pura berhasil agar bot tidak mencoba lagi.
  if (typeof body.website === 'string' && body.website.trim() !== '') return send(res, 201, { order: { code: '00000000', total_amount: 0 } });

  const name = typeof body.customer_name === 'string' ? body.customer_name.trim() : '';
  if (!name) return send(res, 400, { error: 'Nama wajib diisi.' });
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) return send(res, 400, { error: 'Keranjang kosong atau terlalu banyak item.' });
  const seen = new Set();
  const clean = [];
  for (const item of items) {
    if (!item || typeof item.product_id !== 'string' || !UUID.test(item.product_id) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 20 || seen.has(item.product_id)) {
      return send(res, 400, { error: 'Item pesanan tidak valid (maksimal 20 per menu).' });
    }
    seen.add(item.product_id);
    clean.push({ product_id: item.product_id, quantity: item.quantity });
  }

  const supabase = adminClient();
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true })
    .like('notes', ONLINE_PREFIX + '%').gte('created_at', since);
  if ((count || 0) >= MAX_ONLINE_PER_10_MIN) return send(res, 429, { error: 'Terlalu banyak pesanan masuk. Coba lagi beberapa menit lagi.' });

  const { data, error } = await supabase.rpc('process_sale', {
    p_items: clean,
    p_cashier_id: null,
    p_notes: buildOnlineNotes(name, body.customer_contact, body.notes)
  });
  if (error) {
    const msg = error.message || '';
    if (BUSINESS_ERRORS.test(msg)) return send(res, 409, { error: msg });
    console.error('[api/orders POST]', error);
    return send(res, 500, { error: 'Pesanan gagal dikirim. Silakan coba lagi.' });
  }
  return send(res, 201, { order: { id: data.id, code: String(data.id).slice(0, 8).toUpperCase(), total_amount: data.total_amount } });
}

// Staf: pesanan online 24 jam terakhir (transaksi yang catatannya berawalan [ONLINE]).
async function listOrders(req, res) {
  const result = await requireUser(req);
  if (result.error) return send(res, result.error.status, { error: result.error.message });
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await result.supabase.from('transactions')
    .select('id,total_amount,notes,created_at,transaction_items(product_name,quantity,unit_price)')
    .like('notes', ONLINE_PREFIX + '%').gte('created_at', since)
    .order('created_at', { ascending: false }).limit(50);
  if (error) { console.error('[api/orders GET]', error); return send(res, 500, { error: 'Gagal mengambil pesanan.' }); }
  return send(res, 200, {
    orders: (data || []).map(t => ({
      id: t.id,
      code: String(t.id).slice(0, 8).toUpperCase(),
      created_at: t.created_at,
      total_amount: t.total_amount,
      ...(parseOnlineNotes(t.notes) || {}),
      items: t.transaction_items || []
    }))
  });
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') return await createOrder(req, res);
    if (req.method === 'GET') return await listOrders(req, res);
    return send(res, 405, { error: 'Method tidak diizinkan.' });
  } catch (e) {
    console.error('[api/orders]', e);
    return send(res, 500, { error: 'Terjadi kesalahan server.' });
  }
};
