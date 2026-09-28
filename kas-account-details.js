(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KasAccountDetails = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Read-only explanation of recorded cash, not a reconciliation or adjustment.
  // Monthly totals come from KasAccounts; groups and rows explain all recognized
  // contributions through the selected month. Historical openings stay separate
  // from incoming money. No percentages, migrations, storage, or source copies
  // are written back. Same-date rows retain their original source order.
  function checkedAdd(left, right) {
    var value = left + right;
    if (!Number.isSafeInteger(value)) throw new RangeError('Rincian saldo melampaui batas perhitungan rupiah yang aman.');
    return value;
  }
  function addError(result, message) {
    if (result.errors.indexOf(message) === -1) result.errors.push(message);
  }
  function build(tx, month, account, F, A) {
    var result = {
      account: account, month: month, available: false, provisional: false,
      closing: null, opening: null, incoming: null, outgoing: null,
      groups: [], rows: [], errors: []
    };
    function unavailable(message) {
      if (message) addError(result, message);
      result.available = false; result.provisional = false;
      result.closing = result.opening = result.incoming = result.outgoing = null;
      result.groups = []; result.rows = [];
      return result;
    }
    if (['operational', 'personal', 'tax'].indexOf(account) === -1) return unavailable('Pilih rekening operasional, pribadi, atau cadangan pajak.');
    if (!F || typeof F.validMonth !== 'function' || !F.validMonth(month)) return unavailable('Pilih bulan dengan format YYYY-MM.');
    if (typeof F.validDate !== 'function' || typeof F.classify !== 'function' || typeof F.isOpeningBalance !== 'function' || !A || typeof A.cashSummary !== 'function') {
      return unavailable('Perhitungan rincian rekening belum tersedia.');
    }
    if (!Array.isArray(tx)) return unavailable('Daftar transaksi tidak valid.');
    try {
      var cash = A.cashSummary(tx, month, F), selected = cash && cash[account];
      if (selected && Array.isArray(selected.errors)) selected.errors.forEach(function (message) { addError(result, message); });
      if (!selected || !selected.available || !['opening', 'incoming', 'outgoing', 'closing'].every(function (key) { return Number.isSafeInteger(selected[key]); })) {
        return unavailable(result.errors.length ? '' : 'Saldo rekening belum dapat dihitung dengan aman.');
      }
      var source = [];
      tx.forEach(function (record, index) {
        if (record && record.voided === true) return;
        if (!record || typeof record !== 'object' || Array.isArray(record)) return;
        if (F.validDate(record.tanggal) && record.tanggal.slice(0, 7) > month) return;
        // KasAccounts isolates reserve validation from personal cash. Preserve
        // that guard: a damaged business-reserve row does not affect personal.
        if (account === 'personal' && (record.flow === 'taxReserve' || record.flow === 'taxReturn')) return;
        var isOpening = F.isOpeningBalance(record), flow = F.classify(record);
        if (!F.validDate(record.tanggal) || !Number.isSafeInteger(record.jumlah) || (!isOpening && record.jumlah <= 0) || (record.tipe !== 'in' && record.tipe !== 'out')) {
          addError(result, 'Catatan ' + String(record.id || '(tanpa ID)') + ' belum dihitung karena tanggal, nominal, atau arah belum valid.');
          return;
        }
        if (flow === 'review') {
          addError(result, 'Catatan ' + String(record.id || '(tanpa ID)') + ' belum dihitung karena jenisnya belum jelas.');
          return;
        }
        var direction = 0;
        if (account === 'operational') {
          if (['openingBusiness', 'sale', 'businessIncome', 'capital', 'loan', 'taxReturn'].indexOf(flow) !== -1) direction = 1;
          if (['expense', 'ownerDraw', 'debtPayment', 'taxReserve'].indexOf(flow) !== -1 || (flow === 'taxPayment' && record.reserveAccount !== 'tax')) direction = -1;
        } else if (account === 'personal') {
          if (flow === 'personalIncome' || flow === 'ownerDraw') direction = 1;
          if (flow === 'personalExpense' || flow === 'capital') direction = -1;
        } else {
          if (flow === 'taxReserve') direction = 1;
          if (flow === 'taxReturn' || (flow === 'taxPayment' && record.reserveAccount === 'tax')) direction = -1;
        }
        if (direction) source.push({ id: record.id, date: record.tanggal, flow: flow, delta: direction * record.jumlah, isOpening: isOpening, index: index });
      });
      source.sort(function (left, right) { return left.date.localeCompare(right.date) || left.index - right.index; });
      var groups = new Map(), balance = 0;
      source.forEach(function (row) {
        var group = groups.get(row.flow);
        if (!group) { group = { flow: row.flow, count: 0, incoming: 0, outgoing: 0, opening: 0, net: 0 }; groups.set(row.flow, group); }
        group.count = checkedAdd(group.count, 1);
        if (row.isOpening) group.opening = checkedAdd(group.opening, row.delta);
        else if (row.delta > 0) group.incoming = checkedAdd(group.incoming, row.delta);
        else if (row.delta < 0) group.outgoing = checkedAdd(group.outgoing, -row.delta);
        group.net = checkedAdd(group.net, row.delta);
        balance = checkedAdd(balance, row.delta);
        result.rows.push({ id: row.id, date: row.date, flow: row.flow, delta: row.delta, balance: balance, isOpening: row.isOpening });
      });
      result.groups = Array.from(groups.values());
      var groupTotal = result.groups.reduce(function (total, group) {
        if (checkedAdd(group.opening, checkedAdd(group.incoming, -group.outgoing)) !== group.net) throw new RangeError('Kelompok rincian saldo belum cocok.');
        return checkedAdd(total, group.net);
      }, 0);
      if (balance !== selected.closing || groupTotal !== selected.closing || checkedAdd(selected.opening, checkedAdd(selected.incoming, -selected.outgoing)) !== selected.closing) {
        return unavailable('Rincian belum cocok dengan saldo rekening. Periksa cadangan; tidak ada penyesuaian otomatis.');
      }
      result.available = true; result.provisional = !!selected.provisional;
      result.closing = selected.closing; result.opening = selected.opening;
      result.incoming = selected.incoming; result.outgoing = selected.outgoing;
      return result;
    } catch (failure) {
      return unavailable(failure instanceof RangeError ? failure.message : 'Rincian saldo belum dapat dihitung. Periksa cadangan.');
    }
  }
  return Object.freeze({ build: build });
}));
