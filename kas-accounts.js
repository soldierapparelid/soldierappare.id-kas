(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KasAccounts = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Three recorded budget pots, not verified balances of connected bank accounts.
  // taxReserve/taxReturn are neutral movements within business cash. A taxPayment
  // reduces business cash once in KasFinance; reserveAccount:'tax' also consumes
  // the tax pot. 'operational', or no field on a legacy payment, leaves it alone.
  // validate(tx,F) checks every active date, including future records before an
  // edit/void is committed. summary(tx,month,F,B) is a month-end view. Both are
  // pure: no stamping, automatic allocation, mutation, storage or bank transfers.
  // Records are ordered by date, then their original array order for the same day.
  var own = function (value, key) { return Object.prototype.hasOwnProperty.call(value, key); };
  function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function relevant(record) {
    return record.flow === 'taxReserve' || record.flow === 'taxReturn' || own(record, 'reserveAccount');
  }
  function addError(errors, message) { if (errors.indexOf(message) === -1) errors.push(message); }
  function checkedAdd(left, right) {
    var value = left + right;
    if (!Number.isSafeInteger(value)) throw new RangeError('Total cadangan melampaui batas perhitungan rupiah yang aman.');
    return value;
  }
  function reserveState(tx, F, month) {
    var errors = [], balance = 0, records = [], ids = new Map();
    function error(message) { addError(errors, message); }
    if (!F || typeof F.validDate !== 'function' || typeof F.classify !== 'function') {
      return { ok: false, balance: null, errors: ['Perhitungan jenis transaksi belum tersedia.'] };
    }
    if (!Array.isArray(tx)) return { ok: false, balance: null, errors: ['Daftar transaksi tidak valid.'] };
    tx.forEach(function (record, index) {
      if (isRecord(record) && record.voided === true) return;
      if (!isRecord(record)) { error('Ada catatan transaksi yang tidak valid.'); return; }
      var dated = F.validDate(record.tanggal);
      if (month && dated && record.tanggal.slice(0, 7) > month) return;
      var tracked = relevant(record), idValid = typeof record.id === 'string' && !!record.id.trim();
      if (idValid) {
        var previous = ids.get(record.id);
        if (previous && (previous.tracked || tracked)) error('Ada ID transaksi cadangan pajak ganda.');
        ids.set(record.id, { tracked: tracked || !!(previous && previous.tracked) });
      }
      if (!tracked) return;
      var valid = true;
      function invalid(message) { error(message); valid = false; }
      if (!idValid) invalid('Ada transaksi cadangan pajak tanpa ID yang valid.');
      if (!dated) invalid('Ada tanggal transaksi cadangan pajak yang tidak valid.');
      if (!Number.isSafeInteger(record.jumlah) || record.jumlah <= 0) invalid('Nominal cadangan pajak harus rupiah bulat positif dalam batas aman.');
      var flow = F.classify(record), delta = 0;
      if (record.flow === 'taxReserve' || record.flow === 'taxReturn') {
        if (flow !== record.flow) invalid('Arah transaksi cadangan pajak tidak sesuai jenisnya.');
        if (own(record, 'reserveAccount')) invalid('Penanda sumber pembayaran hanya berlaku untuk pembayaran pajak.');
        delta = record.flow === 'taxReserve' ? record.jumlah : -record.jumlah;
      } else if (flow === 'taxPayment') {
        if (record.reserveAccount !== 'tax' && record.reserveAccount !== 'operational') invalid('Sumber pembayaran pajak belum valid.');
        delta = record.reserveAccount === 'tax' ? -record.jumlah : 0;
      } else {
        invalid('Penanda sumber pembayaran tidak sesuai jenis transaksi pajak.');
      }
      if (valid) records.push({ date: record.tanggal, index: index, delta: delta });
    });
    records.sort(function (a, b) { return a.date.localeCompare(b.date) || a.index - b.index; });
    try {
      records.forEach(function (record) {
        balance = checkedAdd(balance, record.delta);
        if (balance < 0) error('Cadangan pajak tidak cukup pada ' + record.date + '. Periksa penyisihan, pengembalian, dan pembayaran pajak.');
      });
    } catch (failure) {
      error(failure instanceof RangeError ? failure.message : 'Cadangan pajak belum dapat dihitung.');
    }
    return { ok: errors.length === 0, balance: errors.length ? null : balance, errors: errors };
  }
  function validate(tx, F) {
    var state = reserveState(tx, F);
    return { ok: state.ok, errors: state.errors };
  }
  function summary(tx, month, F, B) {
    var result = { taxReserve: null, personalAvailable: null, operationalAvailable: null, ready: false, reserveReady: false, errors: [] };
    if (!F || typeof F.validMonth !== 'function' || !F.validMonth(month)) {
      result.errors.push('Pilih bulan dengan format YYYY-MM.');
      return result;
    }
    var reserve = reserveState(tx, F, month);
    result.reserveReady = reserve.ok;
    result.taxReserve = reserve.balance;
    reserve.errors.forEach(function (message) { addError(result.errors, message); });
    if (!B || typeof B.summary !== 'function') {
      addError(result.errors, 'Perhitungan jatah pribadi dan operasional belum tersedia.');
      return result;
    }
    try {
      var budget = B.summary(tx, month, F);
      if (!budget || !budget.ready || !Number.isSafeInteger(budget.remainingPersonal) || !Number.isSafeInteger(budget.businessAfterReserve)) {
        var budgetErrors = budget && Array.isArray(budget.errors) ? budget.errors : [];
        if (!budgetErrors.length) addError(result.errors, 'Jatah pribadi dan operasional belum dapat dihitung dengan lengkap.');
        budgetErrors.forEach(function (message) { addError(result.errors, message); });
        return result;
      }
      result.personalAvailable = budget.remainingPersonal;
      if (reserve.ok) result.operationalAvailable = checkedAdd(budget.businessAfterReserve, -reserve.balance);
      result.ready = reserve.ok;
    } catch (failure) {
      addError(result.errors, failure instanceof RangeError ? 'Total alokasi melampaui batas perhitungan rupiah yang aman.' : 'Jatah pribadi dan operasional belum dapat dihitung dengan lengkap.');
    }
    return result;
  }
  return Object.freeze({ validate: validate, summary: summary });
}));
