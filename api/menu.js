const { send, adminClient } = require('../lib/shared');

// Menu publik untuk halaman pemesanan pelanggan: hanya produk aktif yang sudah punya harga.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method tidak diizinkan.' });
  try {
    const { data, error } = await adminClient().from('products')
      .select('id,name,price,stock').eq('active', true).gt('price', 0).order('name');
    if (error) return send(res, 500, { error: 'Gagal memuat menu.' });
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    return send(res, 200, { products: data || [] });
  } catch (e) {
    console.error('[api/menu]', e);
    return send(res, 500, { error: 'Menu belum bisa dimuat. Coba lagi sebentar lagi.' });
  }
};
