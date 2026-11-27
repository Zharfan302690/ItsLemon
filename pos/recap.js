// Membuat rekap Excel (.xlsx) dari data /api/export. Dipakai di browser (ExcelJS dari CDN) dan Node (untuk uji).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LemonRecap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const GREEN = 'FF0F5B34', YELLOW = 'FFF6C635', CREAM = 'FFFFF4D6';
  const RP = '"Rp"#,##0';

  const wib = iso => {
    const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
    const p = n => String(n).padStart(2, '0');
    return { date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` };
  };

  function header(sheet, columns) {
    sheet.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width }));
    const row = sheet.getRow(1);
    row.height = 24;
    row.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  function totalRow(sheet, cells) {
    const row = sheet.addRow(cells);
    row.eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } };
      cell.border = { top: { style: 'thin', color: { argb: GREEN } } };
    });
    return row;
  }

  // data = respons /api/export: { from, to, transactions: [...] }
  function build(ExcelJS, data) {
    const txs = data.transactions || [];
    const wb = new ExcelJS.Workbook();
    wb.creator = "It's Lemon";
    wb.created = new Date();

    const sumSheet = wb.addWorksheet('Ringkasan', { properties: { tabColor: { argb: YELLOW } } });
    const txSheet = wb.addWorksheet('Transaksi');
    const itemSheet = wb.addWorksheet('Detail Item');
    const prodSheet = wb.addWorksheet('Per Produk');
    const daySheet = wb.addWorksheet('Per Hari');

    // --- Transaksi ---
    header(txSheet, [
      { header: 'No', key: 'no', width: 6 }, { header: 'Tanggal', key: 'date', width: 12 },
      { header: 'Jam', key: 'time', width: 10 }, { header: 'ID Transaksi', key: 'id', width: 14 },
      { header: 'Sumber', key: 'source', width: 18 }, { header: 'Kode Pesanan', key: 'code', width: 14 },
      { header: 'Pelanggan', key: 'customer', width: 20 }, { header: 'Kasir', key: 'cashier', width: 18 },
      { header: 'Jumlah Item', key: 'qty', width: 12 }, { header: 'Total (Rp)', key: 'total', width: 16 },
      { header: 'Catatan', key: 'notes', width: 40 }
    ]);
    // --- Detail Item ---
    header(itemSheet, [
      { header: 'Tanggal', key: 'date', width: 12 }, { header: 'Jam', key: 'time', width: 10 },
      { header: 'ID Transaksi', key: 'id', width: 14 }, { header: 'Produk', key: 'product', width: 26 },
      { header: 'Qty', key: 'qty', width: 8 }, { header: 'Harga Satuan', key: 'price', width: 16 },
      { header: 'Subtotal', key: 'sub', width: 16 }
    ]);

    let itemRow = 1;
    txs.forEach((t, i) => {
      const w = wib(t.created_at);
      const items = t.items || [];
      const qty = items.reduce((s, it) => s + it.quantity, 0);
      txSheet.addRow({
        no: i + 1, date: w.date, time: w.time, id: String(t.id).slice(0, 8), source: t.order ? 'Pesanan online' : 'Kasir',
        code: t.order ? t.order.code : '', customer: t.order ? t.order.customer_name : '', cashier: t.cashier || '',
        qty, total: t.total_amount, notes: t.notes || ''
      });
      items.forEach(it => {
        itemRow++;
        itemSheet.addRow({ date: w.date, time: w.time, id: String(t.id).slice(0, 8), product: it.product_name, qty: it.quantity, price: it.unit_price });
        itemSheet.getCell(`G${itemRow}`).value = { formula: `E${itemRow}*F${itemRow}`, result: it.quantity * it.unit_price };
      });
    });
    const txLast = txs.length + 1;
    const itemLast = itemRow;
    txSheet.getColumn('total').numFmt = RP;
    itemSheet.getColumn('price').numFmt = RP;
    itemSheet.getColumn('sub').numFmt = RP;
    const sumTotal = txs.reduce((s, t) => s + t.total_amount, 0);
    const sumQty = txs.reduce((s, t) => s + (t.items || []).reduce((a, it) => a + it.quantity, 0), 0);
    totalRow(txSheet, ['', '', '', '', '', '', '', 'TOTAL',
      { formula: `SUM(I2:I${Math.max(txLast, 2)})`, result: sumQty },
      { formula: `SUM(J2:J${Math.max(txLast, 2)})`, result: sumTotal }, '']).getCell(10).numFmt = RP;
    txSheet.autoFilter = { from: 'A1', to: `K${Math.max(txLast, 1)}` };
    itemSheet.autoFilter = { from: 'A1', to: `G${Math.max(itemLast, 1)}` };

    // --- Per Produk ---
    const products = [...new Set(txs.flatMap(t => (t.items || []).map(i => i.product_name)))].sort((a, b) => a.localeCompare(b, 'id'));
    header(prodSheet, [
      { header: 'Produk', key: 'p', width: 28 }, { header: 'Qty Terjual', key: 'q', width: 14 },
      { header: 'Omzet (Rp)', key: 'o', width: 18 }, { header: '% Omzet', key: 'pct', width: 12 }
    ]);
    products.forEach((name, i) => {
      const r = i + 2;
      const rows = txs.flatMap(t => t.items || []).filter(it => it.product_name === name);
      const q = rows.reduce((s, it) => s + it.quantity, 0);
      const o = rows.reduce((s, it) => s + it.quantity * it.unit_price, 0);
      prodSheet.addRow([name]);
      prodSheet.getCell(`B${r}`).value = { formula: `SUMIF('Detail Item'!$D$2:$D$${Math.max(itemLast, 2)},A${r},'Detail Item'!$E$2:$E$${Math.max(itemLast, 2)})`, result: q };
      prodSheet.getCell(`C${r}`).value = { formula: `SUMIF('Detail Item'!$D$2:$D$${Math.max(itemLast, 2)},A${r},'Detail Item'!$G$2:$G$${Math.max(itemLast, 2)})`, result: o };
      prodSheet.getCell(`D${r}`).value = { formula: `IF(C$${products.length + 2}=0,0,C${r}/C$${products.length + 2})`, result: sumTotal ? o / sumTotal : 0 };
    });
    const pLast = products.length + 1;
    const pt = totalRow(prodSheet, ['TOTAL']);
    pt.getCell(2).value = { formula: `SUM(B2:B${Math.max(pLast, 2)})`, result: sumQty };
    pt.getCell(3).value = { formula: `SUM(C2:C${Math.max(pLast, 2)})`, result: sumTotal };
    prodSheet.getColumn('o').numFmt = RP;
    prodSheet.getColumn('pct').numFmt = '0.0%';

    // --- Per Hari ---
    const days = [...new Set(txs.map(t => wib(t.created_at).date))].sort();
    header(daySheet, [
      { header: 'Tanggal', key: 'd', width: 14 }, { header: 'Jumlah Transaksi', key: 'n', width: 18 }, { header: 'Omzet (Rp)', key: 'o', width: 18 }
    ]);
    days.forEach((d, i) => {
      const r = i + 2;
      const list = txs.filter(t => wib(t.created_at).date === d);
      daySheet.addRow([d]);
      daySheet.getCell(`B${r}`).value = { formula: `COUNTIF(Transaksi!$B$2:$B$${Math.max(txLast, 2)},A${r})`, result: list.length };
      daySheet.getCell(`C${r}`).value = { formula: `SUMIF(Transaksi!$B$2:$B$${Math.max(txLast, 2)},A${r},Transaksi!$J$2:$J$${Math.max(txLast, 2)})`, result: list.reduce((s, t) => s + t.total_amount, 0) };
    });
    const dLast = days.length + 1;
    const dt = totalRow(daySheet, ['TOTAL']);
    dt.getCell(2).value = { formula: `SUM(B2:B${Math.max(dLast, 2)})`, result: txs.length };
    dt.getCell(3).value = { formula: `SUM(C2:C${Math.max(dLast, 2)})`, result: sumTotal };
    daySheet.getColumn('o').numFmt = RP;

    // --- Ringkasan ---
    sumSheet.columns = [{ width: 28 }, { width: 24 }];
    sumSheet.mergeCells('A1:B1');
    const title = sumSheet.getCell('A1');
    title.value = "It's Lemon · Rekap Penjualan";
    title.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    title.alignment = { vertical: 'middle' };
    sumSheet.getRow(1).height = 32;
    const online = txs.filter(t => t.order);
    const lines = [
      ['Periode', `${data.from} s/d ${data.to}`],
      ['Dibuat', new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB'],
      [],
      ['Jumlah transaksi', { formula: `COUNTA(Transaksi!D2:D${Math.max(txLast, 2)})`, result: txs.length }],
      ['Total item terjual', { formula: `SUM(Transaksi!I2:I${Math.max(txLast, 2)})`, result: sumQty }],
      ['Total omzet (Rp)', { formula: `SUM(Transaksi!J2:J${Math.max(txLast, 2)})`, result: sumTotal }],
      ['Rata-rata per transaksi (Rp)', { formula: 'IF(B5=0,0,B7/B5)', result: txs.length ? Math.round(sumTotal / txs.length) : 0 }],
      ['Transaksi dari pesanan online', { formula: `COUNTIF(Transaksi!E2:E${Math.max(txLast, 2)},"Pesanan online")`, result: online.length }],
      ['Transaksi di kasir', { formula: 'B5-B9', result: txs.length - online.length }]
    ];
    lines.forEach((l, i) => {
      const r = i + 2;
      if (!l.length) return;
      sumSheet.getCell(`A${r}`).value = l[0];
      sumSheet.getCell(`A${r}`).font = { bold: true };
      sumSheet.getCell(`B${r}`).value = l[1];
      sumSheet.getCell(`B${r}`).alignment = { horizontal: 'left' };
    });
    sumSheet.getCell('B7').numFmt = RP;
    sumSheet.getCell('B8').numFmt = RP;
    sumSheet.getCell('A12').value = 'Catatan: total pada lembar ini dihitung dengan rumus dari lembar Transaksi.';
    sumSheet.getCell('A12').font = { italic: true, color: { argb: 'FF69756C' } };
    return wb;
  }

  async function download(ExcelJS, data) {
    const wb = build(ExcelJS, data);
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rekap-itslemon-${data.from}_sd_${data.to}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return { build, download, wib };
});
