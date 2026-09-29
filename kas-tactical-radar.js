/* Read-only monthly cash analysis. No storage, mutations, uploads, inferred HPP,
 * bank balances or tax estimates. This is not a formal audited profit statement. */
(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.KasTacticalRadar=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var keys=['sales','otherBusinessIncome','businessReceipts','operatingExpense','taxPayment','surplus','ownerDraw','afterDraw','capital','loan','debtPayment','taxReserve','taxReturn','personalIncome','personalExpense','personalNet','personalCashChange'];
  var own=function(o,k){return Object.prototype.hasOwnProperty.call(o,k);};
  var record=function(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);};
  function add(a,b){var n=a+b;if(!Number.isSafeInteger(n))throw new Error('Total Radar melampaui batas rupiah yang aman.');return n;}
  function label(v,fallback){return typeof v==='string'&&v.trim()?v.trim():fallback;}
  function unique(list,text){if(!list.includes(text))list.push(text);}
  /* totals: safe integer rupiah, ALL null when unavailable. Unknown/invalid dated
   * rows are excluded with provisional counts/warnings. Unreadable rows, unknown
   * dates and duplicate/missing selected-month IDs fail closed. Other valid months
   * and void rows are ignored first. Category/source: {name,amount,count}; transfer:
   * {id,tanggal,flow,jumlah,from,to,catatan}. Sales uses jumlah, never gross minus fees.
   * surplus=businessReceipts-operatingExpense-taxPayment; afterDraw=surplus-ownerDraw.
   * personalNet=personalIncome-personalExpense; personalCashChange adds draw, less capital. */
  function summarize(tx,month,F){
    var totals={},result={month:month,available:false,provisional:false,status:'unavailable',errors:[],warnings:[],
      notes:['Perkiraan berbasis kas bulan dipilih, bukan laporan laba rugi yang diaudit, laba bersih akuntansi, atau saldo rekening.','Pembelian bahan / stok tercatat sebagai kas keluar; belum tentu sama dengan HPP barang yang sudah terjual.','Penjualan memakai uang diterima (dapat sudah dipotong marketplace), bukan omzet bruto. Tidak ada biaya marketplace yang dikurangi lagi.','Pokok utang dibayar, modal, pinjaman, prive dan cadangan pajak dipisahkan; bukan pendapatan atau beban operasional. Pajak yang benar-benar dibayar dikurangi sekali dari surplus.'],
      counts:{included:0,unknown:0,invalid:0,voided:0,outOfMonth:0,opening:0},totals:totals,businessCategories:[],personalCategories:[],salesSources:[],transfers:[]};
    keys.forEach(function(k){totals[k]=0;});
    function unavailable(reason){unique(result.errors,reason);result.available=false;result.status='unavailable';keys.forEach(function(k){totals[k]=null;});result.businessCategories=[];result.personalCategories=[];result.salesSources=[];result.transfers=[];return result;}
    if(!F||typeof F.validMonth!=='function'||typeof F.validDate!=='function'||typeof F.validAmount!=='function'||typeof F.classify!=='function'||typeof F.isOpeningBalance!=='function'||!F.flows)return unavailable('Modul klasifikasi Kas belum tersedia.');
    if(!F.validMonth(month))return unavailable('Pilih bulan yang valid (YYYY-MM).');
    if(!Array.isArray(tx))return unavailable('Daftar transaksi belum dapat dibaca.');
    var selected=[],ids=new Set(),fatal='';
    tx.forEach(function(t){
      if(record(t)&&t.voided===true){result.counts.voided++;return;}
      if(!record(t)){fatal='Ada catatan yang tidak dapat dibaca; Radar belum dapat dihitung.';return;}
      if(!F.validDate(t.tanggal)){fatal='Ada tanggal tidak valid yang belum dapat ditempatkan ke bulan yang benar.';return;}
      if(t.tanggal.slice(0,7)!==month){result.counts.outOfMonth++;return;}
      if(typeof t.id!=='string'||!t.id.trim()||ids.has(t.id)){fatal='Identitas transaksi bulan ini hilang atau ganda; periksa catatan sebelum memakai Radar.';return;}
      ids.add(t.id);selected.push(t);
    });
    if(fatal)return unavailable(fatal);
    var business=new Map(),personal=new Map(),sources=new Map();
    function group(map,name,amount){var row=map.get(name);if(!row){row={name:name,amount:0,count:0};map.set(name,row);}row.amount=add(row.amount,amount);row.count++;}
    var routes={ownerDraw:['Operasional','Pribadi'],capital:['Pribadi','Operasional'],taxReserve:['Operasional','Cadangan pajak'],taxReturn:['Cadangan pajak','Operasional'],transferIn:['Rekening sendiri','Rekening sendiri'],transferOut:['Rekening sendiri','Rekening sendiri']};
    try{
      selected.forEach(function(t){
        if(F.isOpeningBalance(t)){result.counts.opening++;return;}
        if(!F.validAmount(t.jumlah)||!['in','out'].includes(t.tipe)||(own(t,'reserveAccount')&&(F.classify(t)!=='taxPayment'||!['tax','operational'].includes(t.reserveAccount)))){result.counts.invalid++;unique(result.warnings,'Catatan dengan jumlah, arah uang, atau sumber pembayaran tidak valid dikeluarkan dari perhitungan. Perkiraan ini belum lengkap.');return;}
        var flow=F.classify(t);
        if(flow==='review'||!own(F.flows,flow)){result.counts.unknown++;unique(result.warnings,'Catatan yang jenisnya belum jelas dikeluarkan dari Radar; tidak dianggap penjualan atau biaya.');return;}
        var key={sale:'sales',businessIncome:'otherBusinessIncome',expense:'operatingExpense',taxPayment:'taxPayment',ownerDraw:'ownerDraw',capital:'capital',loan:'loan',debtPayment:'debtPayment',taxReserve:'taxReserve',taxReturn:'taxReturn',personalIncome:'personalIncome',personalExpense:'personalExpense'}[flow];
        if(key)totals[key]=add(totals[key],t.jumlah);
        result.counts.included++;
        if(flow==='expense')group(business,label(t.kategori,'Biaya usaha lainnya'),t.jumlah);
        if(flow==='personalExpense')group(personal,label(t.kategori,'Belanja pribadi lainnya'),t.jumlah);
        if(flow==='sale')group(sources,label(t.salesSource,'Sumber belum disebutkan'),t.jumlah);
        if(routes[flow])result.transfers.push({id:t.id,tanggal:t.tanggal,flow:flow,jumlah:t.jumlah,from:routes[flow][0],to:routes[flow][1],catatan:label(t.catatan,'')});
      });
      totals.businessReceipts=add(totals.sales,totals.otherBusinessIncome);
      totals.surplus=add(add(totals.businessReceipts,-totals.operatingExpense),-totals.taxPayment);
      totals.afterDraw=add(totals.surplus,-totals.ownerDraw);
      totals.personalNet=add(totals.personalIncome,-totals.personalExpense);
      totals.personalCashChange=add(add(totals.personalNet,totals.ownerDraw),-totals.capital);
      function sorted(map){return Array.from(map.values()).sort(function(a,b){return b.amount-a.amount||a.name.localeCompare(b.name);});}
      result.businessCategories=sorted(business);result.personalCategories=sorted(personal);result.salesSources=sorted(sources);
      result.transfers.sort(function(a,b){return b.tanggal.localeCompare(a.tanggal)||a.id.localeCompare(b.id);});
      result.available=true;result.provisional=result.counts.unknown>0||result.counts.invalid>0;result.status=result.provisional?'provisional':'complete';return result;
    }catch(e){return unavailable(e&&e.message||'Radar belum dapat dihitung dengan aman.');}
  }
  return Object.freeze({summarize:summarize});
});
