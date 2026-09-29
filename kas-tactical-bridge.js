/* Kas Command domain adapter. Reads the existing ledger; no demo data, migration,
 * restoration, cloud upload or automatic writes. Tactical supplies presentation only. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KasTacticalBridge = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var KEY = 'soldier_kas_v2';
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var record = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  var clone = function (v) { return v == null ? v : JSON.parse(JSON.stringify(v)); };
  var message = function (e) { return e && e.message ? e.message : String(e); };
  function add(a, b) { var n = a + b; if (!Number.isSafeInteger(n)) throw new Error('Total rupiah melampaui batas aman.'); return n; }
  function text(v) { if (v == null) return ''; if (typeof v !== 'string') throw new Error('Isian teks belum valid.'); return v.trim(); }
  function legacyAmount(v) {
    if (v == null || typeof v === 'boolean' || (typeof v !== 'number' && typeof v !== 'string') || String(v).trim() === '') throw new Error('Nominal utang belum valid.');
    var n = Number(v); if (!Number.isSafeInteger(n) || n < 0) throw new Error('Nominal utang harus rupiah bulat tidak negatif dalam batas aman.'); return n;
  }
  function create(options) {
    options = options || {};
    var storage = options.storage, F = options.F, S = options.S, A = options.A, B = options.B;
    if (!F || !S || !A || !storage) throw new Error('Modul atau penyimpanan Kas belum tersedia.');
    var loaded;
    try { loaded = S.open(storage, KEY); } catch (e) { loaded = { data: null, raw: null, error: 'Penyimpanan belum dapat dibaca: ' + message(e) }; }
    var DB = loaded.data ? clone(loaded.data) : null, raw = loaded.raw, blocked = !!loaded.error, error = loaded.error || '';
    function timestamp() { return new Date(options.now ? options.now() : Date.now()).toISOString(); }
    function nextId(next, extra) {
      var id = options.uid ? options.uid() : 'kas-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      var usedInDebt = next.pi.some(function (x) { return x && (x.id === id || ['bayar', 'tambahan'].some(function (key) { return Array.isArray(x[key]) && x[key].some(function (row) { return row && (row.id === id || row.txId === id); }); })); });
      if (typeof id !== 'string' || !id.trim() || next.tx.some(function (x) { return x && x.id === id; }) || usedInDebt || (extra || []).includes(id)) throw new Error('Identitas catatan baru belum unik. Coba lagi.');
      return id;
    }
    function fail(e) { error = message(e); return { ok: false, error: error }; }
    function checkFresh() {
      if (blocked) return { ok: false, blocked: true, error: error || 'Data belum aman untuk diubah.' };
      try {
        if (storage.getItem(KEY) !== raw) { blocked = true; error = 'Data berubah di tab lain. Isian belum disimpan; buka ulang setelah mencadangkan.'; }
      } catch (e) { blocked = true; error = 'Penyimpanan belum dapat dibaca: ' + message(e); }
      return { ok: !blocked, blocked: blocked, error: blocked ? error : '' };
    }
    function unavailableCash(month, why) {
      var x = { opening: null, incoming: null, outgoing: null, closing: null, available: false, provisional: false, status: 'unavailable', errors: [why] };
      return { month: month, operational: clone(x), personal: clone(x), tax: clone(x), available: false, ready: false, provisional: false, status: 'unavailable', errors: [why], unresolvedCount: 0, invalidCount: 0 };
    }
    function state(month) {
      checkFresh();
      var cash, summary = null, cashError = '', summaryError = '';
      try { if (!DB) throw new Error(error || 'Data belum dapat dibaca.'); cash = A.cashSummary(DB.tx, month, F); }
      catch (e) { cashError = message(e); cash = unavailableCash(month, cashError); }
      try { if (!DB) throw new Error(error || 'Data belum dapat dibaca.'); summary = F.summary(DB.tx, month); }
      catch (e) { summaryError = message(e); }
      return { data: clone(DB), blocked: blocked, error: error, cash: clone(cash), summary: clone(summary), cashError: cashError, summaryError: summaryError };
    }
    function history(next, type, previous) {
      if (next.history === undefined) next.history = [];
      if (!Array.isArray(next.history)) throw new Error('Riwayat lama belum dapat diperbarui dengan aman.');
      next.history.push({ type: type, at: timestamp(), record: clone(previous) });
    }
    function invalidateTaxConfirmation(next) {
      var previous = new Map(DB.tx.map(function (t) { return [t && t.id, t]; })), changed = [];
      next.tx.forEach(function (t) { var old = previous.get(t && t.id); previous.delete(t && t.id); if (JSON.stringify(old) !== JSON.stringify(t)) changed.push(old, t); });
      previous.forEach(function (t) { changed.push(t); });
      var years = new Set(), uncertain = false;
      changed.filter(Boolean).forEach(function (t) {
        var f = F.classify(t); if (!F.validDate(t.tanggal)) { uncertain = true; return; }
        if (f !== 'sale' && f !== 'businessIncome' && !(f === 'review' && t.tipe === 'in')) return;
        years.add(t.tanggal.slice(0, 4));
        if (t.omzetTanggal) { if (F.validDate(t.omzetTanggal)) years.add(t.omzetTanggal.slice(0, 4)); else uncertain = true; }
      });
      var months = (next.kasSettings || {}).taxMonths || {};
      Object.keys(months).forEach(function (m) { if ((uncertain || years.has(m.slice(0, 4))) && record(months[m])) months[m].complete = false; });
    }
    function write(change) {
      if (!checkFresh().ok || !DB) return fail(error || 'Data belum dapat dibaca.');
      try {
        var next = clone(DB); change(next); invalidateTaxConfirmation(next);
        var reserve = A.validate(next.tx, F); if (!reserve.ok) throw new Error(reserve.errors.join(' '));
        var result = S.transaction(storage, KEY, raw, next);
        if (!result.ok) { if (result.code === 'conflict' || result.code === 'read_failed') blocked = true; return fail(result.error); }
        DB = next; raw = result.raw; error = ''; return { ok: true, data: clone(DB) };
      } catch (e) { return fail(e); }
    }
    function validInput(input) {
      if (!record(input) || !F.validAmount(input.jumlah) || !F.validDate(input.tanggal)) throw new Error('Isi tanggal valid dan jumlah rupiah bulat lebih dari nol.');
    }
    function addTransaction(input) {
      return write(function (next) {
        validInput(input);
        var allowed = ['sale', 'businessIncome', 'personalIncome', 'capital', 'loan', 'expense', 'personalExpense', 'ownerDraw', 'taxPayment', 'taxReserve', 'taxReturn'];
        if (!allowed.includes(input.flow) || !own(F.flows, input.flow)) throw new Error('Jenis transaksi ini tidak dapat dibuat di sini. Pembayaran utang harus melalui Utang / bon.');
        if (own(input, 'id') || own(input, 'debtId') || own(input, 'paymentId')) throw new Error('Transaksi baru tidak boleh mengganti atau menautkan identitas catatan lama.');
        var t = { id: nextId(next), flow: input.flow, tipe: F.flows[input.flow].tipe, tanggal: input.tanggal, jumlah: input.jumlah,
          kategori: text(input.kategori) || F.flows[input.flow].label, channel: text(input.channel) || 'Tidak disebutkan', catatan: text(input.catatan), updatedAt: timestamp() };
        if (input.flow === 'sale') {
          if (own(input, 'gross') && input.gross != null) { if (!F.validAmount(input.gross, true)) throw new Error('Nilai penjualan sebelum potongan belum valid.'); t.gross = input.gross; }
          t.omzetTanggal = input.omzetTanggal === undefined ? input.tanggal : input.omzetTanggal;
          if (!F.validDate(t.omzetTanggal)) throw new Error('Tanggal penjualan belum valid.');
          if (input.salesSource !== undefined) t.salesSource = text(input.salesSource);
        } else if (own(input, 'gross') || own(input, 'omzetTanggal') || own(input, 'salesSource')) throw new Error('Rincian penjualan hanya berlaku untuk penjualan.');
        if (input.flow === 'taxPayment') {
          if (!['tax', 'operational'].includes(input.reserveAccount)) throw new Error('Pilih sumber pembayaran pajak: operasional atau cadangan pajak.');
          t.reserveAccount = input.reserveAccount;
        } else if (own(input, 'reserveAccount')) throw new Error('Sumber pembayaran pajak tidak berlaku untuk jenis transaksi ini.');
        if (input.flow === 'businessIncome') { if (input.taxTreatment !== undefined && !['nonOmzet', 'review'].includes(input.taxTreatment)) throw new Error('Perlakuan pajak pemasukan belum valid.'); t.taxTreatment = input.taxTreatment || 'review'; }
        if (B && typeof B.policy === 'function' && typeof B.stamp === 'function' && B.policy(next.kasSettings || {}).valid) t = B.stamp(t, null, next.kasSettings || {}, F);
        next.tx.push(t);
      });
    }
    function debtIdentityErrors(list, x) {
      if (!record(x)) return ['Catatan utang bukan objek yang dapat dibaca.'];
      if (typeof x.id !== 'string' || !x.id.trim()) return ['Identitas utang belum valid.'];
      if (list.filter(function (p) { return p && p.id === x.id; }).length !== 1) return ['Identitas utang ganda.'];
      return [];
    }
    function debtValues(x) {
      if (!record(x)) throw new Error('Catatan utang belum valid.');
      var additions = x.tambahan === undefined ? [] : x.tambahan, payments = x.bayar === undefined ? [] : x.bayar;
      if (!Array.isArray(additions) || !Array.isArray(payments)) throw new Error('Riwayat utang belum valid.');
      var base = legacyAmount(x.jumlah), principal = base;
      additions.forEach(function (b) { if (!record(b)) throw new Error('Tambahan utang belum valid.'); principal = add(principal, legacyAmount(b.jumlah)); });
      var paid = own(x, 'legacyPaidOpening') ? legacyAmount(x.legacyPaidOpening) : !payments.length && x.status === 'lunas' ? base : 0;
      payments.forEach(function (b) { if (!record(b)) throw new Error('Riwayat pembayaran belum valid.'); if (!b.voided) paid = add(paid, legacyAmount(b.jumlah)); });
      if (paid > principal) throw new Error('Pembayaran tercatat melebihi pokok utang; periksa catatan lama.');
      return { principal: principal, paid: paid, remaining: add(principal, -paid) };
    }
    function preserveLegacyPaid(x) { if (!own(x, 'legacyPaidOpening') && !(x.bayar || []).length && x.status === 'lunas') x.legacyPaidOpening = legacyAmount(x.jumlah); }
    function debtList() {
      checkFresh(); if (!DB) return [];
      return DB.pi.map(function (x) {
        var errors = debtIdentityErrors(DB.pi, x), values = null;
        try { if (!errors.length) values = debtValues(x); } catch (e) { errors.push(message(e)); }
        return { entry: clone(x), values: values, available: !errors.length, errors: errors };
      }).sort(function (a, b) { return Number(!!b.values && b.values.remaining > 0) - Number(!!a.values && a.values.remaining > 0); });
    }
    function findDebt(next, id) {
      var found = next.pi.filter(function (x) { return x && x.id === id; });
      if (typeof id !== 'string' || !id.trim() || found.length !== 1 || found[0].tipe !== 'utang') throw new Error('Utang tidak ditemukan atau identitasnya belum unik.');
      var errors = debtIdentityErrors(next.pi, found[0]); if (errors.length) throw new Error(errors.join(' ')); debtValues(found[0]); return found[0];
    }
    function saveDebt(input) {
      return write(function (next) {
        validInput(input);
        var name = text(input.nama), note = text(input.catatan), due = text(input.tempo);
        if (!name) throw new Error('Nama pemberi pinjaman / supplier wajib diisi.');
        if (due && !F.validDate(due)) throw new Error('Tanggal jatuh tempo belum valid.');
        if (input.id !== undefined) {
          if (!['edit', 'add'].includes(input.mode || 'edit')) throw new Error('Mode perubahan utang belum valid.');
          var debt = findDebt(next, input.id); history(next, 'debtEdit', debt); preserveLegacyPaid(debt);
          if (input.mode === 'add') {
            if (!debt.tambahan) debt.tambahan = [];
            debt.tambahan.push({ id: nextId(next), tanggal: input.tanggal, jumlah: input.jumlah, catatan: note });
            if (due) debt.tempo = due;
          } else { debt.nama = name; debt.jumlah = input.jumlah; debt.tanggal = input.tanggal; debt.tempo = due; debt.catatan = note; }
          debtValues(debt);
        } else {
          if (input.mode) throw new Error('Pilih catatan utang dahulu untuk mengubah atau menambah pokok.');
          next.pi.push({ id: nextId(next), tipe: 'utang', nama: name, jumlah: input.jumlah, tanggal: input.tanggal, tempo: due, catatan: note, bayar: [], tambahan: [], status: 'belum' });
        }
      });
    }
    function payDebt(input) {
      return write(function (next) {
        validInput(input); var debt = findDebt(next, input.id), v = debtValues(debt), channel = text(input.channel) || 'BCA Operasional';
        if (input.jumlah > v.remaining) throw new Error('Pembayaran melebihi sisa utang.');
        var pid = nextId(next), tid = nextId(next, [pid]); preserveLegacyPaid(debt);
        if (!debt.bayar) debt.bayar = [];
        debt.bayar.push({ id: pid, txId: tid, tanggal: input.tanggal, jumlah: input.jumlah, channel: channel });
        next.tx.push({ id: tid, debtId: input.id, paymentId: pid, tanggal: input.tanggal, tipe: 'out', flow: 'debtPayment', kategori: 'Bayar Utang', jumlah: input.jumlah, channel: channel, catatan: 'Bayar pokok utang: ' + debt.nama });
        debtValues(debt);
      });
    }
    function cancelTransaction(id) {
      return write(function (next) {
        var matches = next.tx.filter(function (x) { return x && x.id === id; });
        if (typeof id !== 'string' || !id.trim() || matches.length !== 1) throw new Error('Transaksi tidak ditemukan atau identitasnya belum unik.');
        var row = matches[0];
        if (F.isOpeningBalance(row) || (!row.flow && !row.debtId && ['Bayar Utang', 'Pelunasan Piutang'].includes(row.kategori) && next.pi.some(function (x) { return x && Array.isArray(x.bayar) && x.bayar.length; }))) throw new Error('Saldo awal atau pembayaran lama ini dilindungi; periksa melalui aplikasi lama/cadangan.');
        if (row.voided === true) return;
        if (row.debtId || row.paymentId) {
          if (F.classify(row) !== 'debtPayment' || !row.debtId || !row.paymentId) throw new Error('Tautan pembayaran utang belum lengkap.');
          var debt = findDebt(next, row.debtId), payments = (debt.bayar || []).filter(function (p) { return p && p.id === row.paymentId; });
          if (payments.length !== 1 || payments[0].txId !== row.id || payments[0].jumlah !== row.jumlah || payments[0].tanggal !== row.tanggal || payments[0].voided) throw new Error('Riwayat pembayaran dan transaksi kas tidak cocok; tidak ada perubahan disimpan.');
          history(next, 'debtPaymentVoid', debt); payments[0].voided = true;
        }
        history(next, 'void', row); row.voided = true; row.updatedAt = timestamp();
      });
    }
    function backup() {
      if (loaded.error && loaded.raw === null) throw new Error('Data browser belum dapat dibaca. Tidak membuat cadangan kosong.');
      return raw !== null ? raw : JSON.stringify(DB, null, 2);
    }
    function reserveLabel(t) { return t.reserveAccount === 'tax' ? 'cadangan pajak' : t.reserveAccount === 'operational' ? 'operasional' : 'belum valid — perlu diperiksa'; }
    function plainRows(rows) {
      return [['Tanggal', 'Jenis transaksi', 'Kategori', 'Rekening / sumber', 'Pemasukan (Rp)', 'Pengeluaran (Rp)', 'Penjualan sebelum potongan (Rp)', 'Tanggal penjualan', 'Keterangan']].concat(rows.map(function (x) {
        var f = F.classify(x), note = [f === 'review' ? 'Jenis perlu ditinjau' : '', own(x, 'reserveAccount') ? 'Dibayar dari ' + reserveLabel(x) : '', x.catatan || ''].filter(Boolean).join(' · ');
        return [x.tanggal, F.flows[f].label, x.kategori || '', [x.salesSource, x.channel].filter(Boolean).join(' / '), x.tipe === 'in' ? x.jumlah : '', x.tipe === 'out' ? x.jumlah : '', f === 'sale' ? F.validAmount(x.gross, true) ? x.gross : 'Belum diisi' : '', f === 'sale' ? x.omzetTanggal || x.tanggal : '', note];
      }));
    }
    function consultant(month) {
      if (!checkFresh().ok || !DB) throw new Error(error || 'Data perangkat belum dapat dipastikan.');
      var cashState = A.cashSummary(DB.tx, month, F), s = F.summary(DB.tx, month);
      if (!cashState.operational.available || !cashState.tax.available) throw new Error(cashState.errors.join(' ') || 'Saldo belum dapat dihitung aman.');
      if (s.invalidCount) throw new Error('Ada tanggal atau nominal yang belum valid.');
      var issues = [], nonPersonal = s.tx.filter(function (x) { return F.flows[F.classify(x)].scope !== 'personal'; });
      if (nonPersonal.some(function (x) { return F.classify(x) === 'review'; })) issues.push('Ada transaksi yang belum jelas jenisnya; keterangannya tetap disertakan untuk diperiksa.');
      if (nonPersonal.some(function (x) { return F.classify(x) === 'sale' && !F.validAmount(x.gross, true); })) issues.push('Ada penjualan yang nilai sebelum potongannya belum diisi. Uang diterima tetap tercantum.');
      var cash = [], transfers = [], openings = [], incoming = 0, outgoing = 0;
      s.tx.slice().sort(function (a, b) { return a.tanggal.localeCompare(b.tanggal) || String(a.id).localeCompare(String(b.id)); }).forEach(function (x) {
        var f = F.classify(x); if (F.flows[f].scope === 'personal') return;
        if (F.isOpeningBalance(x)) { openings.push(x); return; }
        if (['transferIn', 'transferOut', 'taxReserve', 'taxReturn'].includes(f)) { transfers.push(x); return; }
        if (!F.validAmount(x.jumlah)) throw new Error('Ada nominal transaksi yang belum valid.');
        cash.push(x); if (x.tipe === 'in') incoming = add(incoming, x.jumlah); else if (x.tipe === 'out') outgoing = add(outgoing, x.jumlah); else throw new Error('Arah transaksi belum valid.');
      });
      var difference = add(incoming, -outgoing), cashRows = plainRows(cash), transferRows = transfers.length ? plainRows(transfers) : [], openingRows = openings.length ? [['Tanggal', 'Keterangan', 'Jumlah (Rp)']].concat(openings.map(function (x) { return [x.tanggal, x.catatan || F.flows[F.classify(x)].label, x.jumlah]; })) : [];
      var rows = [['Laporan pemasukan dan pengeluaran usaha', month], ['Total pemasukan (Rp)', incoming], ['Total pengeluaran (Rp)', outgoing], ['Selisih pemasukan dan pengeluaran (Rp)', difference], ['Periode', 'Berdasarkan tanggal uang masuk / keluar. Rincian pribadi, saldo awal dan transfer sendiri tidak dihitung dalam total di atas.']];
      if (issues.length) rows.push(['Catatan pemeriksaan', issues.join(' ')]);
      rows = rows.concat([[]], cashRows);
      if (transfers.length) rows = rows.concat([[], ['Transfer antar-rekening sendiri — tidak masuk total']], transferRows);
      if (openings.length) rows = rows.concat([[], ['Saldo awal tercatat — bukan pemasukan']], openingRows);
      return { csv: F.csv(rows), incoming: incoming, outgoing: outgoing, issues: issues.slice(), cashCount: cash.length,
        pdfPayload: { month: month, monthLabel: new Date(month + '-01T12:00:00').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }), incoming: incoming, outgoing: outgoing, difference: difference, issues: issues.slice(), cashRows: cashRows, transferRows: transferRows, openingRows: openingRows } };
    }
    return Object.freeze({ state: state, checkFresh: checkFresh, backup: backup, addTransaction: addTransaction, cancelTransaction: cancelTransaction, saveDebt: saveDebt, payDebt: payDebt, debtList: debtList, consultant: consultant });
  }
  return Object.freeze({ KEY: KEY, create: create });
}));
