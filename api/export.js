const { send, requireUser } = require('../lib/shared');

const DAY = 24 * 60 * 60 * 1000;
const WIB = '+07:00';
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const ymd = d => d.toISOString().slice(0, 10);

// Data mentah untuk rekap Excel (admin saja). File .xlsx dibuat di browser dari data ini.
module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method tidak diizinkan.' });
    const result = await requireUser(req, ['admin']);
    if (result.error) return send(res, result.error.status, { error: result.error.message });
    const { supabase } = result;

    const today = ymd(new Date(Date.now() + 7 * 60 * 60 * 1000)); // tanggal hari ini di WIB
    const to = isDate(req.query.to) ? req.query.to : today;
    const from = isDate(req.query.from) ? req.query.from : ymd(new Date(Date.parse(to + 'T00:00:00Z') - 29 * DAY));
    if (from > to) return send(res, 400, { error: 'Tanggal awal tidak boleh setelah tanggal akhir.' });
    if (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z') > 366 * DAY) return send(res, 400, { error: 'Rentang maksimal 1 tahun.' });

    const start = new Date(`${from}T00:00:00${WIB}`).toISOString();
    const end = new Date(new Date(`${to}T00:00:00${WIB}`).getTime() + DAY).toISOString();

    const transactions = [];
    for (let page = 0; page < 10; page++) {
      const { data, error } = await supabase.from('transactions')
        .select('id,total_amount,notes,created_at,cashier_id,transaction_items(product_name,quantity,unit_price)')
        .gte('created_at', start).lt('created_at', end)
        .order('created_at', { ascending: true }).range(page * 1000, page * 1000 + 999);
      if (error) { console.error('[api/export tx]', error); return send(res, 500, { error: 'Gagal mengambil transaksi.' }); }
      transactions.push(...data);
      if (data.length < 1000) break;
    }

    const cashierIds = [...new Set(transactions.map(t => t.cashier_id).filter(Boolean))];
    const cashiers = {};
    if (cashierIds.length) {
      const { data } = await supabase.from('profiles').select('id,full_name').in('id', cashierIds);
      (data || []).forEach(p => { cashiers[p.id] = p.full_name || ''; });
    }

    const orders = {};
    const txIds = transactions.map(t => t.id);
    for (let i = 0; i < txIds.length; i += 200) {
      const { data } = await supabase.from('orders').select('code,customer_name,transaction_id').in('transaction_id', txIds.slice(i, i + 200));
      (data || []).forEach(o => { orders[o.transaction_id] = { code: o.code, customer_name: o.customer_name }; });
    }

    return send(res, 200, {
      from, to,
      transactions: transactions.map(t => ({
        id: t.id,
        created_at: t.created_at,
        total_amount: t.total_amount,
        notes: t.notes,
        cashier: cashiers[t.cashier_id] || '',
        order: orders[t.id] || null,
        items: (t.transaction_items || []).map(i => ({ product_name: i.product_name, quantity: i.quantity, unit_price: i.unit_price }))
      }))
    });
  } catch (e) {
    console.error('[api/export]', e);
    return send(res, 500, { error: 'Terjadi kesalahan server.' });
  }
};
