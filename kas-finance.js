(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KasFinance = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // This module never writes, migrates, deletes, or changes source transactions.
  var flows = {
    openingBusiness: { label: 'Saldo awal usaha (catatan lama)', tipe: 'in', scope: 'business', kind: 'opening' },
    sale: { label: 'Penjualan usaha', tipe: 'in', scope: 'business', kind: 'revenue' },
    businessIncome: { label: 'Pemasukan usaha lainnya', tipe: 'in', scope: 'business', kind: 'otherIncome' },
    personalIncome: { label: 'Pemasukan pribadi', tipe: 'in', scope: 'personal', kind: 'personal' },
    capital: { label: 'Modal dari uang pribadi', tipe: 'in', scope: 'business', kind: 'equity' },
    loan: { label: 'Pinjaman diterima usaha', tipe: 'in', scope: 'business', kind: 'debt' },
    expense: { label: 'Pengeluaran usaha', tipe: 'out', scope: 'business', kind: 'expense' },
    personalExpense: { label: 'Pengeluaran pribadi', tipe: 'out', scope: 'personal', kind: 'personal' },
    ownerDraw: { label: 'Jatah pribadi dari usaha', tipe: 'out', scope: 'business', kind: 'equity' },
    debtPayment: { label: 'Bayar pokok utang usaha', tipe: 'out', scope: 'business', kind: 'debt' },
    taxPayment: { label: 'Pembayaran pajak', tipe: 'out', scope: 'business', kind: 'tax' },
    transferIn: { label: 'Transfer masuk antar-rekening sendiri', tipe: 'in', scope: 'neutral', kind: 'transfer' },
    transferOut: { label: 'Transfer keluar antar-rekening sendiri', tipe: 'out', scope: 'neutral', kind: 'transfer' },
    review: { label: 'Perlu dipilih jenisnya', tipe: null, scope: 'neutral', kind: 'review' }
  };
  Object.keys(flows).forEach(function (key) { Object.freeze(flows[key]); });
  Object.freeze(flows);
  var expenseCategories = [
    'bayar jahit', 'bahan baku kain', 'aksesoris jahit', 'upah / gaji',
    'listrik / internet', 'konsumsi karyawan', 'maintenance / service',
    'beli bahan / hpp', 'packaging', 'operasional', 'produksi / jahit',
    'gaji / upah', 'ongkir / kirim', 'internet / pulsa', 'maintenance / servis',
    'listrik / air', 'sablon / bordir', 'perlengkapan kantor', 'lainnya'
  ];

  function normalized(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
  function validMonth(value) { return typeof value === 'string' && /^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(value); }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !validMonth(value.slice(0, 7))) return false;
    var year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day > 0 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }
  function validAmount(value, allowZero) {
    return typeof value === 'number' && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
  }
  function isOpeningBalance(t) {
    // A known historic opening-balance row, not arbitrary negative income.
    // Preserve its signed amount exactly; never reinterpret it as owner capital.
    return !!(t && t.id === 'SETUP_OPS' && t.tipe === 'in' &&
      t.kategori === 'Modal Masuk' && t.channel === 'BCA Operasional' &&
      t.catatan === 'Saldo Awal BCA Operasional' && t.tanggal === '2026-06-01' &&
      (!t.flow || t.flow === 'openingBusiness') && Number.isSafeInteger(t.jumlah));
  }
  function classify(t) {
    if (!t || typeof t !== 'object' || (t.tipe !== 'in' && t.tipe !== 'out')) return 'review';
    if (isOpeningBalance(t)) return 'openingBusiness';
    if (typeof t.flow === 'string' && t.flow) {
      if (!Object.prototype.hasOwnProperty.call(flows, t.flow)) return 'review';
      if (t.flow === 'openingBusiness') return 'review';
      return flows[t.flow].tipe && flows[t.flow].tipe !== t.tipe ? 'review' : t.flow;
    }
    var category = normalized(t.kategori), personal = normalized(t.channel) === 'bca pribadi';
    // Legacy transfers and ambiguous income need a human decision, not a guessed tax base.
    if (category === 'transfer antar rekening') return 'review';
    if (category === 'penjualan') return t.tipe === 'in' && !personal ? 'sale' : 'review';
    if (category === 'modal masuk') return t.tipe === 'in' ? 'capital' : 'review';
    if (category === 'tarik modal (prive)') return t.tipe === 'out' ? 'ownerDraw' : 'review';
    if (category === 'konsumsi pribadi') return t.tipe === 'out' ? 'personalExpense' : 'review';
    if (personal) return t.tipe === 'in' ? 'personalIncome' : 'personalExpense';
    if (category === 'bayar utang') return t.tipe === 'out' ? 'debtPayment' : 'review';
    if (category === 'pajak') return t.tipe === 'out' ? 'taxPayment' : 'review';
    if (t.tipe === 'out' && expenseCategories.indexOf(category) !== -1) return 'expense';
    return 'review';
  }
  function copy(value) {
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === 'object') {
      var result = {};
      Object.keys(value).forEach(function (key) {
        Object.defineProperty(result, key, { value: copy(value[key]), enumerable: true, writable: true, configurable: true });
      });
      return result;
    }
    return value;
  }
  function active(tx) { return (Array.isArray(tx) ? tx : []).filter(function (t) { return !(t && t.voided === true); }); }
  function transactionErrors(t) {
    var errors = [];
    if (!t || typeof t !== 'object') return ['Catatan transaksi tidak valid.'];
    if (!validDate(t.tanggal)) errors.push('Tanggal transaksi tidak valid.');
    if (!validAmount(t.jumlah) && !isOpeningBalance(t)) errors.push('Nominal harus berupa rupiah bulat positif.');
    if (t.tipe !== 'in' && t.tipe !== 'out') errors.push('Arah pemasukan atau pengeluaran belum valid.');
    return errors;
  }
  function checkedAdd(left, right) {
    var value = left + right;
    if (!Number.isSafeInteger(value)) throw new RangeError('Total melampaui batas perhitungan rupiah yang aman.');
    return value;
  }
  function cashEffect(t, flow) {
    var value = t.jumlah, meta = flows[flow], business = 0, personal = 0;
    if (meta.scope === 'business') business = t.tipe === 'in' ? value : -value;
    if (meta.scope === 'personal') personal = t.tipe === 'in' ? value : -value;
    if (flow === 'ownerDraw') personal = value;
    if (flow === 'capital') personal = -value;
    return { business: business, personal: personal };
  }
  function summary(tx, month) {
    if (!validMonth(month)) throw new RangeError('Pilih bulan dengan format YYYY-MM.');
    var result = {
      month: month, totals: {}, tx: [], businessIn: 0, businessOut: 0, personalIn: 0, personalOut: 0,
      cashBusinessOpening: 0, cashPersonalOpening: 0, cashBusinessClosing: 0, cashPersonalClosing: 0,
      operatingSurplus: 0, unresolved: { count: 0, amount: 0 }, invalid: { count: 0, records: [] },
      balanceUnresolvedCount: 0, balanceUnresolvedAmount: 0, balancesComplete: true
    };
    Object.keys(flows).forEach(function (flow) { result.totals[flow] = 0; });
    active(tx).forEach(function (t, index) {
      var errors = transactionErrors(t);
      if (errors.length) result.invalid.records.push({ index: index, id: t && t.id, errors: errors });
      // Keep dated invalid source rows visible in the selected detail; never count a malformed amount as zero.
      if (t && validDate(t.tanggal) && t.tanggal.slice(0, 7) === month) result.tx.push(copy(t));
      if (errors.length || t.tanggal.slice(0, 7) > month) return;
      var flow = classify(t), effect = cashEffect(t, flow), current = t.tanggal.slice(0, 7) === month;
      if (flow === 'openingBusiness') {
        result.cashBusinessOpening = checkedAdd(result.cashBusinessOpening, t.jumlah);
        result.cashBusinessClosing = checkedAdd(result.cashBusinessClosing, t.jumlah);
        if (current) result.totals.openingBusiness = checkedAdd(result.totals.openingBusiness, t.jumlah);
        return;
      }
      if (flow === 'review') {
        result.balanceUnresolvedCount += 1;
        result.balanceUnresolvedAmount = checkedAdd(result.balanceUnresolvedAmount, t.jumlah);
      }
      result.cashBusinessClosing = checkedAdd(result.cashBusinessClosing, effect.business);
      result.cashPersonalClosing = checkedAdd(result.cashPersonalClosing, effect.personal);
      if (!current) {
        result.cashBusinessOpening = checkedAdd(result.cashBusinessOpening, effect.business);
        result.cashPersonalOpening = checkedAdd(result.cashPersonalOpening, effect.personal);
        return;
      }
      result.totals[flow] = checkedAdd(result.totals[flow], t.jumlah);
      if (flow === 'review') {
        result.unresolved.count += 1;
        result.unresolved.amount = checkedAdd(result.unresolved.amount, t.jumlah);
      }
      if (effect.business > 0) result.businessIn = checkedAdd(result.businessIn, effect.business);
      if (effect.business < 0) result.businessOut = checkedAdd(result.businessOut, -effect.business);
      if (effect.personal > 0) result.personalIn = checkedAdd(result.personalIn, effect.personal);
      if (effect.personal < 0) result.personalOut = checkedAdd(result.personalOut, -effect.personal);
    });
    result.operatingSurplus = checkedAdd(checkedAdd(result.totals.sale, result.totals.businessIncome), -result.totals.expense);
    result.invalid.count = result.invalid.records.length;
    result.invalidCount = result.invalid.count;
    result.unresolvedCount = result.unresolved.count;
    result.unresolvedAmount = result.unresolved.amount;
    result.balancesComplete = result.balanceUnresolvedCount === 0 && result.invalidCount === 0;
    return result;
  }
  function tax(tx, month, settings) {
    settings = settings || {};
    var result = {
      month: month, ready: false, rate: 0.005, exemption: 500000000, annualLimit: 4800000000,
      estimate: null, remaining: null, excessPayment: null, monthTurnover: 0, previousTurnover: 0,
      ytdTurnover: 0, taxableMonth: 0, unknownGross: 0, unresolvedCount: 0, invalidCount: 0,
      withheld: null, paid: null, turnoverProvisional: true, errors: [], warnings: []
    };
    function error(message) { if (result.errors.indexOf(message) === -1) result.errors.push(message); }
    if (!validMonth(month)) { error('Bulan laporan tidak valid.'); return result; }
    var year = month.slice(0, 4), start = settings.startMonth;
    var validStart = validMonth(start) && start.slice(0, 4) === year && start <= month;
    // The information subtotal remains useful before tax setup. It must not look like
    // zero sales simply because eligibility/coverage has not been confirmed yet.
    var informationalStart = validStart ? start : year + '-01';
    if (settings.eligibleConfirmed !== true) error('Konfirmasi bahwa usaha perorangan memenuhi ketentuan PPh final 0,5%.');
    if (settings.complete !== true) error('Konfirmasi omzet seluruh usaha sejak Januari sudah lengkap.');
    if (!validStart) error('Bulan awal pencatatan harus dalam tahun laporan dan tidak melewati bulan pilihan.');
    var opening = settings.openingTurnover;
    if (opening === undefined && start === year + '-01') opening = 0;
    if (!validAmount(opening, true)) error('Isi omzet sebelum bulan awal pencatatan dengan rupiah bulat, termasuk nol bila memang tidak ada.');
    else if (start === year + '-01' && opening !== 0) error('Omzet sebelum Januari harus nol. Gunakan bulan awal yang sesuai untuk omzet sebelumnya.');
    else if (validStart) result.previousTurnover = opening;
    active(tx).forEach(function (t) {
      if (isOpeningBalance(t)) return;
      var cashDateValid = t && validDate(t.tanggal);
      var hasTaxDate = t && t.omzetTanggal !== undefined && t.omzetTanggal !== null && t.omzetTanggal !== '';
      var date = hasTaxDate ? t.omzetTanggal : t && t.tanggal;
      if (!cashDateValid || !validDate(date)) {
        result.invalidCount += 1;
        error('Perbaiki tanggal transaksi atau tanggal omzet yang tidak valid agar tahun dan bulan pajak pasti.');
        return;
      }
      var taxMonth = date.slice(0, 7), flow = classify(t);
      if (taxMonth.slice(0, 4) !== year || taxMonth > month) return;
      if ((flow === 'review' && t.tipe !== 'out') || (flow === 'businessIncome' && t.taxTreatment !== 'nonOmzet')) {
        result.unresolvedCount += 1;
        error('Tinjau pemasukan yang belum jelas jenisnya pada tahun laporan.');
        return;
      }
      if (flow !== 'sale' || taxMonth < informationalStart) return;
      if (!validAmount(t.jumlah)) {
        result.invalidCount += 1;
        error('Perbaiki nominal penerimaan penjualan yang tidak valid.');
      }
      var gross = t.gross;
      if (gross === undefined || gross === null || gross === '') {
        result.unknownGross += 1;
        error('Konfirmasi omzet bruto penjualan lama. Uang cair belum tentu sama dengan omzet.');
        gross = validAmount(t.jumlah) ? t.jumlah : 0;
      } else if (!validAmount(gross, true)) {
        result.invalidCount += 1;
        error('Omzet bruto penjualan harus berupa rupiah bulat nol atau lebih.');
        gross = 0;
      }
      if (taxMonth === month) result.monthTurnover = checkedAdd(result.monthTurnover, gross);
      else result.previousTurnover = checkedAdd(result.previousTurnover, gross);
    });
    result.ytdTurnover = checkedAdd(result.previousTurnover, result.monthTurnover);
    result.taxableMonth = Math.max(0, result.ytdTurnover - result.exemption) - Math.max(0, result.previousTurnover - result.exemption);
    if (result.ytdTurnover > result.annualLimit) result.warnings.push('Omzet tahun ini melewati Rp4,8 miliar. Periksa ketentuan untuk tahun berikutnya dan kelayakan bersama DJP atau konsultan pajak.');
    if (validAmount(settings.withheld, true)) result.withheld = settings.withheld;
    if (validAmount(settings.paid, true)) result.paid = settings.paid;
    if (result.withheld === null || result.paid === null) result.warnings.push('Isi pemotongan pihak lain dan pembayaran sendiri untuk bulan ini sebelum menghitung sisa perkiraan. Jangan catat bukti yang sama dua kali.');
    result.ready = result.errors.length === 0;
    result.turnoverProvisional = !result.ready;
    if (result.ready) {
      // An estimate in whole rupiah. The application does not submit a tax return or payment.
      result.estimate = Math.round(result.taxableMonth / 200);
      if (result.withheld !== null && result.paid !== null) {
        var settled = checkedAdd(result.withheld, result.paid);
        result.remaining = Math.max(0, result.estimate - settled);
        result.excessPayment = Math.max(0, settled - result.estimate);
        if (result.excessPayment > 0) result.warnings.push('Potongan atau pembayaran lebih besar dari estimasi. Cocokkan bukti; ini bukan pengembalian atau saldo kompensasi otomatis.');
      }
    }
    return result;
  }
  function csv(rows) {
    if (!Array.isArray(rows)) throw new TypeError('Baris CSV harus berupa daftar.');
    return '\uFEFF' + rows.map(function (row) {
      if (!Array.isArray(row)) throw new TypeError('Setiap baris CSV harus berupa daftar kolom.');
      return row.map(function (value) {
        if (typeof value === 'number') {
          if (!Number.isFinite(value)) throw new TypeError('CSV tidak dapat memuat angka yang tidak valid.');
          return String(value);
        }
        var text = value === undefined || value === null ? '' : String(value);
        // Quote escaping alone cannot prevent spreadsheet formula execution.
        if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\r\n') + '\r\n';
  }
  return Object.freeze({ flows: flows, classify: classify, summary: summary, tax: tax, csv: csv,
    validDate: validDate, validMonth: validMonth, validAmount: validAmount, isOpeningBalance: isOpeningBalance });
}));
