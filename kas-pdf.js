/* Presentation only: no storage access, uploads, downloads, or transaction changes. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KasPdf = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var scriptURL = root.document && root.document.currentScript && root.document.currentScript.src;
  var fontBase = scriptURL ? new URL('vendor/pdf/', scriptURL).href : 'vendor/pdf/';
  var INK = [31, 42, 55], MUTED = [93, 108, 126], GREEN = [19, 112, 76], RED = [171, 48, 54];
  var EDGE = [221, 228, 236], NAVY = [32, 55, 78], WIDTH = 273;

  function amount(value, signed) {
    return Number.isSafeInteger(value) && (signed || value >= 0);
  }
  function add(left, right) {
    var value = left + right;
    if (!Number.isSafeInteger(value)) throw new Error('Total rupiah melampaui batas perhitungan yang aman.');
    return value;
  }
  function text(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) throw new Error('Nominal dalam laporan harus berupa rupiah bulat yang valid.');
      return value.toLocaleString('id-ID');
    }
    if (typeof value !== 'string') throw new Error('Isi kolom laporan harus berupa teks atau angka.');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error('Catatan memuat karakter kontrol yang tidak dapat dicetak. Periksa catatan sumber.');
    // Preserve words and punctuation; expand whitespace for consistent PDF layout.
    return value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  }
  function dateInMonth(value, month) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 7) !== month) return false;
    var date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function normalize(report) {
    if (!report || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(report.month || '')) throw new Error('Bulan laporan belum valid.');
    if (!amount(report.incoming) || !amount(report.outgoing) || !amount(report.difference, true) || add(report.incoming, -report.outgoing) !== report.difference) throw new Error('Total pemasukan dan pengeluaran tidak cocok.');
    if (typeof report.monthLabel !== 'string' || !report.monthLabel.trim() || report.monthLabel.length > 100) throw new Error('Nama bulan laporan belum valid.');
    function rows(value, columns, optional) {
      if (optional && (value === undefined || Array.isArray(value) && !value.length)) return [];
      if (!Array.isArray(value) || !value.length || value.some(function (row) { return !Array.isArray(row) || row.length !== columns; })) throw new Error('Kolom rincian laporan belum lengkap.');
      value.slice(1).forEach(function (row) {
        if (!dateInMonth(row[0], report.month)) throw new Error('Tanggal kas tidak sesuai bulan laporan.');
        if (columns === 9) {
          var incoming = row[4], outgoing = row[5];
          if (!((amount(incoming) && incoming > 0 && outgoing === '') || (amount(outgoing) && outgoing > 0 && incoming === ''))) throw new Error('Arah atau nominal kas belum valid.');
        } else if (!amount(row[2], true)) throw new Error('Saldo awal belum valid.');
      });
      return value.map(function (row) { return row.map(text); });
    }
    var cash = rows(report.cashRows, 9, false), transfers = rows(report.transferRows, 9, true), openings = rows(report.openingRows, 3, true);
    var incoming = 0, outgoing = 0;
    report.cashRows.slice(1).forEach(function (row) { incoming = add(incoming, row[4] === '' ? 0 : row[4]); outgoing = add(outgoing, row[5] === '' ? 0 : row[5]); });
    if (incoming !== report.incoming || outgoing !== report.outgoing) throw new Error('Total laporan berbeda dengan rincian transaksi.');
    if (!Array.isArray(report.issues || [])) throw new Error('Catatan pemeriksaan belum valid.');
    return { month: report.month, monthLabel: text(report.monthLabel), incoming: report.incoming, outgoing: report.outgoing, difference: report.difference,
      cashRows: cash, transferRows: transfers, openingRows: openings, issues: (report.issues || []).map(text) };
  }
  function base64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    if (typeof root.btoa !== 'function') throw new Error('Perangkat belum mendukung pembacaan font PDF.');
    return root.btoa(binary);
  }
  function createExporter(options) {
    options = options || {};
    var fontPromise;
    function loadFonts() {
      if (fontPromise) return fontPromise;
      var fetcher = options.fetch || (root.fetch && root.fetch.bind(root)), base = options.fontBase || fontBase;
      if (!fetcher) return Promise.reject(new Error('Font PDF belum dapat dimuat di perangkat ini.'));
      async function font(name) {
        var controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
        var timer;
        var timeout = new Promise(function (_, reject) {
          timer = root.setTimeout(function () { if (controller) controller.abort(); reject(new Error('Timeout')); }, options.timeoutMs || 20000);
        });
        try {
          return await Promise.race([timeout, (async function () {
            var response = await fetcher(base + name, { method: 'GET', credentials: 'same-origin', signal: controller ? controller.signal : undefined });
            if (!response || !response.ok) throw new Error('HTTP');
            var bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.length < 1000 || !(bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) throw new Error('Format font');
            return base64(bytes);
          }())]);
        } catch (error) { throw new Error('Font PDF gagal dimuat (' + name + '). Periksa koneksi lalu coba lagi.'); }
        finally { if (timer !== null) root.clearTimeout(timer); }
      }
      fontPromise = Promise.all([font('NotoSans-Regular.ttf'), font('NotoSans-Bold.ttf')]).catch(function (error) { fontPromise = null; throw error; });
      return fontPromise;
    }
    async function createBlob(report) {
      var model = normalize(report);
      var JsPDF = options.jsPDF || root.jspdf && root.jspdf.jsPDF;
      if (typeof JsPDF !== 'function') throw new Error('Pembuat PDF belum termuat. Muat ulang aplikasi lalu coba lagi.');
      var fonts = await loadFonts();
      var doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
      var drawTable = options.autoTable || function (pdf, settings) {
        if (typeof pdf.autoTable !== 'function') throw new Error('Tabel PDF belum termuat. Muat ulang aplikasi lalu coba lagi.');
        pdf.autoTable(settings);
      };
      doc.addFileToVFS('Kas-Regular.ttf', fonts[0]); doc.addFont('Kas-Regular.ttf', 'KasSans', 'normal');
      doc.addFileToVFS('Kas-Bold.ttf', fonts[1]); doc.addFont('Kas-Bold.ttf', 'KasSans', 'bold');
      // Missing glyphs must produce a visible error, never a PDF with silently lost notes.
      var values = [model.monthLabel].concat(model.issues, model.cashRows.flat(), model.transferRows.flat(), model.openingRows.flat());
      ['normal', 'bold'].forEach(function (style) {
        doc.setFont('KasSans', style);
        var metadata = doc.getFont().metadata;
        if (!metadata || typeof metadata.characterToGlyph !== 'function') throw new Error('Font PDF tidak dapat dibaca. Muat ulang aplikasi.');
        var checked = new Set();
        values.forEach(function (value) {
          Array.from(value).forEach(function (character) {
            if (character === '\n' || checked.has(character)) return;
            checked.add(character);
            if (!metadata.characterToGlyph(character.codePointAt(0))) throw new Error('Karakter "' + character + '" belum didukung font PDF. Catatan tidak diubah; gunakan CSV atau periksa karakter tersebut.');
          });
        });
      });
      doc.setProperties({ title: 'Laporan kas usaha - ' + model.monthLabel, author: 'Kas Command', creator: 'Kas Command' });
      function font(size, bold, color) { doc.setFont('KasSans', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor.apply(doc, color || INK); }
      font(19, true); doc.text('Laporan pemasukan dan pengeluaran', 12, 31);
      var cards = [['Pemasukan', model.incoming, GREEN], ['Pengeluaran', model.outgoing, RED], ['Selisih', model.difference, model.difference < 0 ? RED : INK]];
      cards.forEach(function (card, i) {
        var x = 12 + i * 92;
        doc.setFillColor(246, 248, 251); doc.roundedRect(x, 37, 89, 22, 2, 2, 'F');
        font(8, false, MUTED); doc.text(card[0].toUpperCase(), x + 4, 44);
        font(15, true, card[2]); doc.text('Rp ' + text(card[1]), x + 4, 53);
      });
      font(8.5, false, MUTED);
      doc.text('Periode mengikuti tanggal uang masuk / keluar. Data pribadi, transfer sendiri, dan saldo awal tidak masuk total.', 12, 66);
      var y = 73;
      function table(title, rows, widths, cash) {
        var columns = widths.length, columnStyles = {};
        widths.forEach(function (width, i) { columnStyles[i] = { cellWidth: width }; });
        if (cash) [4, 5, 6].forEach(function (i) { columnStyles[i].halign = 'right'; });
        else if (columns === 3) columnStyles[2].halign = 'right';
        var body = rows.slice(1);
        if (!body.length) body = [[{ content: 'Belum ada pemasukan atau pengeluaran usaha pada bulan ini.', colSpan: columns, styles: { textColor: MUTED, cellPadding: 6 } }]];
        drawTable(doc, { startY: y, margin: { top: 25, bottom: 15, left: 12, right: 12 }, tableWidth: WIDTH,
          head: [[{ content: title, colSpan: columns, styles: { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 10, cellPadding: 3 } }], rows[0]], body: body,
          theme: 'plain', showHead: 'everyPage', rowPageBreak: 'auto', pageBreak: 'auto',
          styles: { font: 'KasSans', fontStyle: 'normal', fontSize: 8.1, cellPadding: 2.1, overflow: 'linebreak', valign: 'top', textColor: INK, lineColor: EDGE, lineWidth: { bottom: 0.15 } },
          headStyles: { fontStyle: 'bold', fillColor: [232, 238, 244], textColor: NAVY, fontSize: 7.6 },
          alternateRowStyles: { fillColor: [248, 250, 252] }, columnStyles: columnStyles,
          didParseCell: function (data) {
            if (cash && data.section === 'body' && typeof data.cell.raw === 'string' && data.cell.raw !== '') {
              if (data.column.index === 4) data.cell.styles.textColor = GREEN;
              if (data.column.index === 5) data.cell.styles.textColor = RED;
            }
          }
        });
        y = doc.lastAutoTable.finalY + 7;
      }
      if (model.issues.length) table('Catatan yang perlu diperiksa', [['Catatan']].concat(model.issues.map(function (issue) { return [issue]; })), [WIDTH], false);
      table('Rincian pemasukan dan pengeluaran', model.cashRows, [20, 31, 24, 25, 23, 23, 29, 20, 78], true);
      if (model.transferRows.length > 1) table('Transfer antar-rekening sendiri - tidak masuk total', model.transferRows, [20, 31, 24, 25, 23, 23, 29, 20, 78], true);
      if (model.openingRows.length > 1) table('Saldo awal tercatat - bukan pemasukan', model.openingRows, [28, 207, 38], false);
      var pages = doc.getNumberOfPages();
      for (var page = 1; page <= pages; page++) {
        doc.setPage(page); font(10, true); doc.text('KAS COMMAND', 12, 13);
        font(9, false, MUTED); doc.text(model.monthLabel, 285, 13, { align: 'right' });
        doc.setDrawColor.apply(doc, EDGE); doc.setLineWidth(0.25); doc.line(12, 18, 285, 18); doc.line(12, 199, 285, 199);
        font(7.5, false, MUTED); doc.text('Laporan kas usaha', 12, 204); doc.text('Halaman ' + page + ' / ' + pages, 285, 204, { align: 'right' });
      }
      var bytes = doc.output('arraybuffer');
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 100) throw new Error('Berkas PDF belum berhasil dibuat.');
      return new root.Blob([bytes], { type: 'application/pdf' });
    }
    return Object.freeze({ createBlob: createBlob });
  }
  var defaultExporter = createExporter();
  return Object.freeze({ createBlob: defaultExporter.createBlob, createExporter: createExporter });
}));
