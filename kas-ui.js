(function () {
  'use strict';
  const F = window.KasFinance, S = window.KasStorage, B = window.KasBuckets, A = window.KasAccounts, KEY = 'soldier_kas_v2';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rupiah = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
  const localDate = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); };
  const uid = () => window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const clone = d => JSON.parse(JSON.stringify(d));
  const parseMoney = id => { const s = $(id).value.trim().replace(/\./g,'').replace(/\s/g,''); return /^\d+$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : null; };
  const setMoney = (id,n) => { $(id).value = n == null ? '' : Number(n).toLocaleString('id-ID'); };
  let storage, loaded;
  try { storage = window.localStorage; loaded = S.open(storage,KEY); }
  catch (e) { loaded = {data:null,raw:null,error:'Penyimpanan browser tidak dapat dibuka. Jangan hapus data situs.'}; }
  let DB = loaded.data || {tx:[],pi:[]}, raw = loaded.raw, blocked = !!loaded.error, activeView = 'dashboard', payId = null, toastTimer, previousCashDate='';
  $('month').value = localDate().slice(0,7);
  function entryStatus(message,error) { $('entrySaveStatus').textContent=message||'';$('entrySaveStatus').className='notice'+(message?(error?' error':' warning'):' hidden'); }
  function notice(message,error) { $('storageNotice').textContent = message; $('storageNotice').className = 'notice'+(error?' error':'');if(error&&activeView==='transactions')entryStatus(message,true); }
  function toast(message) { $('toast').textContent=message; $('toast').style.display='block'; clearTimeout(toastTimer); toastTimer=setTimeout(()=>{$('toast').style.display='none';},4200); }
  function download(name,content,type,keepUrl) { const b=new Blob([content],{type:type||'application/json'}), u=URL.createObjectURL(b), a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();if(!keepUrl)setTimeout(()=>URL.revokeObjectURL(u),10000);return u; }
  function backup() { if(loaded.error&&loaded.raw===null){alert('Data browser belum dapat dibaca. Tidak ada cadangan kosong yang dibuat. Jangan hapus data situs.');return false;}download('kas-command-backup-'+localDate()+'.json',loaded.error ? loaded.raw : JSON.stringify(DB,null,2));return true; }
  function commit(next,message) {
    if(blocked) { notice('Perubahan belum disimpan. Unduh cadangan lalu buka ulang halaman ini. '+(loaded.error||'Data berubah di tab lain.'),true);return false; }
    const reserveCheck=A.validate(next.tx,F);
    if(!reserveCheck.ok){const message='Belum disimpan: '+reserveCheck.errors.join(' ')+' Data sebelumnya tetap ada.';if(activeView==='transactions')entryStatus(message,true);alert(message);return false;}
    const result = S.transaction(storage,KEY,raw,next);
    if(!result.ok) { notice('Belum tersimpan: '+result.error+'. Form tetap terbuka; jangan tutup sebelum masalah selesai.',true);if(result.code==='conflict')blocked=true;return false; }
    DB=next;raw=result.raw;notice('Tersimpan di perangkat ini · belum sinkron antar-perangkat');render();
    if(message)toast(message);return true;
  }
  function invalidateTaxConfirmation(next) {
    const previous=new Map(DB.tx.map(t=>[t.id,t])), changed=[];
    next.tx.forEach(t=>{const old=previous.get(t.id);previous.delete(t.id);if(JSON.stringify(old)!==JSON.stringify(t))changed.push(old,t);});
    changed.push(...previous.values());
    const years=new Set();let uncertain=false;
    changed.filter(Boolean).forEach(t=>{
      const f=F.classify(t);
      if(!F.validDate(t.tanggal)){uncertain=true;return;}
      if(f!=='sale'&&f!=='businessIncome'&&!(f==='review'&&t.tipe==='in'))return;
      years.add(t.tanggal.slice(0,4));
      if(t.omzetTanggal){if(F.validDate(t.omzetTanggal))years.add(t.omzetTanggal.slice(0,4));else uncertain=true;}
    });
    const months=(next.kasSettings||{}).taxMonths||{};
    Object.keys(months).forEach(m=>{if(uncertain||years.has(m.slice(0,4)))months[m].complete=false;});
  }
  function mutate(fn,message) { const next=clone(DB);fn(next);invalidateTaxConfirmation(next);return commit(next,message); }
  function go(view) {
    activeView=view;document.querySelectorAll('.view').forEach(e=>e.classList.toggle('hidden',e.id!==view));
    document.querySelectorAll('#nav button').forEach(e=>e.classList.toggle('active',e.dataset.view===view));
    $('moreMenu').open=false;
    $('moreMenu').classList.toggle('active',['owner','reserve','debts','settings'].includes(view));
    if(view==='reports')fillTaxSettings();
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function monthName(m) { return new Date(m+'-01T12:00:00').toLocaleDateString('id-ID',{month:'long',year:'numeric'}); }
  function currentSummary() { return F.summary(DB.tx,$('month').value); }
  function currentSplit() { return B.summary(DB.tx,$('month').value,F); }
  function currentAccounts() { return A.summary(DB.tx,$('month').value,F,B); }
  function currentCash() { return A.cashSummary(DB.tx,$('month').value,F); }
  const accountNames={operational:'Operasional',tax:'Cadangan pajak',personal:'Pribadi'};
  const transferRoutes={ownerDraw:['operational','personal'],taxReserve:['operational','tax'],taxReturn:['tax','operational'],capital:['personal','operational']};
  let selectedAccount='operational';
  function splitPolicy() { return B.policy(DB.kasSettings||{}); }
  function taxSettings() {
    const m=$('month').value,y=m.slice(0,4), p=DB.kasSettings||{}, yearly=(p.taxYears||{})[y]||{}, monthly=(p.taxMonths||{})[m]||{};
    return {...yearly,...monthly,complete:monthly.complete===true};
  }
  function currentTax() { return F.tax(DB.tx,$('month').value,taxSettings()); }
  const line = (a,b,c='') => '<div class="label-value '+c+'"><span>'+esc(a)+'</span><strong>'+esc(typeof b==='number'?rupiah(b):b)+'</strong></div>';
  const flowLabel = t => (F.flows[F.classify(t)]||F.flows.review).label;
  const reserveSourceLabel = t => t.reserveAccount==='tax'?'cadangan pajak':t.reserveAccount==='operational'?'operasional':'belum valid — perlu diperiksa';
  function needsReview(t) { return F.classify(t)==='review' || (F.classify(t)==='sale' && !Number.isSafeInteger(t.gross)) || (F.classify(t)==='businessIncome' && t.taxTreatment!=='nonOmzet'); }
  function cashAppearance(t) {
    const f=F.classify(t),meta=F.flows[f];
    if(t.voided)return {direction:'neutral',label:'Dibatalkan',sign:'',color:''};
    if(F.isOpeningBalance(t))return {direction:'neutral',label:'Saldo awal',sign:'',color:''};
    if(f==='review')return {direction:'neutral',label:'Perlu ditinjau',sign:'',color:''};
    if(f==='taxReserve'||f==='taxReturn')return {direction:'neutral',label:'Pindah cadangan · bukan biaya',sign:'',color:''};
    if(meta.scope==='neutral')return {direction:'neutral',label:'Transfer sendiri',sign:'',color:''};
    return t.tipe==='in'?{direction:'in',label:'Masuk'+(meta.scope==='personal'?' · pribadi':' · usaha'),sign:'+',color:'positive'}:{direction:'out',label:'Keluar'+(meta.scope==='personal'?' · pribadi':' · usaha'),sign:'−',color:'negative'};
  }
  function rowsHTML(tx,actions=true,perspective='business') {
    if(!tx.length)return '<p class="empty">Belum ada transaksi untuk pilihan ini.</p>';
    return tx.slice().sort((a,b)=>String(b.tanggal).localeCompare(String(a.tanggal))).map(t=>{
      let a=cashAppearance(t);
      const f=F.classify(t),route=transferRoutes[f];
      if(!t.voided&&route&&route.includes(perspective)){
        const incoming=route[1]===perspective;
        a={direction:incoming?'in':'out',label:accountNames[route[0]]+' → '+accountNames[route[1]],sign:incoming?'+':'−',color:incoming?'positive':'negative'};
      }
      return '<div class="transaction cash-'+a.direction+'"><span class="cash-direction">'+esc(a.label)+'</span><div class="transaction-head"><strong>'+esc(flowLabel(t))+(!t.voided&&needsReview(t)?'<span class="badge">Tinjau</span>':'')+'</strong><strong class="'+a.color+'">'+a.sign+esc(rupiah(t.jumlah))+'</strong></div><p>'+esc([t.tanggal,t.kategori,t.salesSource,t.channel].filter(Boolean).join(' · '))+'</p><p>'+esc(t.catatan||'')+'</p>'+(F.classify(t)==='sale'?'<p>Penjualan sebelum biaya: '+esc(t.gross==null?'Belum diperiksa':rupiah(t.gross))+' · tanggal penjualan '+esc(t.omzetTanggal||t.tanggal)+'</p>':'')+(Object.hasOwn(t,'reserveAccount')?'<p>Sumber pembayaran: '+esc(reserveSourceLabel(t))+'</p>':'')+(actions?'<div class="row-actions">'+(t.voided?'<button data-restore-tx="'+esc(t.id)+'">Aktifkan lagi</button>':'<button data-edit="'+esc(t.id)+'">Edit</button><button class="danger" data-void="'+esc(t.id)+'">Batalkan</button>')+'</div>':'')+'</div>';
    }).join('');
  }
  function renderTransactions() {
    const m=$('month').value,q=$('searchTx').value.trim().toLowerCase(), filter=$('txFilter').value;
    const tx=DB.tx.filter(t=>{
      if(!t||typeof t!=='object')return false;
      if(filter!=='reviewAll'&&String(t.tanggal).slice(0,7)!==m)return false;
      if(filter==='voided'? !t.voided : t.voided)return false;
      const k=F.classify(t),f=F.flows[k]||F.flows.review;
      if((filter==='review'||filter==='reviewAll')&&!needsReview(t))return false;
      if(filter==='business'&&f.scope!=='business')return false;
      if(filter==='personal'&&f.scope!=='personal'&&k!=='ownerDraw'&&k!=='capital')return false;
      return !q || [t.kategori,t.salesSource,t.channel,t.catatan,flowLabel(t)].join(' ').toLowerCase().includes(q);
    });
    $('transactionList').innerHTML=rowsHTML(tx);
  }
  function renderAccounts() {
    let a;try{a=currentCash();}catch(e){a={};}
    const unreadable=!!loaded.error,stale=blocked&&!unreadable;
    renderMainCash(a,unreadable,stale);
    const uncertain=unreadable||stale||!a.ready;
    $('accountsNotice').classList.toggle('hidden',!uncertain);
    $('accountsNotice').textContent=unreadable?'Data belum dapat dibaca. Jangan hapus data situs.':stale?'Angka sebelumnya: data berubah di tab lain. Isian belum dibuang; muat ulang setelah menyimpan cadangan.':a.available?'Catatan lama belum lengkap. Angka sementara, bukan saldo bank. Data lama tetap disimpan.':'Ada catatan yang belum dapat dihitung dengan aman. Buka perhitungan atau cadangan untuk diperiksa.';
    $('accountBalances').innerHTML=Object.entries(accountNames).map(([key,name])=>{
      const x=a[key]||{},valid=!unreadable&&x.available,provisional=valid&&(x.provisional||stale);
      return '<article class="account-card account-'+key+'" data-account="'+key+'"><h2>'+name+'</h2><span class="account-state">'+(valid?(provisional?'Saldo tercatat · sementara':'Saldo tercatat'):'Perlu diperiksa')+'</span><strong class="account-amount '+(valid&&x.closing<0?'negative':'')+'" data-balance="'+key+'">'+esc(valid?rupiah(x.closing):'Belum dapat dihitung')+'</strong><button data-account-history="'+key+'">Lihat catatan</button></article>';
    }).join('');
  }
  // Presentation only: the business balance already consists of operational + tax cash.
  // Personal cash, unpaid debts, and old planning percentages are never added or subtracted here.
  function renderMainCash(a,unreadable,stale) {
    const operational=a.operational||{},tax=a.tax||{};
    const safe=n=>Number.isSafeInteger(n);
    const combined=safe(operational.closing)&&safe(tax.closing)?operational.closing+tax.closing:null;
    const available=!unreadable&&operational.available&&tax.available&&safe(combined);
    const provisional=available&&(operational.provisional||tax.provisional||stale);
    let summary;try{if(available)summary=currentSummary();}catch(e){summary=null;}
    const metrics=available&&summary&&safe(summary.businessIn)&&safe(summary.businessOut)&&summary.businessIn>=0&&summary.businessOut>=0&&summary.cashBusinessClosing===combined;
    $('mainCashSummary').innerHTML='<div class="cash-hero-head"><span class="eyebrow">KAS USAHA</span><span>'+esc(monthName($('month').value))+'</span></div>'+
      '<span class="cash-hero-state">'+(available?(provisional?'Saldo tercatat · sementara':'Saldo tercatat'):'Perlu diperiksa')+'</span>'+
      '<strong class="cash-hero-amount '+(available&&combined<0?'negative':'')+'" data-main-cash>'+esc(available?rupiah(combined):'Belum dapat dihitung')+'</strong>'+
      '<p class="cash-hero-note">Operasional + cadangan pajak. Uang pribadi terpisah.</p>'+
      (provisional?'<p class="cash-hero-note">'+(stale?'Data berubah di tab lain. Ini angka sebelumnya; simpan cadangan sebelum memuat ulang.':'Sebagian catatan lama perlu diperiksa. Angka ini masih sementara.')+'</p>':'')+
      '<div class="cash-hero-metrics"><div><span>Masuk usaha · bulan ini</span><strong class="positive" data-business-in>'+esc(metrics?rupiah(summary.businessIn):'Belum dapat dihitung')+'</strong></div><div><span>Keluar usaha · bulan ini</span><strong class="negative" data-business-out>'+esc(metrics?rupiah(summary.businessOut):'Belum dapat dihitung')+'</strong></div></div>'+
      '<div class="cash-hero-bottom"><p class="cash-hero-note">Dari catatan sampai bulan dipilih, bukan saldo langsung bank.</p><button class="cash-hero-link" data-business-history="true">Lihat transaksi usaha <span aria-hidden="true">↗</span></button></div>';
  }
  function accountContains(t,key) {
    const f=F.classify(t),route=transferRoutes[f];
    if(route)return route.includes(key);
    if(key==='tax')return f==='taxPayment'&&t.reserveAccount==='tax';
    if(key==='personal')return ['personalIncome','personalExpense','openingPersonal'].includes(f);
    return ['sale','businessIncome','loan','expense','debtPayment','openingBusiness'].includes(f)||(f==='taxPayment'&&t.reserveAccount!=='tax');
  }
  function renderAccountHistory(){
    const m=$('month').value;
    $('accountHistoryTitle').textContent='Catatan '+accountNames[selectedAccount]+' · '+monthName(m);
    $('accountHistoryNote').textContent='Pindah uang dicatat sekali dan terlihat di kedua rekening. Riwayat ini untuk bulan yang dipilih.';
    let x;try{x=currentCash()[selectedAccount];}catch(e){x={};}
    $('accountHistoryTotals').innerHTML=!loaded.error&&x.available?line('Saldo awal bulan',x.opening)+line('Masuk bulan ini',x.incoming,'positive')+line('Keluar bulan ini',x.outgoing,'negative')+line('Saldo akhir tercatat'+(x.provisional||blocked?' · sementara':''),x.closing,'total')+'<p class="hint">Saldo awal + masuk − keluar. Minus tetap dibawa, tidak dihapus.</p>':'<p class="notice warning">'+esc(loaded.error||(x.errors||[]).join(' ')||'Belum dapat dihitung dengan aman.')+'</p>';
    $('accountHistoryList').innerHTML=loaded.error?'<p class="notice warning">Data belum dapat dibaca. Jangan hapus data situs.</p>':rowsHTML(DB.tx.filter(t=>t&&!t.voided&&String(t.tanggal).slice(0,7)===m&&accountContains(t,selectedAccount)),true,selectedAccount);
  }
  function showAccountHistory(key){if(!Object.hasOwn(accountNames,key))return;selectedAccount=key;renderAccountHistory();go('accountHistory');}
  function renderBalanceDetails(){
    const month=$('month').value,account=$('balanceDetailAccount').value||'personal';
    let d;
    try{if(loaded.error)throw new Error(loaded.error);d=window.KasAccountDetails.build(DB.tx,month,account,F,A);}catch(error){d={available:false,errors:[loaded.error||'Rincian saldo belum dapat dimuat. Muat ulang aplikasi; data tidak diubah.']};}
    const status=$('balanceDetailStatus'),uncertain=!d.available||d.provisional||blocked;
    status.classList.toggle('hidden',!uncertain);
    status.textContent=blocked&&!loaded.error?'Data berubah di tab lain. Angka ini dari catatan sebelumnya; muat ulang setelah mencadangkan isian.':d.available&&d.provisional?'Sebagian catatan lama belum jelas. Angka ini sementara, hanya dari catatan yang sudah dikenali. Tidak ada data yang dihapus.':(d.errors||[]).join(' ');
    if(!d.available){
      $('balanceDetailSummary').innerHTML='<h3>'+esc(accountNames[account]||'Saldo')+'</h3><strong>Belum dapat dihitung</strong>';
      $('balanceDetailGroups').innerHTML='<p class="hint">Tidak ada total sementara yang ditebak. Data tetap tersimpan.</p>';
      $('balanceDetailRows').innerHTML='';$('balanceDetailCount').textContent='Transaksi belum dapat dirinci';return;
    }
    const signed=value=>(value>0?'+':value<0?'−':'')+rupiah(Math.abs(value));
    const tone=value=>value<0?'negative':value>0?'positive':'';
    $('balanceDetailSummary').innerHTML='<h3>'+esc(accountNames[account])+' · '+esc(monthName(month))+'</h3><strong class="detail-balance '+tone(d.closing)+'">'+esc(rupiah(d.closing))+'</strong>'+(d.provisional||blocked?'<p class="hint">Sementara — berdasarkan catatan yang sudah dikenali.</p>':'')+'<p class="hint">'+(d.closing<0?'Minus berarti catatan pengurangan lebih besar daripada penambahan saldo. Bukan otomatis utang bank.':'Ini saldo dari pencatatan, bukan saldo langsung bank.')+'</p><details><summary>Perhitungan bulan ini</summary>'+line('Saldo sebelum bulan ini',d.opening)+line('Masuk bulan ini',d.incoming,'positive')+line('Keluar bulan ini',d.outgoing,'negative')+line('Saldo akhir',d.closing,tone(d.closing))+'</details>';
    $('balanceDetailGroups').innerHTML=d.groups.map(g=>line((F.flows[g.flow]?.label||g.flow)+' · '+g.count+' catatan',signed(g.net),tone(g.net))).join('')+line('Saldo dari seluruh catatan',d.closing,'total '+tone(d.closing));
    const byId=new Map(DB.tx.filter(t=>t&&typeof t==='object'&&t.voided!==true&&F.validDate(t.tanggal)&&t.tanggal.slice(0,7)<=month).map(t=>[t.id,t]));
    $('balanceDetailRows').innerHTML=d.rows.map(row=>{const t=byId.get(row.id)||{};return '<div class="balance-audit-row"><p>'+esc([row.date,F.flows[row.flow]?.label||row.flow].join(' · '))+'</p>'+line(row.isOpening?'Saldo awal tercatat':row.delta>=0?'Menambah saldo':'Mengurangi saldo',signed(row.delta),tone(row.delta))+'<p class="hint">'+esc([t.kategori,t.channel,t.catatan].filter(Boolean).join(' · '))+'</p>'+line('Saldo setelah transaksi',row.balance,tone(row.balance))+'</div>';}).join('')||'<p class="empty">Belum ada transaksi pembentuk saldo.</p>';
    $('balanceDetailCount').textContent='Lihat '+d.rows.length+' transaksi pembentuk saldo';
  }
  function render() {
    const m=$('month').value;let s;
    $('periodLabel').textContent=monthName(m);$('reportTitle').textContent='Laporan konsultan · '+monthName(m);
    renderAccounts();renderAccountHistory();renderBalanceDetails();
    // A cash-summary problem must not hide the independent all-month debt ledger.
    try {
      if(loaded.error)throw new Error('Unreadable source');
      renderDebts();
    } catch(error) {
      ['debtList','legacyReceivables'].forEach(id=>{$(id).innerHTML='<p class="notice warning">Catatan utang / bon belum dapat ditampilkan. Data asli tidak diubah; unduh cadangan untuk diperiksa.</p>';});
    }
    const unavailable=()=>{['reserveSummary','reserveList','ownerSummary','ownerSplitSummary','ownerList','recentList','reviewNotice','transactionList','taxSummary','consultantStatus'].forEach(id=>{$(id).innerHTML='<p class="notice warning">Data bulan '+esc(monthName(m))+' belum dapat dihitung. Periksa cadangan; tidak ada data yang dihapus.</p>';});};
    if(loaded.error){unavailable();return;}
    try{s=currentSummary();}catch(error){unavailable();notice('Ringkasan belum dapat dihitung. Data asli tetap tersimpan; unduh cadangan untuk diperiksa.',true);return;}
    let tax;try{tax=currentTax();}catch(error){tax={unavailable:true};}
    const t=s.totals,budget=((DB.kasSettings||{}).ownerBudgets||{})[m]||0,b=currentSplit(),a=currentCash();
    renderSplit(b);
    $('reserveSummary').innerHTML=line('Cadangan tersisa sampai bulan ini',a.tax.available?a.tax.closing:'Belum dapat dihitung','total')+(!a.tax.available?'<p class="notice warning">'+esc(a.tax.errors.join(' '))+'</p>':'');
    $('reserveList').innerHTML=rowsHTML(s.tx.filter(x=>accountContains(x,'tax')),true,'tax');
    const review=s.tx.filter(needsReview).length;
    $('reviewNotice').innerHTML=review||s.invalidCount||!s.balancesComplete?'<details class="compact-details"><summary>Periksa catatan lama</summary><p>Catatan yang belum lengkap tidak diubah otomatis.</p><button data-review>Cek catatan</button><p>'+review+' transaksi bulan ini perlu peninjauan'+(s.invalidCount?' · '+s.invalidCount+' catatan tidak valid':'')+(s.balanceUnresolvedCount?' · '+s.balanceUnresolvedCount+' transaksi sampai bulan ini belum jelas jenisnya':'')+'.</p></details>':'';
    $('recentList').innerHTML=rowsHTML(s.tx.slice().sort((a,b)=>b.tanggal.localeCompare(a.tanggal)).slice(0,5),false);
    $('ownerSummary').innerHTML=line('Rencana bulan ini',budget)+line('Sudah diambil',t.ownerDraw||0)+line('Sisa rencana',Math.max(0,budget-(t.ownerDraw||0)));
    if(document.activeElement!==$('ownerBudget'))setMoney('ownerBudget',budget);
    $('ownerList').innerHTML=rowsHTML(s.tx.filter(x=>F.classify(x)==='ownerDraw'),true,'personal');
    renderTransactions();renderTax(tax);renderConsultant();entryGuidance();
  }
  function renderSplit(b) {
    const p=splitPolicy(),title=!p.valid?'Pengaturan rencana perlu diperiksa':p.enabled?(100-p.personalPercent)+'% usaha · '+p.personalPercent+'% pribadi':'Rencana persentase dijeda';
    $('ownerSplitSummary').innerHTML='<h3>'+esc(title)+'</h3><p class="hint">Rencana lama saja, bukan saldo rekening. Tidak mengurangi operasional atau menambah pribadi.</p>'+(b.ready?line('Rencana dari penjualan bulan ini',b.monthPersonal)+line('Pengambilan terhubung bulan ini',b.monthDrawn)+line('Sisa rencana',b.remainingPersonal):'<p class="notice warning">Rencana belum dapat dihitung. '+esc(b.errors.join(' '))+'</p>');
    if(document.activeElement!==$('splitPercent')&&document.activeElement!==$('splitEnabled')){
      $('splitPercent').value=p.valid?p.personalPercent:'';$('splitEnabled').checked=p.valid&&p.enabled;
    }
    renderSplitPreview();
  }
  function renderSplitPreview() {
    const el=$('splitPreview');
    el.classList.toggle('hidden',$('flow').value!=='sale');
    el.textContent='Seluruh uang diterima menambah operasional. Ke pribadi atau pajak? Catat terpisah melalui Pindah uang setelah transfer bank.';
  }
  function renderTax(tax) {
    if(tax.unavailable){$('taxSummary').innerHTML='<p class="notice warning">Rekap omzet belum dapat dihitung karena total melampaui batas aman. Periksa angka omzet; ringkasan kas tetap terpisah.</p>';return;}
    $('taxSummary').innerHTML=(tax.ready?'':'<div class="notice warning"><strong>Estimasi belum siap</strong><p>'+esc((tax.errors||[]).join(' '))+'</p></div>')+
      line('Omzet bruto bulan ini'+(tax.ready?'':' (sementara)'),tax.monthTurnover||0)+line('Omzet kumulatif tahun ini'+(tax.ready?'':' (sementara)'),tax.ytdTurnover||0)+
      line('Bagian omzet kena PPh bulan ini',tax.ready?tax.taxableMonth:'Belum dapat dihitung')+
      line('Estimasi PPh final 0,5%',tax.ready?tax.estimate:'Lengkapi data','total')+
      line('Potongan pihak lain (sesuai bukti)',tax.withheld===null?'Belum dikonfirmasi':tax.withheld)+line('Setoran masa pajak ini',tax.paid===null?'Belum dikonfirmasi':tax.paid)+line('Sisa estimasi yang perlu disetor',tax.ready&&tax.remaining!==null?tax.remaining:'Belum dapat dihitung')+
      (tax.ready&&tax.withheld+tax.paid>tax.estimate?'<p class="notice warning">Potongan / setoran melebihi estimasi. Cocokkan bukti; bukan pengembalian otomatis.</p>':'')+
      (tax.warnings||[]).map(w=>'<p class="notice warning">'+esc(w)+'</p>').join('');
  }
  const descriptions={
    sale:'Hasil penjualan. Bedakan uang diterima dan nilai sebelum potongan.',
    expense:'Biaya usaha yang dibayar, bukan belanja pribadi atau pokok utang.',
    personalIncome:'Pemasukan pribadi dari luar usaha. Tidak masuk rekap omzet UMKM ini; bukan berarti bebas seluruh pajak.',
    personalExpense:'Belanja pribadi hanya mengurangi saldo Pribadi. Untuk memindahkan uang dari operasional, gunakan Pindah uang.',
    capital:'Pindahkan uang pribadi menjadi modal usaha. Dicatat sekali: pribadi berkurang, usaha bertambah.',
    ownerDraw:'Uang usaha yang kamu ambil untuk diri sendiri. Dicatat sekali: usaha berkurang, pribadi bertambah.',
    loan:'Uang pinjaman yang diterima usaha, bukan penjualan. Catatan kewajibannya dibuat di menu Utang.',
    debtPayment:'Pembayaran pokok utang, bukan biaya usaha. Untuk utang yang ada di menu Utang, gunakan tombol Bayar di sana agar saldonya ikut berkurang.',
    taxPayment:'Kas yang benar-benar keluar untuk pajak. Catat masa pajak dan nomor bukti di catatan; isi rekonsiliasi di Laporan bulanan.',
    taxReserve:'Catat uang yang sudah kamu pindahkan dari operasional ke rekening pajak. Nominal kamu tentukan sendiri. Bukan biaya dan belum bayar pajak.',
    taxReturn:'Catat cadangan pajak yang sudah kamu kembalikan ke rekening operasional. Bukan pemasukan penjualan.',
    businessIncome:'Penerimaan usaha selain penjualan. Pastikan perlakuan omzetnya sebelum menggunakan estimasi pajak.',
    transferIn:'Riwayat transfer masuk antar-rekening milik sendiri dalam lingkup yang sama (usaha ke usaha, atau pribadi ke pribadi). Tidak menambah total kas atau omzet.',
    transferOut:'Riwayat transfer keluar antar-rekening milik sendiri dalam lingkup yang sama. Tidak mengurangi total kas. Untuk usaha ke pribadi gunakan Jatah saya.'
  };
  const entryTitles={ownerDraw:'Operasional → Pribadi',taxReserve:'Operasional → Cadangan pajak',taxReturn:'Cadangan pajak → Operasional',taxPayment:'Bayar pajak usaha',expense:'Pengeluaran usaha',personalExpense:'Pengeluaran pribadi',capital:'Pribadi → Operasional',sale:'Uang masuk'};
  let lastEntryFlow='sale';
  function cashBefore(date,editId){
    const eligible=DB.tx.filter(t=>!t||t.id!==editId&&(!F.validDate(t.tanggal)||t.tanggal<=date));
    return A.cashSummary(eligible,F.validDate(date)?date.slice(0,7):$('month').value,F);
  }
  function entryGuidance(){
    const f=$('flow').value,route=transferRoutes[f],direct=!!route,editing=!!$('editId').value;
    $('transactionForm').dataset.flow=f;
    $('entryChoiceFields').classList.toggle('hidden',direct&&!editing);
    $('entryGuide').classList.toggle('hidden',!direct);
    $('entryTitle').textContent=entryTitles[f]||F.flows[f]?.label||'Periksa transaksi';
    $('entryRoute').textContent=route?accountNames[route[0]]+' → '+accountNames[route[1]]:f==='personalExpense'?'Dari rekening pribadi':f==='expense'?'Dari rekening operasional':f==='sale'?'Catat uang yang benar-benar diterima':F.flows[f]?.label||'Pilih jenis transaksi';
    $('saveTransaction').textContent=editing?'Simpan perubahan':direct?'Simpan pemindahan uang':f==='expense'||f==='personalExpense'?'Simpan pengeluaran':f==='sale'?'Simpan uang masuk':'Simpan catatan';
    if(direct){
      $('marketplaceSource').required=false;
      let source;try{source=cashBefore($('date').value,$('editId').value)[route[0]];}catch(e){source={};}
      const available=!loaded.error&&source.available,value=available?source.closing:null;
      $('entryGuide').innerHTML=editing?'<p>Koreksi catatan yang sudah ada, bukan transfer baru. <strong>Jangan transfer lagi.</strong></p>':line('Saldo '+accountNames[route[0]]+(source.provisional||blocked?' · sementara':''),value===null?'Belum dapat dihitung':value,'total')+'<p>Isi uang yang <strong>sudah dipindahkan lewat bank</strong>. Simpan sekali: '+esc(accountNames[route[0]])+' berkurang, '+esc(accountNames[route[1]])+' bertambah.</p>'+(!available||source.provisional||blocked||value<0?'<p class="hint">Catatan sumber belum lengkap atau minus. Cocokkan saldo bank. Jika transfer sudah terjadi, tetap catat sekali.</p>':'')+'<p class="hint">Aplikasi tidak mentransfer uang melalui bank.</p>';
      $('amountLabel').firstChild.textContent='Jumlah yang sudah dipindahkan (Rp)';
    }
  }
  function flowChanged() {
    const f=$('flow').value,isSale=f==='sale';
    const a=cashAppearance({flow:f,tipe:F.flows[f]?.tipe});
    $('transactionForm').dataset.direction=a.direction;
    $('flowIndicator').textContent=a.label;
    $('flowHelp').textContent=descriptions[f]||'Pilih jenis yang sesuai dengan transaksi aslinya.';
    $('saleFields').classList.toggle('hidden',!isSale);$('gross').required=false;$('grossDate').required=isSale;
    $('taxPaySourceField').classList.toggle('hidden',f!=='taxPayment');
    $('expenseAccountField').classList.toggle('hidden',!['expense','personalExpense'].includes(f));
    $('expenseAccount').value=f==='personalExpense'?'personal':'operational';
    $('otherIncomeFields').classList.toggle('hidden',f!=='businessIncome');
    $('amountLabel').firstChild.textContent=(F.flows[f]&&F.flows[f].tipe==='out'?'Uang keluar (Rp)':'Uang masuk (Rp)');
    renderSplitPreview();entryGuidance();
  }
  const simpleKinds={
    personalExpense:{label:'Belanja pribadi',flow:'personalExpense',category:'Belanja Pribadi'},
    marketplace:{label:'Penjualan marketplace',flow:'sale',category:'Penjualan'},offline:{label:'Penjualan offline',flow:'sale',category:'Penjualan'},capital:{label:'Modal pribadi untuk usaha',flow:'capital',category:'Modal pribadi'},
    fabric:{label:'Bahan baku / kain',flow:'expense',category:'Bahan Baku / Kain'},sewing:{label:'Aksesoris jahit',flow:'expense',category:'Aksesoris Jahit'},printing:{label:'Aksesoris sablon',flow:'expense',category:'Aksesoris Sablon'},wages:{label:'Upah / gaji maklon',flow:'expense',category:'Upah / Gaji Maklon'},otherExpense:{label:'Biaya usaha lainnya',flow:'expense',category:'Biaya Usaha Lainnya'},taxPayment:{label:'Bayar pajak',flow:'taxPayment',category:'Pajak'},other:{label:'Transaksi lainnya',flow:null}
  };
  function simplePicker(direction,kind){
    const keys=direction==='in'?['marketplace','offline','capital','other']:kind==='personalExpense'?['personalExpense']:['fabric','sewing','printing','wages','otherExpense','taxPayment','other'];
    $('entryKind').innerHTML=keys.map(k=>'<option value="'+k+'">'+simpleKinds[k].label+'</option>').join('');
    $('entryKind').value=keys.includes(kind)?kind:'other';
    $('chooseIncome').classList.toggle('active',direction==='in');$('chooseExpense').classList.toggle('active',direction==='out');
    $('entryKindLabel').firstChild.textContent=direction==='in'?'Uang dari mana?':'Untuk keperluan apa?';
    $('marketplaceField').classList.toggle('hidden',kind!=='marketplace');$('marketplaceSource').required=kind==='marketplace';
    $('advancedKinds').open=kind==='other';$('advancedKinds').classList.toggle('hidden',kind!=='other');entryGuidance();
  }
  function syncPicker(record){
    const f=$('flow').value,source=record?.salesSource||(['Shopee','TikTok Shop','Lazada','Offline'].includes(record?.channel)?record.channel:'');
    let kind=f==='sale'?(source==='Offline'?'offline':['Shopee','TikTok Shop','Lazada','Marketplace lainnya'].includes(source)?'marketplace':record?'other':'marketplace'):f==='capital'?'capital':f==='taxPayment'?'taxPayment':f==='expense'?(Object.keys(simpleKinds).find(k=>simpleKinds[k].flow==='expense'&&simpleKinds[k].category===$('category').value)||(record?'other':'otherExpense')):'other';
    if(f==='personalExpense')kind='personalExpense';
    simplePicker(F.flows[f]?.tipe==='out'?'out':'in',kind);
    if(kind==='marketplace')$('marketplaceSource').value=source||'';
  }
  function selectSimpleKind(){
    const k=$('entryKind').value,choice=simpleKinds[k];
    if(!choice)return;
    if(choice.flow){$('flow').value=choice.flow;$('category').value=choice.category;}
    $('marketplaceField').classList.toggle('hidden',k!=='marketplace');$('marketplaceSource').required=k==='marketplace';$('advancedKinds').open=k==='other';$('advancedKinds').classList.toggle('hidden',k!=='other');
    flowChanged();
  }
  function resetForm() {
    entryStatus('');
    $('transactionForm').reset();$('editId').value='';$('date').value=defaultDate();$('grossDate').value=defaultDate();
    previousCashDate=$('date').value;
    $('editNotice').classList.add('hidden');$('cancelEdit').classList.add('hidden');$('saveTransaction').textContent='Simpan transaksi';
    $('channel').value='BCA Operasional';$('marketplaceSource').value='';$('taxPaySource').value='operational';flowChanged();syncPicker();$('saleFields').open=false;
    $('extraFields').open=false;$('saleDateDetails').open=false;
  }
  function beginEntry(flow,category=''){
    const drafted=$('editId').value||$('amount').value||$('gross').value||$('category').value||$('note').value||$('channel').value!=='BCA Operasional'||$('date').value!==defaultDate()||$('grossDate').value!==defaultDate();
    if(drafted&&!confirm('Ada isian yang belum disimpan. Mulai catatan baru dan tinggalkan isian itu?'))return;
    resetForm();$('flow').value=flow;$('category').value=category;
    if(flow==='personalExpense')$('channel').value='Rekening Pribadi';
    flowChanged();syncPicker();go('transactions');
  }
  function editTransaction(id) {
    const t=DB.tx.find(x=>x.id===id);if(!t)return;
    if(F.isOpeningBalance&&F.isOpeningBalance(t)){alert('Ini saldo awal dari aplikasi lama. Nilainya dipertahankan, bukan transaksi pemasukan baru. Jangan ubah melalui form transaksi biasa.');return;}
    if(legacyDebtPayment(t)){alert('Pembayaran lama ini belum memiliki penghubung ke buku utang/piutang. Tidak diubah agar saldo utang dan kas tidak berbeda. Simpan cadangan dan cocokkan bukti pembayaran sebelum koreksi.');return;}
    if(t.debtId){alert('Transaksi ini terkait pembayaran utang. Untuk menjaga kecocokan, batalkan pembayaran ini lalu catat ulang melalui menu Utang.');return;}
    resetForm();$('editId').value=id;
    const f=F.classify(t);
    $('flow').value=Object.hasOwn(descriptions,f)?f:'';
    $('editNotice').textContent='Mengedit transaksi lama. Periksa jenis, jumlah, dan tanggal; data sebelumnya tetap dicadangkan.';
    $('editNotice').classList.remove('hidden');$('cancelEdit').classList.remove('hidden');$('saveTransaction').textContent='Simpan perubahan';
    $('date').value=t.tanggal;setMoney('amount',t.jumlah);setMoney('gross',t.gross);$('grossDate').value=t.omzetTanggal||t.tanggal;
    $('category').value=t.kategori||'';$('channel').value=t.channel||'';$('note').value=t.catatan||'';$('otherTax').value=t.taxTreatment||'review';
    $('extraFields').open=!!(t.kategori||t.catatan);$('saleDateDetails').open=!!(t.omzetTanggal&&t.omzetTanggal!==t.tanggal);
    $('taxPaySource').value=['tax','operational'].includes(t.reserveAccount)?t.reserveAccount:'';
    $('saleFields').open=f==='sale';flowChanged();syncPicker(t);go('transactions');
  }
  $('transactionForm').addEventListener('submit',e=>{
    e.preventDefault();entryStatus('');const f=$('flow').value,amount=parseMoney('amount'),gross=parseMoney('gross'),id=$('editId').value;
    const confirmSave=message=>{if(confirm(message))return true;entryStatus('Belum disimpan — konfirmasi tidak dilanjutkan. Isian tetap ada. Jika uang sudah benar-benar dipindahkan, periksa riwayat lalu simpan sekali.'+(f==='ownerDraw'?' Jangan buat pemasukan pribadi tambahan.':''));return false;};
    if(!F.flows[f]||amount===null||amount<=0){alert('Pilih jenis dan isi jumlah rupiah bulat lebih dari 0. Gunakan titik untuk pemisah ribuan.');return;}
    if(!F.validDate($('date').value)){alert('Tanggal belum valid.');return;}
    if(f==='sale'&&(($('gross').value.trim()&&(gross===null||gross<0))||!F.validDate($('grossDate').value))){$('saleFields').open=true;alert('Isi nilai penjualan dan tanggal yang benar, atau kosongkan nilai sebelum biaya jika belum diketahui.');return;}
    if(f==='sale'&&$('entryKind').value==='marketplace'&&!$('marketplaceSource').value){alert('Pilih Shopee, TikTok Shop, atau marketplace lainnya.');return;}
    const old=id?DB.tx.find(x=>x.id===id):null;if(id&&!old){alert('Transaksi tidak ditemukan. Buka ulang halaman.');return;}
    let record={...(old||{}),id:id||uid(),tipe:F.flows[f].tipe,flow:f,jumlah:amount,kategori:$('category').value.trim()||(!old&&simpleKinds[$('entryKind').value]?.category)||F.flows[f].label,channel:$('channel').value.trim()||'Tidak disebutkan',tanggal:$('date').value,catatan:$('note').value.trim(),updatedAt:new Date().toISOString()};
    if(f==='sale'){if(gross!==null)record.gross=gross;else delete record.gross;record.omzetTanggal=$('grossDate').value;
      if($('entryKind').value==='marketplace')record.salesSource=$('marketplaceSource').value;else if($('entryKind').value==='offline')record.salesSource='Offline';
    }else{delete record.gross;delete record.omzetTanggal;delete record.salesSource;}
    if(f==='taxPayment'){
      if(['tax','operational'].includes($('taxPaySource').value))record.reserveAccount=$('taxPaySource').value;
      else if(!old){alert('Pilih operasional atau cadangan pajak sebagai sumber pembayaran.');return;}
      // Legacy absence stays absent; unknown metadata stays invalid until explicitly corrected.
    }else delete record.reserveAccount;
    if(f==='businessIncome')record.taxTreatment=$('otherTax').value;else delete record.taxTreatment;
    // Legacy planning metadata never controls whether a real cash movement can be recorded.
    // Preserve existing stamps on edits; an invalid old percentage cannot block new cash receipts.
    try {if(old||B.policy(DB.kasSettings||{}).valid)record=B.stamp(record,old,DB.kasSettings||{},F);}catch(error){alert('Belum disimpan: '+error.message);return;}
    if(transferRoutes[f]){
      const source=cashBefore(record.tanggal,old?.id)[transferRoutes[f][0]];
      if(!source.available||source.provisional||blocked||amount>Math.max(0,source.closing)){
        if(!confirmSave('Saldo sumber tercatat minus, belum lengkap, atau tidak cukup. Catat hanya jika uang benar-benar sudah dipindahkan lewat bank. Tetap simpan perpindahan nyata ini?'))return;
      }
    }
    const ok=mutate(next=>{if(old){next.history=next.history||[];next.history.push({type:'edit',at:new Date().toISOString(),record:clone(old)});next.tx[next.tx.findIndex(x=>x.id===id)]=record;}else next.tx.push(record);},'Transaksi tersimpan.');
    if(ok){
      lastEntryFlow=f;if(record.tanggal.slice(0,7)!==$('month').value){$('month').value=record.tanggal.slice(0,7);render();}resetForm();
      $('viewPersonalAfterSave').classList.toggle('hidden',f!=='ownerDraw');
      const route=transferRoutes[f];
      const movement=route?(old?'<p>Koreksi perpindahan tersimpan. Catatan lama diperbarui, bukan transfer baru. Jangan transfer lagi.</p>':'<div class="owner-movement">'+line(accountNames[route[0]]+' berkurang','−'+rupiah(record.jumlah),'negative')+line(accountNames[route[1]]+' bertambah','+'+rupiah(record.jumlah),'positive')+'</div>'):'';
      $('entryReceipt').innerHTML='<h3>'+esc(entryTitles[f]||flowLabel(record))+'</h3>'+line('Jumlah',record.jumlah)+line('Tanggal',record.tanggal)+movement+(record.catatan?'<p>'+esc(record.catatan)+'</p>':'')+'<p class="hint">'+esc(f==='ownerDraw'?(old?'Jangan masukkan lagi sebagai pemasukan pribadi.':'Sudah dicatat sekali: uang usaha berkurang dan uang pribadi bertambah. Jangan masukkan lagi sebagai pemasukan pribadi.'):f==='taxReserve'||f==='taxReturn'?'Perpindahan cadangan sudah dicatat. Tidak dihitung sebagai pemasukan atau biaya usaha.':'Tersimpan di perangkat ini. Jangan masukkan transaksi yang sama lagi.')+'</p><p class="hint">Ini bukti pencatatan, bukan bukti transfer bank.</p>';
      $('recordAnother').textContent='Catat '+(f==='ownerDraw'?'pengambilan berikutnya':f==='expense'?'pengeluaran lagi':'transaksi lagi');go('entrySuccess');
    }else if(!$('entrySaveStatus').textContent)entryStatus('Belum tersimpan. Isian tetap ada; periksa pesan di atas. Jangan catat ulang melalui pemasukan pribadi.',true);
  });
  $('recordAnother').onclick=()=>beginEntry(lastEntryFlow);
  function toggleVoid(id,restore) {
    const t=DB.tx.find(x=>x.id===id);if(!t)return;
    if((F.isOpeningBalance&&F.isOpeningBalance(t))||legacyDebtPayment(t)){alert('Catatan saldo awal atau cicilan lama ini dilindungi agar kas dan riwayat tidak terpisah. Gunakan cadangan untuk peninjauan sebelum koreksi.');return;}
    if(restore&&t.debtId){const debt=DB.pi.find(x=>x.id===t.debtId);if(!debt||t.jumlah>debtValues(debt).remaining)return alert('Pembayaran tidak dapat diaktifkan: jumlah melebihi sisa utang saat ini. Periksa pembayaran yang sudah tercatat.');}
    if(!confirm((restore?'Aktifkan lagi':'Batalkan')+' transaksi '+rupiah(t.jumlah)+'? Riwayat tetap disimpan.'))return;
    mutate(next=>{
      const row=next.tx.find(x=>x.id===id);row.voided=!restore;row.updatedAt=new Date().toISOString();
      if(row.debtId){const debt=next.pi.find(x=>x.id===row.debtId);const payment=debt&&(debt.bayar||[]).find(x=>x.id===row.paymentId);if(payment)payment.voided=!restore;}
    },restore?'Transaksi diaktifkan.':'Transaksi dibatalkan; riwayat tetap ada.');
  }
  function legacyDebtPayment(t){return !t.flow&&!t.debtId&&['Bayar Utang','Pelunasan Piutang'].includes(t.kategori)&&DB.pi.some(x=>x&&Array.isArray(x.bayar)&&x.bayar.length);}
  $('ownerForm').addEventListener('submit',e=>{e.preventDefault();const v=parseMoney('ownerBudget');if(v===null)return alert('Isi jumlah rupiah, boleh 0.');mutate(next=>{next.kasSettings=next.kasSettings||{};next.kasSettings.ownerBudgets=next.kasSettings.ownerBudgets||{};next.kasSettings.ownerBudgets[$('month').value]=v;},'Rencana jatah tersimpan. Tidak ada uang dipindahkan.');});
  $('incomeSplitForm').addEventListener('submit',e=>{
    e.preventDefault();const value=$('splitPercent').value.trim(),percent=Number(value),enabled=$('splitEnabled').checked;
    if(!/^\d+$/.test(value)||!Number.isInteger(percent)||percent<0||percent>100)return alert('Isi persentase pribadi dengan angka bulat 0 sampai 100.');
    mutate(next=>{next.kasSettings=next.kasSettings||{};next.kasSettings.incomeSplit={enabled,personalPercent:percent};},'Pembagian tersimpan untuk penjualan baru. Catatan lama tidak berubah.');
  });
  $('recordOwner').onclick=()=>beginEntry('ownerDraw','Jatah pemilik (prive)');
  function defaultDate(){return $('month').value===localDate().slice(0,7)?localDate():$('month').value+'-01';}
  function fillTaxSettings(){
    const m=$('month').value,p=taxSettings();
    $('taxStart').value=p.startMonth||m.slice(0,4)+'-01';setMoney('taxOpening',p.openingTurnover);
    $('taxEligible').checked=p.eligibleConfirmed===true;$('taxComplete').checked=p.complete===true;
    setMoney('taxWithheld',p.withheld||0);setMoney('taxPaid',p.paid||0);$('taxEvidence').value=p.evidence||'';
  }
  $('taxForm').addEventListener('submit',e=>{
    e.preventDefault();const m=$('month').value,y=m.slice(0,4),start=$('taxStart').value,o=parseMoney('taxOpening'),w=parseMoney('taxWithheld'),p=parseMoney('taxPaid');
    if(!F.validMonth(start)||start.slice(0,4)!==y||start>m||o===null||w===null||p===null)return alert('Periksa bulan mulai dan jumlah rupiah. Bulan mulai harus pada tahun yang sama, tidak setelah bulan laporan.');
    if(start.endsWith('-01')&&o!==0)return alert('Jika mulai Januari, omzet sebelum pencatatan pada tahun itu harus 0.');
    if((w>0||p>0)&&!$('taxEvidence').value.trim())return alert('Isi nomor bukti atau catatan potongan / setoran untuk bulan ini.');
    const existing=(DB.kasSettings||{}).taxYears?.[y];
    mutate(next=>{
      const ks=next.kasSettings=next.kasSettings||{};ks.taxYears=ks.taxYears||{};ks.taxMonths=ks.taxMonths||{};
      if(existing&&(existing.startMonth!==start||existing.openingTurnover!==o)){Object.keys(ks.taxMonths).filter(k=>k.startsWith(y+'-')).forEach(k=>{ks.taxMonths[k].complete=false;});}
      ks.taxYears[y]={...(ks.taxYears[y]||{}),startMonth:start,openingTurnover:o,eligibleConfirmed:$('taxEligible').checked};
      ks.taxMonths[m]={...(ks.taxMonths[m]||{}),complete:$('taxComplete').checked,withheld:w,paid:p,evidence:$('taxEvidence').value.trim()};
    },'Dasar estimasi pajak tersimpan.');
  });
  function txRows(tx){return [['ID','Tanggal kas','Jenis','Masuk/Keluar','Kategori','Rekening/Sumber','Jumlah kas (Rp)','Omzet bruto (Rp)','Tanggal omzet','Status tinjauan','Catatan','Sumber penjualan','Sumber dana pajak'],...tx.map(t=>[t.id,t.tanggal,flowLabel(t),t.tipe==='in'?'Masuk':'Keluar',t.kategori||'',t.channel||'',t.jumlah,F.classify(t)==='sale'?(t.gross??'Belum diperiksa'):'',F.classify(t)==='sale'?(t.omzetTanggal||t.tanggal):'',needsReview(t)?'Perlu ditinjau':'',t.catatan||'',t.salesSource||'',t.reserveAccount||''])];}
  function summaryRows(){
    const b=currentSplit(),amount=key=>b.ready?b[key]:'Belum dapat dipastikan';
    return baseSummaryRows().concat([[],['Pembagian rencana dari penjualan baru','Bukan transfer bank, laba, atau pengurang omzet pajak'],['Penjualan bulan ini dialokasikan ke usaha',amount('monthBusiness')],['Penjualan bulan ini dialokasikan ke pribadi',amount('monthPersonal')],['Pengambilan pribadi bulan ini terhubung',amount('monthDrawn')],['Jatah belum diambil, termasuk sisa sebelumnya',amount('remainingPersonal')],['Kas usaha setelah menyisihkan jatah',amount('businessAfterReserve')],['Pengambilan melebihi alokasi',amount('overdraw')],['Status pembagian',b.ready?'Berdasarkan transaksi bertanda pembagian':b.errors.join(' ')]]);
  }
  function baseSummaryRows(){
    const s=currentSummary(),t=s.totals,m=$('month').value;
    return [['Laporan kas bulanan',m],['Ukuran','Jumlah (Rp)'],['Saldo awal usaha tercatat',s.cashBusinessOpening],['Kas masuk usaha',s.businessIn],['Kas keluar usaha',s.businessOut],['Saldo akhir usaha tercatat',s.cashBusinessClosing],['Penerimaan penjualan',t.sale||0],['Biaya usaha dibayar',t.expense||0],['Modal pemilik masuk',t.capital||0],['Pokok pinjaman masuk',t.loan||0],['Pokok utang dibayar',t.debtPayment||0],['Pajak dibayar (tanggal kas)',t.taxPayment||0],['Jatah pemilik diambil',t.ownerDraw||0],['Saldo awal pribadi tercatat',s.cashPersonalOpening],['Masuk pribadi termasuk jatah',s.personalIn],['Keluar pribadi termasuk modal',s.personalOut],['Saldo akhir pribadi tercatat',s.cashPersonalClosing],['Transaksi bulan ini perlu tinjau',s.tx.filter(needsReview).length],['Transaksi lama belum jelas sampai bulan ini',s.balanceUnresolvedCount||0],['Saldo lengkap',s.balancesComplete?'Ya, berdasarkan catatan tersedia':'Belum lengkap'],['Catatan tidak valid',s.invalidCount||0],['Catatan','Bukan laporan laba rugi; saldo hanya berdasarkan transaksi yang tercatat. Jatah dan modal dicatat sekali antar usaha/pribadi.']];
  }
  function taxRows(){
    const t=currentTax(),m=$('month').value,p=taxSettings(),sales=DB.tx.filter(x=>!x.voided&&F.classify(x)==='sale'&&String(x.omzetTanggal||x.tanggal).slice(0,7)===m);
    return [['Rekap omzet & estimasi PPh Final UMKM',m],['Profil','Orang pribadi — hanya jika memenuhi syarat'],['Status',t.ready?'Estimasi untuk pengecekan':'BELUM LENGKAP — bukan nol pajak'],['Masalah',(t.errors||[]).join(' ')],['Peringatan',(t.warnings||[]).join(' ')],['Mulai pencatatan lengkap',p.startMonth||'Belum diatur'],['Omzet sebelum mulai',p.openingTurnover??'Belum diisi'],['Omzet bruto bulan ini',t.monthTurnover||0],['Kumulatif sebelum bulan ini',t.previousTurnover||0],['Kumulatif sampai bulan ini',t.ytdTurnover||0],['Batas omzet tahunan tidak dikenai PPh final (OP)',500000000],['Omzet kena PPh bulan ini',t.ready?t.taxableMonth:'Belum dihitung'],['Tarif',0.005],['Estimasi PPh final',t.ready?t.estimate:'Belum dihitung'],['Dipotong pihak lain sesuai bukti',t.withheld??'Belum dikonfirmasi'],['Setoran masa pajak sesuai bukti',t.paid??'Belum dikonfirmasi'],['Sisa estimasi',t.ready&&t.remaining!==null?t.remaining:'Belum dihitung'],['Bukti/rekonsiliasi',p.evidence||''],['Catatan','Bukan bukti pelaporan, pembayaran, atau file impor Coretax. Cocokkan seluruh channel dan bukti pajak.'],[],['ID','Tanggal omzet','Tanggal kas','Sumber','Omzet bruto (Rp)','Uang diterima (Rp)','Catatan'],...sales.map(x=>[x.id,x.omzetTanggal||x.tanggal,x.tanggal,[x.salesSource,x.channel].filter(Boolean).join(' / '),x.gross??'Belum diperiksa',x.jumlah,x.catatan||''])];
  }
  function consultantIssues(){
    const s=currentSummary(),issues=[];
    if(blocked)issues.unshift('Data perangkat belum dapat dipastikan. Selesaikan kendala penyimpanan sebelum membuat berkas.');
    if(s.invalidCount)issues.push('Ada catatan dengan tanggal atau nominal tidak valid. Periksa sebelum menggunakan laporan.');
    if(!currentAccounts().reserveReady)issues.push('Catatan cadangan pajak atau sumber pembayarannya belum valid. Periksa sebelum mengunduh.');
    const tx=s.tx.filter(x=>F.flows[F.classify(x)].scope!=='personal');
    if(tx.some(x=>F.classify(x)==='review'))issues.push('Ada transaksi yang belum jelas jenisnya; keterangannya tetap disertakan untuk diperiksa.');
    if(tx.some(x=>F.classify(x)==='sale'&&!F.validAmount(x.gross,true)))issues.push('Ada penjualan yang nilai sebelum potongannya belum diisi. Uang diterima tetap tercantum.');
    return issues;
  }
  function renderConsultant(){
    const issues=consultantIssues();
    $('consultantStatus').innerHTML=issues.length?'<div class="notice warning"><strong>Ada catatan yang perlu dicek</strong><details><summary>Lihat catatan</summary><ul>'+issues.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></details></div>':'<p class="hint">Berdasarkan transaksi yang tersimpan untuk bulan dipilih.</p>';
  }
  function consultantData(){
    const s=currentSummary(),cash=[],transfers=[],openings=[];
    const add=(a,b)=>{const n=a+b;if(!Number.isSafeInteger(n))throw new RangeError('Total nominal terlalu besar.');return n;};
    let incoming=0,outgoing=0;
    s.tx.slice().sort((a,b)=>a.tanggal.localeCompare(b.tanggal)||String(a.id).localeCompare(String(b.id))).forEach(x=>{
      const f=F.classify(x);if(F.flows[f].scope==='personal')return;
      if(F.isOpeningBalance(x)){openings.push(x);return;}
      if(f==='transferIn'||f==='transferOut'||f==='taxReserve'||f==='taxReturn'){transfers.push(x);return;}
      cash.push(x);
      if(!F.validAmount(x.jumlah))throw new RangeError('Ada nominal transaksi yang belum valid.');
      if(x.tipe==='in')incoming=add(incoming,x.jumlah);else if(x.tipe==='out')outgoing=add(outgoing,x.jumlah);else throw new RangeError('Arah transaksi belum valid.');
    });
    return {cash,transfers,openings,incoming,outgoing,difference:add(incoming,-outgoing),issues:consultantIssues()};
  }
  function plainCashRows(tx){
    return [['Tanggal','Jenis transaksi','Kategori','Rekening / sumber','Pemasukan (Rp)','Pengeluaran (Rp)','Penjualan sebelum potongan (Rp)','Tanggal penjualan','Keterangan'],...tx.map(x=>{
      const f=F.classify(x),note=[f==='review'?'Jenis perlu ditinjau':'',Object.hasOwn(x,'reserveAccount')?'Dibayar dari '+reserveSourceLabel(x):'',x.catatan||''].filter(Boolean).join(' · ');
      return [x.tanggal,flowLabel(x),x.kategori||'',[x.salesSource,x.channel].filter(Boolean).join(' / '),x.tipe==='in'?x.jumlah:'',x.tipe==='out'?x.jumlah:'',f==='sale'?(F.validAmount(x.gross,true)?x.gross:'Belum diisi'):'',f==='sale'?(x.omzetTanggal||x.tanggal):'',note];
    })];
  }
  function consultantRows(d){
    d=d||consultantData();
    return [['Laporan pemasukan dan pengeluaran usaha',$('month').value],['Total pemasukan (Rp)',d.incoming],['Total pengeluaran (Rp)',d.outgoing],['Selisih pemasukan dan pengeluaran (Rp)',d.difference],['Periode','Berdasarkan tanggal uang masuk / keluar. Rincian pribadi, saldo awal dan transfer sendiri tidak dihitung dalam total di atas.'],...(d.issues.length?[['Catatan pemeriksaan',d.issues.join(' ')]]:[]),[],...plainCashRows(d.cash),...(d.transfers.length?[[],['Transfer antar-rekening sendiri — tidak masuk total'],...plainCashRows(d.transfers)]:[]),...(d.openings.length?[[],['Saldo awal tercatat — bukan pemasukan'],['Tanggal','Keterangan','Jumlah (Rp)'],...d.openings.map(x=>[x.tanggal,x.catatan||flowLabel(x),x.jumlah])]:[])];
  }
  function reportSourceAvailable(){
    if(blocked){alert('Berkas belum dibuat karena data perangkat belum dapat dipastikan. Selesaikan kendala penyimpanan; jangan hapus data situs.');return false;}
    try {
      const cash=currentCash();
      if(!cash.operational.available||!cash.tax.available){alert('Berkas belum dibuat: '+cash.errors.join(' ')+' Data tidak diubah.');return false;}
      if(currentSummary().invalidCount){alert('Berkas belum dibuat: perbaiki tanggal atau nominal catatan yang tidak valid dahulu. Data tidak diubah.');return false;}
      if(!currentAccounts().reserveReady){alert('Berkas belum dibuat: '+currentAccounts().errors.join(' ')+' Data tidak diubah.');return false;}
      return true;
    } catch(error) {
      alert('Berkas belum dibuat karena catatan belum dapat dihitung dengan aman. Unduh cadangan untuk diperiksa; data tidak diubah.');return false;
    }
  }
  function exportCsv(name,rows){download(name+'-'+$('month').value+'.csv',F.csv(rows),'text/csv;charset=utf-8');}
  $('downloadCash').onclick=()=>exportCsv('kas-transaksi',txRows(currentSummary().tx));
  $('downloadSummary').onclick=()=>exportCsv('kas-ringkasan',summaryRows());
  $('downloadTax').onclick=()=>exportCsv('kas-omzet-pph',taxRows());
  $('downloadConsultant').onclick=()=>{
    if(!reportSourceAvailable())return;
    try{exportCsv('kas-konsultan',consultantRows());toast('Laporan pemasukan dan pengeluaran berhasil diunduh.');}catch(e){alert('Laporan belum dibuat: '+e.message);}
  };
  let pdfBusy=false,pdfUrl=null;
  $('printReport').onclick=async()=>{
    if(pdfBusy)return;
    if(!reportSourceAvailable())return;
    const button=$('printReport'),label=button.innerHTML;
    pdfBusy=true;button.disabled=true;button.textContent='Menyiapkan PDF...';
    $('pdfDownloadReady').classList.add('hidden');
    if(pdfUrl){URL.revokeObjectURL(pdfUrl);pdfUrl=null;}
    try{
      if(!window.KasPdf||typeof window.KasPdf.createBlob!=='function')throw new Error('Pembuat PDF belum termuat. Muat ulang halaman, lalu coba lagi.');
      const d=consultantData(),month=$('month').value;
      const pdf=await window.KasPdf.createBlob({month,monthLabel:monthName(month),incoming:d.incoming,outgoing:d.outgoing,difference:d.difference,issues:d.issues,cashRows:plainCashRows(d.cash),transferRows:d.transfers.length?plainCashRows(d.transfers):[],openingRows:d.openings.length?[['Tanggal','Keterangan','Jumlah (Rp)'],...d.openings.map(x=>[x.tanggal,x.catatan||flowLabel(x),x.jumlah])]:[]});
      if(!reportSourceAvailable())return;
      if(!pdf||pdf.type!=='application/pdf'||!pdf.size)throw new Error('File PDF belum terbentuk. Coba lagi.');
      const filename='kas-konsultan-'+month+'.pdf';
      pdfUrl=download(filename,pdf,'application/pdf',true);
      $('pdfDownloadLink').href=pdfUrl;$('pdfDownloadLink').download=filename;
      $('pdfDownloadLink').textContent='Simpan '+filename;
      $('pdfDownloadReady').classList.remove('hidden');
      toast('PDF siap. Cek folder Unduhan; jika belum muncul, ketuk tautan Simpan PDF.');
    }catch(e){alert('PDF belum dibuat: '+e.message+' Data transaksi tidak diubah.');}
    finally{pdfBusy=false;button.disabled=false;button.innerHTML=label;}
  };
  function debtValues(x){const principal=Number(x.jumlah||0)+(x.tambahan||[]).reduce((s,b)=>s+Number(b.jumlah||0),0);const historical=x.legacyPaidOpening!==undefined?Number(x.legacyPaidOpening):(!(x.bayar||[]).length&&x.status==='lunas'?Number(x.jumlah||0):0);const paid=historical+(x.bayar||[]).filter(b=>!b.voided).reduce((s,b)=>s+Number(b.jumlah||0),0);return {principal,paid,remaining:Math.max(0,principal-paid)};}
  function preserveLegacyPaid(debt){if(debt.legacyPaidOpening===undefined&&!(debt.bayar||[]).length&&debt.status==='lunas')debt.legacyPaidOpening=Number(debt.jumlah||0);}
  function renderDebts(){
    const debts=DB.pi.filter(x=>x&&x.tipe==='utang').map((x,index)=>({x,index,v:debtValues(x)}));
    // Sort only the view: retain source order and all existing payment records.
    debts.sort((a,b)=>Number(b.v.remaining>0)-Number(a.v.remaining>0)||a.index-b.index);
    $('debtList').innerHTML=debts.length?debts.map(({x,v})=>{
      const unpaid=v.remaining>0;
      return '<div class="transaction debt-card '+(unpaid?'debt-unpaid':'debt-paid')+'">'+
        '<div class="debt-head"><strong>'+esc(x.nama)+'</strong><span class="debt-status">'+(unpaid?'Belum lunas':'Lunas')+'</span></div>'+
        (unpaid&&v.paid>0?'<p class="debt-progress">Sudah dibayar sebagian</p>':'')+
        '<p>'+esc(x.catatan||'')+'</p>'+line('Pokok / sudah dibayar',rupiah(v.principal)+' / '+rupiah(v.paid))+line('Sisa utang',v.remaining,unpaid?'debt-remaining':'positive')+
        '<p>Jatuh tempo: '+esc(x.tempo||'Belum ditentukan')+'</p>'+
        (unpaid?'<button class="debt-pay" data-pay="'+esc(x.id)+'">Bayar utang</button>':'')+
        '<details><summary>Riwayat pembayaran & tambahan</summary>'+[...(x.tambahan||[]).map(b=>'<p>Tambahan '+esc(b.tanggal)+' · '+esc(rupiah(b.jumlah))+' · '+esc(b.catatan||'')+'</p>'),...(x.bayar||[]).map(b=>'<p>'+esc(b.voided?'Dibatalkan':'Bayar')+' '+esc(b.tanggal)+' · '+esc(rupiah(b.jumlah))+'</p>')].join('')+'</details>'+
        '<details><summary>Kelola '+esc(x.nama)+'</summary><div class="actions"><button data-debt-edit="'+esc(x.id)+'">Edit pokok / catatan</button><button data-debt-add="'+esc(x.id)+'">Tambah utang ke orang ini</button></div></details></div>';
    }).join(''):'<p class="empty">Belum ada utang tercatat.</p>';
    $('legacyReceivables').innerHTML=DB.pi.filter(x=>x&&x.tipe!=='utang').map(x=>{const v=debtValues(x);return '<div class="transaction"><strong>'+esc(x.nama)+'</strong><p>'+esc(x.catatan||'')+'</p>'+line('Sisa tercatat',v.remaining)+'</div>';}).join('')||'<p class="hint">Tidak ada catatan piutang lama.</p>';
  }
  function resetDebt(){ $('debtForm').reset();$('debtEditId').value='';$('debtMode').value='';$('debtName').readOnly=false;$('debtDate').value=defaultDate();$('debtFormTitle').textContent='Tambah utang';$('debtAmountLabel').firstChild.textContent='Pokok utang (Rp)';$('debtSave').textContent='Tambah catatan utang';$('debtCancel').classList.add('hidden'); }
  function editDebt(id,mode){
    const d=DB.pi.find(x=>x&&x.id===id);if(!d)return;
    resetDebt();$('debtEditor').open=true;$('debtEditId').value=id;$('debtMode').value=mode;$('debtName').value=d.nama;$('debtName').readOnly=mode==='add';$('debtDue').value=d.tempo||'';$('debtCancel').classList.remove('hidden');
    if(mode==='add'){$('debtFormTitle').textContent='Tambah utang ke '+d.nama;$('debtAmountLabel').firstChild.textContent='Tambahan utang (Rp)';$('debtSave').textContent='Simpan tambahan utang';}
    else{$('debtFormTitle').textContent='Edit catatan utang';setMoney('debtAmount',d.jumlah);$('debtDate').value=d.tanggal||defaultDate();$('debtNote').value=d.catatan||'';$('debtSave').textContent='Simpan perubahan utang';}
    go('debts');$('debtEditor').scrollIntoView?.({behavior:'smooth',block:'start'});
  }
  $('debtCancel').onclick=resetDebt;
  $('debtForm').addEventListener('submit',e=>{
    e.preventDefault();const amount=parseMoney('debtAmount'),id=$('debtEditId').value,mode=$('debtMode').value,date=$('debtDate').value,d=id?DB.pi.find(x=>x&&x.id===id):null;
    if(!amount||!F.validDate(date)||!$('debtName').value.trim())return alert('Isi nama, tanggal, dan jumlah yang valid.');
    if(id&&!d)return alert('Catatan utang tidak ditemukan.');
    if(d&&mode!=='add'&&amount+(d.tambahan||[]).reduce((s,b)=>s+Number(b.jumlah||0),0)<debtValues(d).paid)return alert('Pokok ditambah tambahan utang tidak boleh lebih kecil dari pembayaran yang sudah tercatat.');
    const ok=mutate(next=>{
      if(d){
        next.history=next.history||[];next.history.push({type:'debtEdit',at:new Date().toISOString(),record:clone(d)});
        const edited=next.pi.find(x=>x.id===id);preserveLegacyPaid(edited);
        if(mode==='add'){edited.tambahan=edited.tambahan||[];edited.tambahan.push({id:uid(),tanggal:date,jumlah:amount,catatan:$('debtNote').value.trim()});if($('debtDue').value)edited.tempo=$('debtDue').value;}
        else Object.assign(edited,{nama:$('debtName').value.trim(),jumlah:amount,tanggal:date,tempo:$('debtDue').value,catatan:$('debtNote').value.trim()});
      }else next.pi.push({id:uid(),tipe:'utang',nama:$('debtName').value.trim(),jumlah:amount,tanggal:date,tempo:$('debtDue').value,catatan:$('debtNote').value.trim(),bayar:[],tambahan:[],status:'belum'});
    },'Catatan utang tersimpan. Kas tidak diubah.');
    if(ok)resetDebt();
  });
  function openPayment(id){const debt=DB.pi.find(x=>x.id===id);if(!debt)return;payId=id;const v=debtValues(debt);$('paymentTitle').textContent=debt.nama+' · sisa '+rupiah(v.remaining);setMoney('paymentAmount',v.remaining);$('paymentDate').value=defaultDate();$('paymentDialog').showModal();}
  $('cancelPayment').onclick=()=>$('paymentDialog').close();
  $('paymentForm').addEventListener('submit',e=>{e.preventDefault();const debt=DB.pi.find(x=>x.id===payId),amount=parseMoney('paymentAmount');if(!debt||!amount||amount>debtValues(debt).remaining||!F.validDate($('paymentDate').value))return alert('Periksa tanggal dan jumlah; tidak boleh melebihi sisa utang.');const pid=uid(),tid=uid(),date=$('paymentDate').value,channel=$('paymentChannel').value.trim();if(mutate(next=>{const d=next.pi.find(x=>x.id===payId);preserveLegacyPaid(d);d.bayar=d.bayar||[];d.bayar.push({id:pid,txId:tid,tanggal:date,jumlah:amount,channel});next.tx.push({id:tid,debtId:payId,paymentId:pid,tanggal:date,tipe:'out',flow:'debtPayment',kategori:'Bayar Utang',jumlah:amount,channel,catatan:'Bayar pokok utang: '+d.nama});},'Pembayaran dan kas keluar tersimpan sekali.'))$('paymentDialog').close();});
  $('backup').onclick=backup;$('quickBackup').onclick=backup;
  $('exportDashboard').onclick=()=>{
    const result=window.KasCompat.dashboardExport(DB.tx,$('month').value,F);
    if(result.errors.length)return alert('Ekspor belum dibuat. '+result.errors.join(' '));
    if(!confirm('Ekspor Dashboard untuk '+monthName($('month').value)+'?\n'+result.warnings.join('\n')+'\nFile ini bukan cadangan lengkap.'))return;
    download('kas-dashboard-'+$('month').value+'.json',JSON.stringify(result.data,null,2));
  };
  $('importCSV').addEventListener('change',async e=>{
    const file=e.target.files[0];e.target.value='';if(!file)return;
    try{
      const result=window.KasCompat.importCSV(await file.text(),DB.tx,F);
      if(result.errors.length)return alert('Impor dibatalkan; data tidak diubah. '+result.errors.join(' '));
      if(!result.records.length)return alert('Tidak ada transaksi baru. '+result.skipped+' catatan yang sudah ada dilewati.');
      if(!confirm('Tambahkan '+result.records.length+' transaksi? '+result.skipped+' catatan yang sudah ada dilewati.\n'+result.warnings.join('\n')))return;
      if(!backup())return;
      mutate(next=>{next.tx.push(...result.records);},'CSV ditambahkan tanpa mengganti data lama.');
    }catch(err){alert('CSV tidak dapat dibaca. Data tidak diubah.');}
  });
  $('originalBackup').onclick=()=>{try{const original=storage.getItem(KEY+'_before_v5');if(!original)return alert('Cadangan sebelum v5 dibuat saat perubahan pertama. Data yang belum diubah tetap tersimpan seperti semula.');download('kas-sebelum-v5.json',original);}catch(e){alert('Cadangan belum dapat dibaca.');}};
  $('restore').addEventListener('change',async e=>{
    const file=e.target.files[0];e.target.value='';if(!file)return;
    try{
      const data=JSON.parse(await file.text());
      if(data.version==='kas-sync'||data.state)return alert('Ini file ekspor, bukan cadangan lengkap. Gunakan Backup JSON dari HP asal supaya data pribadi, Shopee, dan rincian utang tidak tertinggal. Data sekarang tidak diubah.');
      const errors=S.validateData(data);if(errors.length)return alert('Cadangan tidak valid: '+errors.join(' '));
      if(!confirm('Pulihkan '+data.tx.length+' transaksi dan '+data.pi.length+' catatan utang/piutang? Data perangkat ini akan diganti. Cadangan data saat ini akan diunduh lebih dulu.'))return;
      if(!backup())return;if(commit(clone(data),'Cadangan dipulihkan.')){resetForm();resetDebt();fillTaxSettings();}
    }catch(err){alert('File tidak dapat dibaca. Data tidak diubah.');}
  });
  document.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.view)go(b.dataset.view);if(b.dataset.go)go(b.dataset.go);
    if(b.dataset.edit)editTransaction(b.dataset.edit);if(b.dataset.void)toggleVoid(b.dataset.void,false);if(b.dataset.restoreTx)toggleVoid(b.dataset.restoreTx,true);if(b.dataset.pay)openPayment(b.dataset.pay);
    if(b.dataset.debtEdit)editDebt(b.dataset.debtEdit,'edit');if(b.dataset.debtAdd)editDebt(b.dataset.debtAdd,'add');
    if(b.dataset.newFlow)beginEntry(b.dataset.newFlow);
    if(b.dataset.accountHistory)showAccountHistory(b.dataset.accountHistory);
    if(b.dataset.businessHistory)showHistory('business');
    if(b.dataset.entryDirection)beginEntry(b.dataset.entryDirection==='in'?'sale':'expense');
    if(b.hasAttribute('data-review'))showHistory('reviewAll');
  });
  function showHistory(filter){$('txFilter').value=filter;$('searchTx').value='';go('transactions');$('entryHistory').open=true;renderTransactions();$('entryHistory').scrollIntoView?.({behavior:'smooth',block:'start'});}
  $('showHistory').onclick=()=>showHistory('all');
  $('reviewOld').onclick=()=>showHistory('reviewAll');
  $('openTax').onclick=()=>{go('reports');$('reportMore').open=true;$('taxSettings').open=true;$('reportMore').scrollIntoView?.({behavior:'smooth',block:'start'});};
  $('grossDate').addEventListener('invalid',()=>{$('saleFields').open=true;$('saleDateDetails').open=true;});
  $('flow').addEventListener('invalid',()=>{$('advancedKinds').open=true;});
  $('entryKind').onchange=selectSimpleKind;
  $('startTransfer').onclick=()=>beginEntry($('transferRoute').value);
  $('showBalanceDetails').onclick=()=>{renderBalanceDetails();go('balanceDetails');};
  $('balanceDetailAccount').onchange=renderBalanceDetails;
  $('expenseAccount').onchange=()=>{
    const personal=$('expenseAccount').value==='personal';
    $('flow').value=personal?'personalExpense':'expense';$('category').value='';
    if(['BCA Operasional','Rekening Pribadi'].includes($('channel').value))$('channel').value=personal?'Rekening Pribadi':'BCA Operasional';
    flowChanged();syncPicker();
  };
  $('taxPaySource').onchange=()=>{if(['BCA Operasional','Rekening Pajak'].includes($('channel').value))$('channel').value=$('taxPaySource').value==='tax'?'Rekening Pajak':'BCA Operasional';};
  $('flow').onchange=()=>{flowChanged();syncPicker($('editId').value?DB.tx.find(t=>t.id===$('editId').value):null);};$('cancelEdit').onclick=resetForm;$('amount').addEventListener('input',renderSplitPreview);
  $('sameGross').onclick=()=>{const n=parseMoney('amount');if(n===null)return alert('Isi uang diterima terlebih dahulu.');setMoney('gross',n);};
  $('date').onchange=()=>{if(!$('editId').value&&$('grossDate').value===previousCashDate)$('grossDate').value=$('date').value;previousCashDate=$('date').value;entryGuidance();};
  $('searchTx').oninput=renderTransactions;$('txFilter').onchange=renderTransactions;
  $('month').onchange=()=>{if(!F.validMonth($('month').value)){$('month').value=localDate().slice(0,7);}if(!$('editId').value&&!$('amount').value&&!$('gross').value&&!$('category').value&&!$('note').value&&$('grossDate').value===previousCashDate&&$('date').value===previousCashDate){$('date').value=defaultDate();$('grossDate').value=defaultDate();previousCashDate=$('date').value;}render();fillTaxSettings();};
  window.addEventListener('storage',e=>{if(e.key===KEY&&e.newValue!==raw){blocked=true;notice('Data berubah di tab lain. Form di sini belum dibuang. Unduh cadangan jika perlu, lalu buka ulang halaman sebelum melanjutkan.',true);renderAccounts();renderBalanceDetails();entryGuidance();}});
  document.querySelectorAll('input[inputmode="numeric"]').forEach(el=>el.addEventListener('blur',()=>{const n=parseMoney(el.id);if(n!==null)setMoney(el.id,n);}));
  resetForm();$('debtDate').value=localDate();fillTaxSettings();render();
  notice(loaded.error||'Tersimpan di perangkat ini · belum sinkron antar-perangkat',!!loaded.error);
})();
