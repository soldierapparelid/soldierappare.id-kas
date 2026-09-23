(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KasCompat = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var OLD = ['Tanggal','Tipe','Kategori','Channel','Jumlah','Keterangan'];
  var NEW = ['ID','Tanggal kas','Jenis','Masuk/Keluar','Kategori','Rekening/Sumber','Jumlah kas (Rp)','Omzet bruto (Rp)','Tanggal omzet','Status tinjauan','Catatan'];
  function norm(text) { return String(text == null ? '' : text).trim().toLowerCase(); }
  function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
  function array(value) { return Array.isArray(value) ? value : []; }
  function safeText(value) {
    var text = String(value == null ? '' : value);
    return /^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
  }
  function financeValid(F) {
    return !!(F && typeof F.classify === 'function' && typeof F.validDate === 'function' && typeof F.validMonth === 'function' && typeof F.validAmount === 'function' && F.flows);
  }
  function dashboardExport(tx, month, F) {
    var result = { data: { state: { income: [], expense: [], catalog: [], aset: [], stokBahanBaku: 0, setupSaldo: {}, inputs: {} }, version: 'kas-sync' },
      skipped: 0, skippedByReason: { voided: 0, outsideMonth: 0, personal: 0, transfer: 0, opening: 0, shopee: 0 }, warnings: [], errors: [] };
    function skip(reason) { result.skipped += 1; result.skippedByReason[reason] += 1; }
    if (!financeValid(F)) { result.errors.push('Modul perhitungan kas tidak tersedia.'); return result; }
    if (!F.validMonth(month)) { result.errors.push('Bulan ekspor belum valid.'); return result; }
    if (!Array.isArray(tx)) { result.errors.push('Daftar transaksi tidak valid.'); return result; }
    var mappings = [
      ['bayar jahit','Beban Jahit'], ['bahan baku','Bahan Baku'], ['aksesoris','BOP'],
      ['upah','Beban Gaji'], ['gaji','Beban Gaji'], ['listrik','Beban Listrik'], ['internet','Beban Listrik'],
      ['konsumsi','BOP'], ['maintenance','Beban Maintenance'], ['servis','Beban Maintenance'], ['service','Beban Maintenance'],
      ['beli bahan','Bahan Baku'], ['produksi','Beban Jahit'], ['jahit','Beban Jahit'], ['sablon','BOP'], ['bordir','BOP'],
      ['packaging','BOP'], ['iklan','Beban Iklan'], ['ongkir','Beban Ongkir'], ['operasional','Beban Gaji'], ['beban bunga','Beban Bunga']
    ];
    var usedIds = new Set();
    tx.forEach(function (t, index) {
      if (t && t.voided === true) { skip('voided'); return; }
      if (!t || typeof t !== 'object') { result.errors.push('Catatan ke-' + (index + 1) + ' tidak valid.'); return; }
      var flow = F.classify(t), meta = F.flows[flow];
      if (meta && meta.scope === 'personal') { skip('personal'); return; }
      if (flow === 'transferIn' || flow === 'transferOut') { skip('transfer'); return; }
      if (flow === 'openingBusiness') { skip('opening'); return; }
      if (!F.validDate(t.tanggal)) { result.errors.push('Tanggal transaksi ' + (t.id || index + 1) + ' belum valid; bulan ekspor tidak dapat dipastikan.'); return; }
      if (t.tanggal.slice(0, 7) !== month) { skip('outsideMonth'); return; }
      if (flow === 'review') { result.errors.push('Transaksi ' + (t.id || index + 1) + ' perlu dipilih jenisnya sebelum ekspor Dashboard.'); return; }
      if (!F.validAmount(t.jumlah)) { result.errors.push('Nominal transaksi ' + (t.id || index + 1) + ' belum valid.'); return; }
      if (flow === 'sale' && norm(t.channel).indexOf('shopee') !== -1) { skip('shopee'); return; }
      if (typeof t.id !== 'string' || !t.id.trim() || usedIds.has(t.id)) { result.errors.push('ID transaksi kosong atau ganda pada baris ' + (index + 1) + '.'); return; }
      usedIds.add(t.id);
      if (flow === 'loan') { result.errors.push('Pinjaman masuk ' + t.id + ' tidak diekspor: format Dashboard lama tidak memiliki pemetaan pokok pinjaman yang aman.'); return; }
      if (flow === 'businessIncome' && t.taxTreatment !== 'nonOmzet') { result.errors.push('Pemasukan lain ' + t.id + ' belum ditinjau perlakuannya.'); return; }
      var category = String(t.kategori || ''), note = String(t.catatan || '');
      if (flow === 'sale' || flow === 'capital' || flow === 'businessIncome') {
        var type = flow === 'sale' ? 'penjualan' : flow === 'capital' ? 'modal' : 'lain';
        result.data.state.income.push({ tgl: t.tanggal, order: 'KAS-' + t.id, ch: t.channel || '',
          prod: type === 'penjualan' ? note : '[' + category + '] ' + note, qty: 1, harga: t.jumlah, jenis: type, sumber: 'kas-command' });
        if (flow === 'businessIncome' && !result.warnings.some(function (w) { return w.indexOf('Pemasukan usaha lainnya') === 0; })) {
          result.warnings.push('Pemasukan usaha lainnya dikirim sebagai jenis lain. Periksa penggolongan pada Dashboard lama; ini bukan omzet UMKM otomatis.');
        }
      } else if (flow === 'expense' || flow === 'debtPayment' || flow === 'ownerDraw' || flow === 'taxPayment') {
        var mapped = { kat: 'Beban Lain', jenis: 'operasi' };
        if (flow === 'ownerDraw') mapped = { kat: 'Prive', jenis: 'prive' };
        else if (flow === 'debtPayment') mapped = { kat: 'Bayar Utang', jenis: 'utang' };
        else if (flow === 'taxPayment') mapped.kat = 'Beban Pajak';
        else {
          var lower = norm(category);
          for (var j = 0; j < mappings.length; j += 1) {
            if (lower.indexOf(mappings[j][0]) !== -1) { mapped.kat = mappings[j][1]; break; }
          }
        }
        result.data.state.expense.push({ tgl: t.tanggal, desc: '[' + category + '] ' + note,
          kat: mapped.kat, jenis: mapped.jenis, jml: t.jumlah, kredit: false });
      } else result.errors.push('Jenis transaksi ' + t.id + ' belum didukung format Dashboard lama.');
    });
    result.warnings.push('Ekspor Dashboard lama memakai jumlah kas dan tanggal kas, bukan omzet bruto atau laporan pajak.');
    if (result.skippedByReason.shopee) result.warnings.push('Penjualan Shopee dilewati seperti format lama; gunakan laporan Shopee di Dashboard agar tidak tercatat dua kali.');
    if (result.errors.length) {
      // Never give callers a plausible partial dashboard export after an error.
      result.data = null;
    }
    return result;
  }
  function parseCSV(text) {
    if (typeof text !== 'string') throw new Error('Isi CSV harus berupa teks.');
    text = text.replace(/^\uFEFF/, '');
    if (!text.trim()) throw new Error('File CSV kosong.');
    var rows = [], row = [], cell = '', quoted = false, closed = false;
    function endCell() { row.push(cell); cell = ''; closed = false; }
    function endRow() { endCell(); if (row.some(function (v) { return v !== ''; })) rows.push(row); row = []; }
    for (var i = 0; i < text.length; i += 1) {
      var c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 1; }
          else { quoted = false; closed = true; }
        } else cell += c;
      } else if (c === ',') endCell();
      else if (c === '\r' || c === '\n') { endRow(); if (c === '\r' && text[i + 1] === '\n') i += 1; }
      else if (c === '"') {
        if (cell !== '' || closed) throw new Error('Tanda kutip CSV tidak valid. Gunakan format CSV dengan kutip ganda.');
        quoted = true;
      } else {
        if (closed) throw new Error('Ada teks setelah penutup kutip CSV.');
        cell += c;
      }
    }
    if (quoted) throw new Error('Ada tanda kutip CSV yang belum ditutup.');
    if (cell !== '' || row.length || closed) endRow();
    if (!rows.length) throw new Error('File CSV tidak mempunyai judul kolom.');
    return rows;
  }
  function amount(cell, allowZero) {
    if (!/^\d+$/.test(cell)) return null;
    var value = Number(cell);
    return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0) ? value : null;
  }
  function baseFingerprint(t) {
    return JSON.stringify([t.tanggal, t.tipe, t.kategori || '', t.channel || '', t.jumlah, t.catatan || '']);
  }
  function idFor(fingerprint) {
    var a = 2166136261, b = 2246822519;
    for (var i = 0; i < fingerprint.length; i += 1) {
      a = Math.imul(a ^ fingerprint.charCodeAt(i), 16777619) >>> 0;
      b = Math.imul(b ^ fingerprint.charCodeAt(i), 3266489917) >>> 0;
    }
    return 'csv-' + a.toString(36) + '-' + b.toString(36);
  }
  function importCSV(text, existing, F) {
    var result = { records: [], skipped: 0, errors: [], warnings: [], format: null };
    if (!financeValid(F)) { result.errors.push('Modul perhitungan kas tidak tersedia.'); return result; }
    if (!Array.isArray(existing)) { result.errors.push('Daftar transaksi sekarang tidak valid.'); return result; }
    var rows;
    try { rows = parseCSV(text); } catch (error) { result.errors.push(error.message); return result; }
    var header = rows[0].map(norm), expected;
    if (header.length === OLD.length && OLD.every(function (h) { return header.indexOf(norm(h)) !== -1; })) { result.format = 'legacy'; expected = OLD; }
    else if (header.length === NEW.length && NEW.every(function (h) { return header.indexOf(norm(h)) !== -1; })) { result.format = 'current'; expected = NEW; }
    else { result.errors.push('Format kolom tidak dikenali. Gunakan CSV transaksi Kas Command, bukan rekap pajak atau ringkasan.'); return result; }
    if (new Set(header).size !== header.length) { result.errors.push('Judul kolom CSV tidak boleh ganda.'); return result; }
    var index = {};
    expected.forEach(function (h) { index[h] = header.indexOf(norm(h)); });
    var byId = new Map(), fingerprints = new Set();
    existing.forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      if (typeof t.id === 'string' && t.id) {
        if (byId.has(t.id)) result.errors.push('Data saat ini memiliki ID ganda: ' + t.id + '. Periksa data sebelum impor.');
        byId.set(t.id, t);
      }
      fingerprints.add(baseFingerprint(t));
    });
    var flowByLabel = {};
    Object.keys(F.flows).forEach(function (flow) { flowByLabel[F.flows[flow].label] = flow; });
    function currentView(t) {
      var flow = F.classify(t), gross = flow === 'sale' ? (t.gross == null ? 'Belum diperiksa' : t.gross) : '';
      return [String(t.id), String(t.tanggal), F.flows[flow].label, t.tipe === 'in' ? 'Masuk' : 'Keluar',
        safeText(t.kategori || ''), safeText(t.channel || ''), String(t.jumlah), String(gross),
        flow === 'sale' ? String(t.omzetTanggal || t.tanggal) : '', safeText(t.catatan || '')];
    }
    rows.slice(1).forEach(function (cells, offset) {
      var label = 'Baris ' + (offset + 2);
      if (cells.length !== header.length) { result.errors.push(label + ': jumlah kolom tidak sesuai.'); return; }
      function get(name) { return cells[index[name]]; }
      var modern = result.format === 'current';
      var date = get(modern ? 'Tanggal kas' : 'Tanggal'), direction = norm(get(modern ? 'Masuk/Keluar' : 'Tipe'));
      var cash = amount(get(modern ? 'Jumlah kas (Rp)' : 'Jumlah'), false);
      if (!F.validDate(date)) { result.errors.push(label + ': tanggal harus valid dengan format YYYY-MM-DD.'); return; }
      if (direction !== 'masuk' && direction !== 'keluar' && direction !== 'in' && direction !== 'out') { result.errors.push(label + ': arah transaksi tidak dikenal.'); return; }
      if (cash === null) { result.errors.push(label + ': jumlah harus angka rupiah bulat positif tanpa Rp, titik, atau koma. Saldo awal bertanda minus harus dipulihkan lewat Backup JSON.'); return; }
      var record = { id: '', tanggal: date, tipe: direction === 'masuk' || direction === 'in' ? 'in' : 'out',
        kategori: get('Kategori'), channel: get(modern ? 'Rekening/Sumber' : 'Channel'), jumlah: cash,
        catatan: get(modern ? 'Catatan' : 'Keterangan') };
      if (modern) {
        record.id = get('ID');
        if (!record.id.trim()) { result.errors.push(label + ': ID wajib diisi untuk CSV baru.'); return; }
        var flowLabel = get('Jenis');
        if (!own(flowByLabel, flowLabel)) { result.errors.push(label + ': jenis transaksi belum dikenal.'); return; }
        var flow = flowByLabel[flowLabel];
        if (flow === 'openingBusiness') { result.errors.push(label + ': saldo awal hanya dapat dipulihkan melalui Backup JSON lengkap.'); return; }
        record.flow = flow;
        if (F.flows[flow].tipe && record.tipe !== F.flows[flow].tipe) { result.errors.push(label + ': jenis dan arah transaksi tidak cocok.'); return; }
        var status = get('Status tinjauan');
        if (status !== '' && status !== 'Perlu ditinjau') { result.errors.push(label + ': status tinjauan tidak dikenal.'); return; }
        if (flow === 'sale') {
          var grossText = get('Omzet bruto (Rp)'), gross = amount(grossText, true), omzetDate = get('Tanggal omzet');
          if (grossText === 'Belum diperiksa') record.gross = undefined;
          else if (gross === null) { result.errors.push(label + ': omzet bruto harus angka bulat nol atau lebih, atau Belum diperiksa.'); return; }
          else record.gross = gross;
          if (!F.validDate(omzetDate)) { result.errors.push(label + ': tanggal omzet belum valid.'); return; }
          record.omzetTanggal = omzetDate;
        } else if (get('Omzet bruto (Rp)') !== '' || get('Tanggal omzet') !== '') { result.errors.push(label + ': omzet hanya boleh diisi untuk penjualan.'); return; }
        if (flow === 'businessIncome') record.taxTreatment = 'review';
        if (byId.has(record.id)) {
          var previous = byId.get(record.id);
          var incoming = [record.id, record.tanggal, flowLabel, record.tipe === 'in' ? 'Masuk' : 'Keluar', record.kategori, record.channel, String(record.jumlah),
            flow === 'sale' ? String(record.gross == null ? 'Belum diperiksa' : record.gross) : '', flow === 'sale' ? record.omzetTanggal : '', record.catatan];
          if (JSON.stringify(currentView(previous)) === JSON.stringify(incoming)) { result.skipped += 1; return; }
          result.errors.push(label + ': ID ' + record.id + ' sudah ada dengan isi berbeda. Tidak ada data yang ditimpa.'); return;
        }
      } else {
        var fingerprint = baseFingerprint(record);
        if (fingerprints.has(fingerprint)) { result.skipped += 1; return; }
        record.id = idFor(fingerprint);
        var suffix = 0, baseId = record.id;
        while (byId.has(record.id)) { suffix += 1; record.id = baseId + '-' + suffix; }
      }
      fingerprints.add(baseFingerprint(record)); byId.set(record.id, record); result.records.push(record);
    });
    if (result.format === 'current') result.warnings.push('CSV hanya memuat transaksi, bukan cadangan lengkap. Rincian utang, tautan pembayaran, rencana jatah, dan pengaturan pajak tidak dipulihkan. Pemasukan usaha lainnya perlu ditinjau lagi.');
    else result.warnings.push('CSV lama tidak memiliki ID atau omzet bruto. Catatan yang persis sama dilewati; penjualan lama tetap perlu konfirmasi omzet. Gunakan Backup JSON untuk pemulihan lengkap.');
    if (result.errors.length) result.records = [];
    return result;
  }
  return Object.freeze({ dashboardExport: dashboardExport, importCSV: importCSV });
}));
