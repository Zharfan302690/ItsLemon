const { adminClient, send } = require('../lib/shared');

// Endpoint PUBLIK (tanpa login) khusus untuk landing page.
// Hanya mengirim data yang aman ditampilkan: nama, harga, dan jumlah stok.
// Data transaksi dan data staf TIDAK pernah dikirim.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method tidak diizinkan.' });
  try {
    const { data, error } = await adminClient()
      .from('products')
      .select('name,price,stock,active')
      .eq('active', true)
      .order('name');
    if (error) return send(res, 500, { error: 'Gagal mengambil menu.' });
    const products = (data || []).map((p) => ({
      name: p.name,
      price: p.price,
      stock: p.stock,
      in_stock: p.stock > 0
    }));
    // Cache singkat di CDN Vercel supaya Supabase tidak dipanggil di setiap kunjungan.
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return send(res, 200, { products });
  } catch (e) {
    return send(res, 500, { error: 'Terjadi kesalahan server.' });
  }
};
