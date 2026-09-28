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
  // cashSummary(tx,month,F) is separate from those legacy budget APIs. It reports
  // recorded operational/personal/tax cash, never a percentage-based allowance:
  // {month,operational,personal,tax,ready,available,provisional,status,
  //  unresolvedCount,invalidCount,errors}. Each account has
  // {opening,incoming,outgoing,closing,available,provisional,status,errors}.
  // status is 'complete', 'provisional' (recognized cash with incomplete source
  // records), or 'unavailable' (all four amounts null). ready means all three
  // accounts are complete; available means all three have safe numeric amounts.
  // A mixed result can retain a safe personal balance despite invalid reserves.
  // Counts refer to unresolved/invalid cash records, not reserve metadata errors.
  // These are application records, not verified balances of connected banks.
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
  function reserveState(tx, F, month, includeLedger) {
    var errors = [], balance = 0, records = [], ids = new Map();
    var ledger = { opening: 0, incoming: 0, outgoing: 0, returns: 0, payments: 0 };
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
      if (valid) records.push({ date: record.tanggal, index: index, delta: delta, flow: flow });
    });
    records.sort(function (a, b) { return a.date.localeCompare(b.date) || a.index - b.index; });
    try {
      records.forEach(function (record) {
        balance = checkedAdd(balance, record.delta);
        if (balance < 0) error('Cadangan pajak tidak cukup pada ' + record.date + '. Periksa penyisihan, pengembalian, dan pembayaran pajak.');
        if (includeLedger) {
          if (record.date.slice(0, 7) < month) ledger.opening = checkedAdd(ledger.opening, record.delta);
          else {
            if (record.delta > 0) ledger.incoming = checkedAdd(ledger.incoming, record.delta);
            if (record.delta < 0) ledger.outgoing = checkedAdd(ledger.outgoing, -record.delta);
            if (record.flow === 'taxReturn') ledger.returns = checkedAdd(ledger.returns, -record.delta);
            if (record.flow === 'taxPayment' && record.delta < 0) ledger.payments = checkedAdd(ledger.payments, -record.delta);
          }
        }
      });
    } catch (failure) {
      error(failure instanceof RangeError ? failure.message : 'Cadangan pajak belum dapat dihitung.');
    }
    var result = { ok: errors.length === 0, balance: errors.length ? null : balance, errors: errors };
    if (includeLedger) result.ledger = errors.length ? null : ledger;
    return result;
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
  function unavailableAccount(errors) {
    return { opening: null, incoming: null, outgoing: null, closing: null, available: false, provisional: false, status: 'unavailable', errors: errors.slice() };
  }
  function cashAccount(opening, incoming, outgoing, closing, warnings) {
    if (![opening, incoming, outgoing, closing].every(Number.isSafeInteger) || incoming < 0 || outgoing < 0) {
      throw new RangeError('Total rekening melampaui batas perhitungan rupiah yang aman.');
    }
    // Netting the nonnegative monthly flows first avoids an unnecessary unsafe
    // intermediate when both inflow and outflow are large but the balance is safe.
    if (checkedAdd(opening, checkedAdd(incoming, -outgoing)) !== closing) {
      throw new RangeError('Rincian arus rekening belum cocok dengan saldo tercatat.');
    }
    return { opening: opening, incoming: incoming, outgoing: outgoing, closing: closing, available: true, provisional: warnings.length > 0, status: warnings.length ? 'provisional' : 'complete', errors: warnings.slice() };
  }
  function cashSummary(tx, month, F) {
    var result = {
      month: month, operational: unavailableAccount([]), personal: unavailableAccount([]), tax: unavailableAccount([]),
      ready: false, available: false, provisional: false, status: 'unavailable', unresolvedCount: 0, invalidCount: 0, errors: []
    };
    function finish() {
      var accounts = [result.operational, result.personal, result.tax];
      accounts.forEach(function (account) { account.errors.forEach(function (message) { addError(result.errors, message); }); });
      result.available = accounts.every(function (account) { return account.available; });
      result.provisional = accounts.some(function (account) { return account.provisional; });
      result.ready = accounts.every(function (account) { return account.status === 'complete'; });
      result.status = !result.available ? 'unavailable' : result.provisional ? 'provisional' : 'complete';
      return result;
    }
    function unavailableAll(message) {
      result.operational = unavailableAccount([message]);
      result.personal = unavailableAccount([message]);
      result.tax = unavailableAccount([message]);
      return finish();
    }
    if (!F || typeof F.validMonth !== 'function' || !F.validMonth(month)) return unavailableAll('Pilih bulan dengan format YYYY-MM.');
    if (typeof F.validDate !== 'function' || typeof F.classify !== 'function' || typeof F.summary !== 'function') return unavailableAll('Perhitungan jenis transaksi belum tersedia.');
    if (!Array.isArray(tx)) return unavailableAll('Daftar transaksi tidak valid.');
    var selected = [], ids = new Set(), sourceError = '';
    tx.forEach(function (record) {
      if (isRecord(record) && record.voided === true) return;
      if (!isRecord(record)) { sourceError = 'Ada catatan transaksi yang tidak dapat dibaca.'; return; }
      if (F.validDate(record.tanggal) && record.tanggal.slice(0, 7) > month) return;
      if (typeof record.id !== 'string' || !record.id.trim() || ids.has(record.id)) sourceError = 'Ada catatan tanpa identitas atau identitas ganda. Periksa cadangan sebelum memakai saldo.';
      ids.add(record.id);
      selected.push(record);
    });
    if (sourceError) return unavailableAll(sourceError);
    var reserve = reserveState(selected, F, month, true), cash = null, cashErrors = [], warnings = [];
    try {
      // Neutral reserve rows cannot change either Finance cash balance. Keeping
      // their separate validation prevents corrupt/overflowing reserve subtotals
      // from hiding an otherwise safe personal cash balance.
      cash = F.summary(selected.filter(function (record) { return record.flow !== 'taxReserve' && record.flow !== 'taxReturn'; }), month);
      if (!cash || ![cash.cashBusinessOpening, cash.businessIn, cash.businessOut, cash.cashBusinessClosing,
        cash.cashPersonalOpening, cash.personalIn, cash.personalOut, cash.cashPersonalClosing].every(Number.isSafeInteger)) throw new RangeError('Saldo kas belum dapat dihitung dengan aman.');
      result.unresolvedCount = cash.balanceUnresolvedCount || 0;
      result.invalidCount = cash.invalidCount || 0;
      if (!cash.balancesComplete) warnings.push('Angka sementara dari transaksi yang sudah dikenali. Ada catatan yang belum jelas atau tidak valid; saldo dapat berubah setelah diperiksa.');
      result.personal = cashAccount(cash.cashPersonalOpening, cash.personalIn, cash.personalOut, cash.cashPersonalClosing, warnings);
    } catch (failure) {
      cash = null;
      cashErrors.push(failure instanceof RangeError ? 'Total kas melampaui batas perhitungan rupiah yang aman.' : 'Saldo kas belum dapat dihitung. Periksa cadangan.');
      result.personal = unavailableAccount(cashErrors);
    }
    if (!reserve.ok) {
      result.tax = unavailableAccount(reserve.errors);
      result.operational = unavailableAccount(cashErrors.concat(warnings, reserve.errors));
      return finish();
    }
    if (!cash) {
      // An unsafe cash summary cannot certify that the source was classified
      // completely, so do not show a reassuring zero tax balance beside it.
      result.tax = unavailableAccount(cashErrors);
      result.operational = unavailableAccount(cashErrors);
      return finish();
    }
    var ledger = reserve.ledger;
    try {
      result.tax = cashAccount(ledger.opening, ledger.incoming, ledger.outgoing, reserve.balance, warnings);
    } catch (failure) {
      result.tax = unavailableAccount(['Total cadangan pajak melampaui batas perhitungan rupiah yang aman.']);
    }
    if (!result.tax.available) result.operational = unavailableAccount(result.tax.errors);
    else {
      try {
        result.operational = cashAccount(
          checkedAdd(cash.cashBusinessOpening, -ledger.opening),
          checkedAdd(cash.businessIn, ledger.returns),
          checkedAdd(checkedAdd(cash.businessOut, -ledger.payments), ledger.incoming),
          checkedAdd(cash.cashBusinessClosing, -reserve.balance), warnings
        );
      } catch (failure) {
        result.operational = unavailableAccount(['Total operasional melampaui batas perhitungan rupiah yang aman.']);
      }
    }
    return finish();
  }
  return Object.freeze({ validate: validate, summary: summary, cashSummary: cashSummary });
}));
