(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KasStorage = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function shapeErrors(data) {
    if (!isRecord(data)) return ['Data kas harus berupa objek.'];
    if (data.version === 'kas-sync' && isRecord(data.state)) {
      return ['File ekspor kas-sync bukan cadangan lengkap. Pilih Backup JSON dari HP asal; jangan menimpa data.'];
    }
    var errors = [];
    if (!Array.isArray(data.tx)) errors.push('Daftar transaksi (tx) harus berupa array.');
    if (!Array.isArray(data.pi)) errors.push('Daftar utang/piutang (pi) harus berupa array.');
    return errors;
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var year = Number(value.slice(0, 4));
    var month = Number(value.slice(5, 7));
    var day = Number(value.slice(8, 10));
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= days[month - 1];
  }

  function isLegacyOpeningBalance(tx) {
    return isRecord(tx) && tx.id === 'SETUP_OPS' && tx.tipe === 'in' &&
      tx.kategori === 'Modal Masuk' && tx.channel === 'BCA Operasional' &&
      tx.catatan === 'Saldo Awal BCA Operasional' && tx.tanggal === '2026-06-01' &&
      (!tx.flow || tx.flow === 'openingBusiness') &&
      Number.isSafeInteger(tx.jumlah);
  }

  // Deliberately retains unknown legacy fields. Validation never repairs or strips data.
  function validateData(data) {
    var errors = shapeErrors(data);
    if (errors.length) return errors;
    var ids = new Set();
    data.tx.forEach(function (tx, index) {
      var label = 'Transaksi ke-' + (index + 1);
      if (!isRecord(tx)) { errors.push(label + ' harus berupa objek.'); return; }
      if (typeof tx.id !== 'string' || !tx.id.trim()) errors.push(label + ': ID tidak valid.');
      else if (ids.has(tx.id)) errors.push(label + ': ID ganda.');
      else ids.add(tx.id);
      if (tx.tipe !== 'in' && tx.tipe !== 'out') errors.push(label + ': tipe harus in atau out.');
      if (!Number.isSafeInteger(tx.jumlah) || (tx.jumlah < 0 && !isLegacyOpeningBalance(tx))) errors.push(label + ': jumlah harus rupiah bulat, tidak negatif, dan dalam batas aman (kecuali saldo awal lama yang dikenali).');
      if (!validDate(tx.tanggal)) errors.push(label + ': tanggal harus valid (YYYY-MM-DD).');
    });
    // Debt data is kept compatible with the older app, including historic fields.
    data.pi.forEach(function (entry, index) {
      var label = 'Utang/piutang ke-' + (index + 1);
      if (!isRecord(entry)) { errors.push(label + ' harus berupa objek.'); return; }
      ['bayar', 'tambahan'].forEach(function (field) {
        if (!Object.prototype.hasOwnProperty.call(entry, field)) return;
        if (!Array.isArray(entry[field])) { errors.push(label + ': ' + field + ' harus berupa array.'); return; }
        entry[field].forEach(function (item, itemIndex) {
          if (!isRecord(item)) errors.push(label + ': ' + field + ' ke-' + (itemIndex + 1) + ' harus berupa objek.');
        });
      });
    });
    return errors;
  }

  function detail(error) {
    return error && error.message ? String(error.message) : String(error || 'Kesalahan tidak diketahui');
  }

  function failure(code, message) {
    return { ok: false, code: code, error: message };
  }

  function validKey(key) {
    return typeof key === 'string' && key.length > 0;
  }

  // Opening the app must never write, seed, migrate, or replace stored data.
  function open(storage, key) {
    var raw = null;
    if (!validKey(key)) return { data: null, raw: raw, error: 'Kunci penyimpanan kas tidak valid.' };
    try { raw = storage.getItem(key); }
    catch (error) { return { data: null, raw: null, error: 'Penyimpanan kas tidak dapat dibaca: ' + detail(error) }; }
    if (raw === null) return { data: { tx: [], pi: [] }, raw: null, error: null };
    try {
      var data = JSON.parse(raw);
      var errors = shapeErrors(data);
      if (errors.length) return { data: null, raw: raw, error: errors.join(' ') };
      return { data: data, raw: raw, error: null };
    } catch (error) {
      return { data: null, raw: raw, error: 'Data kas tersimpan tidak dapat dibaca; data asli tidak diubah. ' + detail(error) };
    }
  }

  // Optimistic stale-tab protection. Callers retain their own draft on any failure.
  // localStorage has no cross-tab atomic compare-and-swap; never present this as cloud sync.
  function transaction(storage, key, expectedRaw, next) {
    if (!validKey(key)) return failure('invalid_key', 'Kunci penyimpanan kas tidak valid.');
    if (expectedRaw !== null && typeof expectedRaw !== 'string') return failure('invalid_expected', 'Versi data awal tidak valid. Muat ulang data tersimpan sebelum menyimpan.');
    var errors = validateData(next);
    if (errors.length) return failure('invalid_data', errors.join(' '));
    var raw;
    try {
      raw = JSON.stringify(next);
      var serializedErrors = validateData(JSON.parse(raw));
      if (serializedErrors.length) return failure('invalid_data', serializedErrors.join(' '));
    } catch (error) {
      return failure('serialize_failed', 'Data belum dapat disimpan: ' + detail(error));
    }
    var current;
    try { current = storage.getItem(key); }
    catch (error) { return failure('read_failed', 'Penyimpanan kas tidak dapat dibaca: ' + detail(error)); }
    if (current !== expectedRaw) return failure('conflict', 'Data sudah berubah di tab lain. Draf belum disimpan; buka data terbaru dahulu.');
    // A no-op does not need a backup or a write, but must still detect stale tabs.
    if (raw === current) return { ok: true, raw: raw };
    if (current !== null && current !== '') {
      var backupKey = key + '_before_v5';
      try {
        if (storage.getItem(backupKey) === null) storage.setItem(backupKey, current);
      } catch (error) {
        return failure('backup_failed', 'Cadangan awal gagal disimpan. Data kas asli tidak diubah: ' + detail(error));
      }
    }
    try {
      // Recheck after backup creation in case another tab changed the primary key.
      if (storage.getItem(key) !== expectedRaw) return failure('conflict', 'Data sudah berubah di tab lain. Draf belum disimpan; buka data terbaru dahulu.');
    } catch (error) {
      return failure('read_failed', 'Versi data belum dapat diperiksa: ' + detail(error));
    }
    try { storage.setItem(key, raw); }
    catch (error) { return failure('write_failed', 'Penyimpanan gagal. Data kas asli tetap tersimpan; draf belum disimpan: ' + detail(error)); }
    return { ok: true, raw: raw };
  }

  return { open: open, transaction: transaction, validateData: validateData };
}));
