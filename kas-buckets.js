(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KasBuckets = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Budget reserves only: this module never writes records or transfers money.
  var own = function (value, key) { return Object.prototype.hasOwnProperty.call(value, key); };
  function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function percentValid(value) { return Number.isInteger(value) && value >= 0 && value <= 100; }
  function copy(value) {
    if (Array.isArray(value)) return value.map(copy);
    if (isRecord(value)) {
      var result = {};
      Object.keys(value).forEach(function (key) {
        Object.defineProperty(result, key, { value: copy(value[key]), enumerable: true, writable: true, configurable: true });
      });
      return result;
    }
    return value;
  }
  function policy(kasSettings) {
    if (kasSettings === undefined || kasSettings === null || (isRecord(kasSettings) && !own(kasSettings, 'incomeSplit'))) {
      return { valid: true, enabled: true, personalPercent: 15, errors: [] };
    }
    var config = isRecord(kasSettings) ? kasSettings.incomeSplit : null;
    var errors = [];
    if (!isRecord(config) || typeof config.enabled !== 'boolean') errors.push('Status pembagian otomatis belum valid.');
    if (!isRecord(config) || !percentValid(config.personalPercent)) errors.push('Persentase pribadi harus bilangan bulat antara 0 dan 100.');
    return {
      valid: errors.length === 0,
      enabled: errors.length ? null : config.enabled,
      personalPercent: errors.length ? null : config.personalPercent,
      errors: errors
    };
  }
  function split(amount, percent) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('Nominal pembagian harus rupiah bulat nol atau lebih dalam batas aman.');
    if (!percentValid(percent)) throw new RangeError('Persentase pribadi harus bilangan bulat antara 0 dan 100.');
    // Separate whole hundreds and the remainder to avoid unsafe amount * percent.
    // Round personal to the nearest rupiah; business receives the exact remainder.
    var personal = Math.floor(amount / 100) * percent + Math.floor(((amount % 100) * percent + 50) / 100);
    return { personal: personal, business: amount - personal };
  }
  function stamp(record, old, kasSettings, F) {
    if (!isRecord(record)) throw new TypeError('Catatan transaksi tidak valid.');
    var result = copy(record), flow = F.classify(record);
    if (old !== undefined && old !== null) {
      if (!isRecord(old)) throw new TypeError('Catatan transaksi sebelumnya tidak valid.');
      if (!own(old, 'incomeSplit')) delete result.incomeSplit;
      else {
        var previous = old.incomeSplit;
        if (isRecord(previous) && previous.version === 1 && (previous.kind === 'sale' || previous.kind === 'ownerDraw') && previous.kind !== flow) {
          delete result.incomeSplit;
        } else {
          // Preserve the original rate and any damaged/unknown metadata for review.
          result.incomeSplit = copy(previous);
        }
      }
      return result;
    }
    delete result.incomeSplit;
    if (flow === 'ownerDraw') result.incomeSplit = { version: 1, kind: 'ownerDraw' };
    if (flow === 'sale') {
      var setting = policy(kasSettings);
      if (!setting.valid) throw new RangeError('Pengaturan pembagian belum valid. ' + setting.errors.join(' '));
      if (setting.enabled) result.incomeSplit = { version: 1, kind: 'sale', personalPercent: setting.personalPercent };
    }
    return result;
  }
  function checkedAdd(left, right) {
    var value = left + right;
    if (!Number.isSafeInteger(value)) throw new RangeError('Total alokasi melampaui batas perhitungan rupiah yang aman.');
    return value;
  }
  function summary(tx, month, F) {
    var result = {
      allocatedPersonal: 0, allocatedBusiness: 0, salesReceived: 0, drawn: 0,
      remainingPersonal: 0, overdraw: 0, businessAfterReserve: 0, cashBusinessClosing: 0,
      monthPersonal: 0, monthBusiness: 0, monthDrawn: 0, ready: false, errors: []
    };
    function error(message) { if (result.errors.indexOf(message) === -1) result.errors.push(message); }
    function finish() {
      result.ready = result.errors.length === 0;
      // Never expose partial balances as numbers when the source is incomplete.
      if (!result.ready) Object.keys(result).forEach(function (key) { if (key !== 'ready' && key !== 'errors') result[key] = null; });
      return result;
    }
    if (!F || typeof F.validMonth !== 'function' || typeof F.validDate !== 'function' || typeof F.classify !== 'function' || typeof F.summary !== 'function') {
      error('Perhitungan kas belum tersedia.');
      return finish();
    }
    if (!F.validMonth(month)) error('Pilih bulan dengan format YYYY-MM.');
    if (!Array.isArray(tx)) error('Daftar transaksi tidak valid.');
    if (result.errors.length) return finish();
    var ids = new Set();
    try {
      tx.forEach(function (record) {
        if (isRecord(record) && record.voided === true) return;
        if (!isRecord(record) || !F.validDate(record.tanggal)) {
          error('Ada catatan atau tanggal transaksi yang tidak valid.');
          return;
        }
        if (record.tanggal.slice(0, 7) > month) return;
        if (typeof record.id !== 'string' || !record.id.trim()) error('Ada transaksi tanpa ID yang valid.');
        else if (ids.has(record.id)) error('Ada ID transaksi ganda.');
        else ids.add(record.id);
        var opening = typeof F.isOpeningBalance === 'function' && F.isOpeningBalance(record);
        if ((!Number.isSafeInteger(record.jumlah) || record.jumlah <= 0) && !opening) {
          error('Ada nominal transaksi yang tidak valid.');
          return;
        }
        if (record.tipe !== 'in' && record.tipe !== 'out') {
          error('Ada arah transaksi yang tidak valid.');
          return;
        }
        // An absent stamp is an existing/unallocated record, never an implied 15%.
        if (!own(record, 'incomeSplit')) return;
        var meta = record.incomeSplit, flow = F.classify(record);
        if (!isRecord(meta) || meta.version !== 1 || (meta.kind !== 'sale' && meta.kind !== 'ownerDraw') || meta.kind !== flow || (meta.kind === 'sale' && !percentValid(meta.personalPercent))) {
          error('Ada penanda alokasi yang tidak valid atau tidak sesuai jenis transaksi.');
          return;
        }
        var current = record.tanggal.slice(0, 7) === month;
        if (meta.kind === 'sale') {
          var portion = split(record.jumlah, meta.personalPercent);
          result.salesReceived = checkedAdd(result.salesReceived, record.jumlah);
          result.allocatedPersonal = checkedAdd(result.allocatedPersonal, portion.personal);
          result.allocatedBusiness = checkedAdd(result.allocatedBusiness, portion.business);
          if (current) {
            result.monthPersonal = checkedAdd(result.monthPersonal, portion.personal);
            result.monthBusiness = checkedAdd(result.monthBusiness, portion.business);
          }
        } else {
          result.drawn = checkedAdd(result.drawn, record.jumlah);
          if (current) result.monthDrawn = checkedAdd(result.monthDrawn, record.jumlah);
        }
      });
      var cash = F.summary(tx, month);
      if (!cash.balancesComplete || !Number.isSafeInteger(cash.cashBusinessClosing)) error('Saldo kas belum lengkap; periksa catatan sebelum memakai jumlah alokasi.');
      else result.cashBusinessClosing = cash.cashBusinessClosing;
      result.remainingPersonal = Math.max(0, checkedAdd(result.allocatedPersonal, -result.drawn));
      result.overdraw = Math.max(0, checkedAdd(result.drawn, -result.allocatedPersonal));
      result.businessAfterReserve = checkedAdd(result.cashBusinessClosing, -result.remainingPersonal);
    } catch (failure) {
      error(failure instanceof RangeError ? 'Total kas atau alokasi melampaui batas perhitungan rupiah yang aman.' : 'Catatan belum dapat dihitung dengan lengkap.');
    }
    return finish();
  }
  return Object.freeze({ policy: policy, split: split, stamp: stamp, summary: summary });
}));
