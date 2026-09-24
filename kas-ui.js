(function () {
  'use strict';
  const F = window.KasFinance, S = window.KasStorage, B = window.KasBuckets, KEY = 'soldier_kas_v2';
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
  function notice(message,error) { $('storageNotice').textContent = message; $('storageNotice').className = 'notice'+(error?' error':''); }
  function toast(message) { $('toast').textContent=message; $('toast').style.display='block'; clearTimeout(toastTimer); toastTimer=setTimeout(()=>{$('toast').style.display='none';},4200); }
  function download(name,content,type) { const b=new Blob([content],{type:type||'application/json'}), u=URL.createObjectURL(b), a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),10000); }
  function backup() { if(loaded.error&&loaded.raw===null){alert('Data browser belum dapat dibaca. Tidak ada cadangan kosong yang dibuat. Jangan hapus data situs.');return false;}download('kas-command-backup-'+localDate()+'.json',loaded.error ? loaded.raw : JSON.stringify(DB,null,2));return true; }
  function commit(next,message) {
    if(blocked) { notice('Perubahan belum disimpan. Unduh cadangan lalu buka ulang halaman ini. '+(loaded.error||'Data berubah di tab lain.'),true);return false; }
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
    $('moreMenu').classList.toggle('active',['owner','debts','settings'].includes(view));
    if(view==='reports')fillTaxSettings();
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function monthName(m) { return new Date(m+'-01T12:00:00').toLocaleDateString('id-ID',{month:'long',year:'numeric'}); }
  function currentSummary() { return F.summary(DB.tx,$('month').value); }
  function currentSplit() { return B.summary(DB.tx,$('month').value,F); }
  function splitPolicy() { return B.policy(DB.kasSettings||{}); }
  function taxSettings() {
    const m=$('month').value,y=m.slice(0,4), p=DB.kasSettings||{}, yearly=(p.taxYears||{})[y]||{}, monthly=(p.taxMonths||{})[m]||{};
    return {...yearly,...monthly,complete:monthly.complete===true};
  }
  function currentTax() { return F.tax(DB.tx,$('month').value,taxSettings()); }
  const line = (a,b,c='') => '<div class="label-value '+c+'"><span>'+esc(a)+'</span><strong>'+esc(typeof b==='number'?rupiah(b):b)+'</strong></div>';
  const flowLabel = t => (F.flows[F.classify(t)]||F.flows.review).label;
  function needsReview(t) { return F.classify(t)==='review' || (F.classify(t)==='sale' && !Number.isSafeInteger(t.gross)) || (F.classify(t)==='businessIncome' && t.taxTreatment!=='nonOmzet'); }
  function cashAppearance(t) {
    const f=F.classify(t),meta=F.flows[f];
    if(t.voided)return {direction:'neutral',label:'Dibatalkan',sign:'',color:''};
    if(F.isOpeningBalance(t))return {direction:'neutral',label:'Saldo awal',sign:'',color:''};
    if(f==='review')return {direction:'neutral',label:'Perlu ditinjau',sign:'',color:''};
    if(meta.scope==='neutral')return {direction:'neutral',label:'Transfer sendiri',sign:'',color:''};
    return t.tipe==='in'?{direction:'in',label:'Masuk'+(meta.scope==='personal'?' · pribadi':' · usaha'),sign:'+',color:'positive'}:{direction:'out',label:'Keluar'+(meta.scope==='personal'?' · pribadi':' · usaha'),sign:'−',color:'negative'};
  }
  function rowsHTML(tx,actions=true) {
    if(!tx.length)return '<p class="empty">Belum ada transaksi untuk pilihan ini.</p>';
    return tx.slice().sort((a,b)=>String(b.tanggal).localeCompare(String(a.tanggal))).map(t=>{
      const a=cashAppearance(t);
      return '<div class="transaction cash-'+a.direction+'"><span class="cash-direction">'+esc(a.label)+'</span><div class="transaction-head"><strong>'+esc(flowLabel(t))+(!t.voided&&needsReview(t)?'<span class="badge">Tinjau</span>':'')+'</strong><strong class="'+a.color+'">'+a.sign+esc(rupiah(t.jumlah))+'</strong></div><p>'+esc([t.tanggal,t.kategori,t.channel].filter(Boolean).join(' · '))+'</p><p>'+esc(t.catatan||'')+'</p>'+(F.classify(t)==='sale'?'<p>Omzet bruto: '+esc(t.gross==null?'Belum diperiksa':rupiah(t.gross))+' · tanggal omzet '+esc(t.omzetTanggal||t.tanggal)+'</p>':'')+(actions?'<div class="row-actions">'+(t.voided?'<button data-restore-tx="'+esc(t.id)+'">Aktifkan lagi</button>':'<button data-edit="'+esc(t.id)+'">Edit</button><button class="danger" data-void="'+esc(t.id)+'">Batalkan</button>')+'</div>':'')+'</div>';
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
      return !q || [t.kategori,t.channel,t.catatan,flowLabel(t)].join(' ').toLowerCase().includes(q);
    });
    $('transactionList').innerHTML=rowsHTML(tx);
  }
  function render() {
    const m=$('month').value,s=currentSummary(),t=s.totals, tax=currentTax(),budget=((DB.kasSettings||{}).ownerBudgets||{})[m]||0,b=currentSplit();
    $('periodLabel').textContent=monthName(m);$('reportTitle').textContent='Laporan '+monthName(m);
    $('dashboardStats').innerHTML=[
      ['Saldo usaha',s.cashBusinessClosing,'Berdasarkan catatan · bukan laba',''],
      ['Untuk usaha',b.ready?b.businessAfterReserve:null,'Setelah menyisihkan jatah pribadi',b.ready&&b.businessAfterReserve<0?'negative':'positive'],
      ['Jatah pribadi belum diambil',b.ready?b.remainingPersonal:null,'Masih di dalam saldo usaha','']
    ].map(x=>'<div class="stat"><span>'+x[0]+'</span><strong class="'+x[3]+'">'+esc(x[1]===null?'Belum pasti':rupiah(x[1]))+'</strong><small>'+x[2]+'</small></div>').join('');
    renderSplit(b);
    $('businessSummary').innerHTML=line('Saldo awal tercatat',s.cashBusinessOpening)+line('Kas masuk usaha',s.businessIn,'positive')+line('Kas keluar usaha',s.businessOut,'negative')+line('Saldo akhir tercatat',s.cashBusinessClosing,'total');
    $('personalSummary').innerHTML=line('Saldo awal tercatat',s.cashPersonalOpening)+line('Masuk pribadi, termasuk jatah',s.personalIn,'positive')+line('Keluar pribadi, termasuk modal',s.personalOut,'negative')+line('Saldo akhir tercatat',s.cashPersonalClosing,'total');
    const review=s.tx.filter(needsReview).length;
    $('reviewNotice').innerHTML=review||s.invalidCount||!s.balancesComplete?'<div class="notice warning">Ada catatan yang perlu dicek. Saldo / laporan belum lengkap. <button data-review>Cek catatan</button><details><summary>Lihat penyebab</summary>'+review+' transaksi bulan ini perlu peninjauan'+(s.invalidCount?' · '+s.invalidCount+' catatan tidak valid':'')+(s.balanceUnresolvedCount?' · '+s.balanceUnresolvedCount+' transaksi sampai bulan ini belum jelas jenisnya':'')+'.</details></div>':'';
    $('recentList').innerHTML=rowsHTML(s.tx.slice().sort((a,b)=>b.tanggal.localeCompare(a.tanggal)).slice(0,5),false);
    $('ownerSummary').innerHTML=line('Rencana bulan ini',budget)+line('Sudah diambil',t.ownerDraw||0)+line('Sisa rencana',Math.max(0,budget-(t.ownerDraw||0)))+((t.ownerDraw||0)>budget?'<p class="hint">Pengambilan melebihi rencana sebesar '+esc(rupiah((t.ownerDraw||0)-budget))+'.</p>':'');
    if(document.activeElement!==$('ownerBudget'))setMoney('ownerBudget',budget);
    $('ownerList').innerHTML=rowsHTML(s.tx.filter(x=>F.classify(x)==='ownerDraw'));
    renderTransactions();renderTax(tax);renderConsultant();renderDebts();
  }
  function renderSplit(b) {
    const p=splitPolicy(), title=!p.valid?'Pengaturan pembagian perlu diperiksa':p.enabled?(100-p.personalPercent)+'% usaha · '+p.personalPercent+'% pribadi':'Pembagian baru dijeda';
    const problem=!b.ready?'<p class="notice warning">Pembagian belum dapat dipastikan. '+esc(b.errors.join(' '))+'</p>':
      (b.businessAfterReserve<0?'<p class="notice warning">Saldo usaha tidak cukup untuk seluruh jatah yang disisihkan. Jangan transfer sebelum kebutuhan usaha diperiksa.</p>':'')+
      (b.overdraw>0?'<p class="notice warning">Pengambilan pribadi melebihi hasil pembagian sebesar '+esc(rupiah(b.overdraw))+'.</p>':'');
    $('splitSummary').innerHTML='<p><strong>'+esc(title)+'</strong> <button data-view="owner" class="text-button">Lihat jatah</button></p><p class="hint">Hanya penjualan baru yang dicatat. Data lama tidak dibagi ulang. Ini pembagian rencana, bukan transfer bank atau jaminan aman untuk diambil.</p>'+problem;
    $('ownerSplitSummary').innerHTML='<h3>'+esc(title)+'</h3>'+problem+(b.ready?
      line('Jatah dari penjualan bulan ini',b.monthPersonal)+line('Sudah diambil bulan ini (terhubung)',b.monthDrawn)+line('Jatah belum diambil, termasuk sisa bulan lalu',b.remainingPersonal,'total')+
      '<p class="hint">Sisa jatah dibawa ke bulan berikutnya. Pengambilan baru yang dicatat mengurangi jatah ini. Catatan lama tetap ada di riwayat, tidak dihitung ulang dalam pembagian.</p>':'')+
      '<p class="hint">Tetap sisihkan kebutuhan bahan, upah, utang, pajak, dan cadangan sebelum transfer. Angka di atas hanya berdasarkan catatan yang tersedia.</p>';
    if(document.activeElement!==$('splitPercent')&&document.activeElement!==$('splitEnabled')){
      $('splitPercent').value=p.valid?p.personalPercent:'';$('splitEnabled').checked=p.valid&&p.enabled;
    }
    renderSplitPreview();
  }
  function renderSplitPreview() {
    const f=$('flow').value,id=$('editId').value,old=id?DB.tx.find(t=>t.id===id):null,amount=parseMoney('amount'),el=$('splitPreview');
    el.classList.toggle('hidden',f!=='sale');if(f!=='sale')return;
    try {
      const sample=B.stamp({id:id||'preview',flow:f,tipe:'in',jumlah:amount||0,tanggal:$('date').value},old,DB.kasSettings||{},F),mark=sample.incomeSplit;
      if(!mark){el.textContent=old?'Transaksi lama ini tidak dibagi ulang.':'Pembagian otomatis dijeda. Penjualan tetap dicatat utuh.';return;}
      if(amount===null||amount<=0){el.textContent=(100-mark.personalPercent)+'% untuk usaha · '+mark.personalPercent+'% untuk pribadi, dari uang yang benar-benar diterima.';return;}
      const v=B.split(amount,mark.personalPercent);
      el.innerHTML='<strong>Usaha '+esc(rupiah(v.business))+' · Pribadi '+esc(rupiah(v.personal))+'</strong><br>Disisihkan otomatis, belum ditransfer. Omzet pajak tetap utuh.';
    } catch(error) {el.textContent='Pembagian belum siap: '+error.message;}
  }
  function renderTax(tax) {
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
    personalExpense:'Belanja dari uang yang sudah dipisahkan ke pribadi. Jika mengambil langsung dari rekening usaha, pilih Ambil jatah saya dari usaha agar saldo usaha ikut berkurang.',
    capital:'Pindahkan uang pribadi menjadi modal usaha. Dicatat sekali: pribadi berkurang, usaha bertambah.',
    ownerDraw:'Uang usaha yang kamu ambil untuk diri sendiri. Dicatat sekali: usaha berkurang, pribadi bertambah.',
    loan:'Uang pinjaman yang diterima usaha, bukan penjualan. Catatan kewajibannya dibuat di menu Utang.',
    debtPayment:'Pembayaran pokok utang, bukan biaya usaha. Untuk utang yang ada di menu Utang, gunakan tombol Bayar di sana agar saldonya ikut berkurang.',
    taxPayment:'Kas yang benar-benar keluar untuk pajak. Catat masa pajak dan nomor bukti di catatan; isi rekonsiliasi di Laporan bulanan.',
    businessIncome:'Penerimaan usaha selain penjualan. Pastikan perlakuan omzetnya sebelum menggunakan estimasi pajak.',
    transferIn:'Riwayat transfer masuk antar-rekening milik sendiri dalam lingkup yang sama (usaha ke usaha, atau pribadi ke pribadi). Tidak menambah total kas atau omzet.',
    transferOut:'Riwayat transfer keluar antar-rekening milik sendiri dalam lingkup yang sama. Tidak mengurangi total kas. Untuk usaha ke pribadi gunakan Jatah saya.'
  };
  function flowChanged() {
    const f=$('flow').value,isSale=f==='sale';
    const a=cashAppearance({flow:f,tipe:F.flows[f]?.tipe});
    $('transactionForm').dataset.direction=a.direction;
    $('flowIndicator').textContent=a.label;
    $('flowHelp').textContent=descriptions[f]||'Pilih jenis yang sesuai dengan transaksi aslinya.';
    $('saleFields').classList.toggle('hidden',!isSale);$('gross').required=isSale;$('grossDate').required=isSale;
    $('otherIncomeFields').classList.toggle('hidden',f!=='businessIncome');
    $('amountLabel').firstChild.textContent=(F.flows[f]&&F.flows[f].tipe==='out'?'Uang keluar (Rp)':'Uang masuk (Rp)');
    renderSplitPreview();
  }
  function resetForm() {
    $('transactionForm').reset();$('editId').value='';$('date').value=defaultDate();$('grossDate').value=defaultDate();
    previousCashDate=$('date').value;
    $('editNotice').classList.add('hidden');$('cancelEdit').classList.add('hidden');$('saveTransaction').textContent='Simpan transaksi';
    $('channel').value='BCA Operasional';flowChanged();
    $('extraFields').open=false;$('saleDateDetails').open=false;
  }
  function beginEntry(flow,category=''){
    const drafted=$('editId').value||$('amount').value||$('gross').value||$('category').value||$('note').value||$('channel').value!=='BCA Operasional'||$('date').value!==defaultDate()||$('grossDate').value!==defaultDate();
    if(drafted&&!confirm('Ada isian yang belum disimpan. Mulai catatan baru dan tinggalkan isian itu?'))return;
    resetForm();$('flow').value=flow;$('category').value=category;flowChanged();go('transactions');
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
    flowChanged();go('transactions');
  }
  $('transactionForm').addEventListener('submit',e=>{
    e.preventDefault();const f=$('flow').value,amount=parseMoney('amount'),gross=parseMoney('gross'),id=$('editId').value;
    if(!F.flows[f]||amount===null||amount<=0){alert('Pilih jenis dan isi jumlah rupiah bulat lebih dari 0. Gunakan titik untuk pemisah ribuan.');return;}
    if(!F.validDate($('date').value)){alert('Tanggal belum valid.');return;}
    if(f==='sale'&&(gross===null||gross<0||!F.validDate($('grossDate').value))){alert('Isi omzet bruto dan tanggal omzet yang benar.');return;}
    const old=id?DB.tx.find(x=>x.id===id):null;if(id&&!old){alert('Transaksi tidak ditemukan. Buka ulang halaman.');return;}
    let record={...(old||{}),id:id||uid(),tipe:F.flows[f].tipe,flow:f,jumlah:amount,kategori:$('category').value.trim()||F.flows[f].label,channel:$('channel').value.trim()||'Tidak disebutkan',tanggal:$('date').value,catatan:$('note').value.trim(),updatedAt:new Date().toISOString()};
    if(f==='sale'){record.gross=gross;record.omzetTanggal=$('grossDate').value;}else{delete record.gross;delete record.omzetTanggal;}
    if(f==='businessIncome')record.taxTreatment=$('otherTax').value;else delete record.taxTreatment;
    try {record=B.stamp(record,old,DB.kasSettings||{},F);}catch(error){alert('Belum disimpan: '+error.message);return;}
    if(f==='ownerDraw'&&record.incomeSplit){
      const before=B.summary(DB.tx.filter(t=>(!old||t.id!==old.id)&&(!F.validDate(t.tanggal)||t.tanggal<=record.tanggal)),record.tanggal.slice(0,7),F);
      if(!before.ready){if(!confirm('Saldo atau pembagian belum lengkap. Catat hanya jika uang ini benar-benar sudah diambil. Tetap simpan pengambilan nyata ini?'))return;}
      else if(amount>Math.min(Math.max(0,before.cashBusinessClosing),before.remainingPersonal)){
        if(!confirm('Jumlah ini melebihi jatah belum diambil atau saldo tercatat. Jangan memakai uang operasional untuk rencana pribadi. Jika transfer sudah benar-benar terjadi, catat agar saldo sesuai. Tetap simpan?'))return;
      }
    }
    const ok=mutate(next=>{if(old){next.history=next.history||[];next.history.push({type:'edit',at:new Date().toISOString(),record:clone(old)});next.tx[next.tx.findIndex(x=>x.id===id)]=record;}else next.tx.push(record);},'Transaksi tersimpan.');
    if(ok){resetForm();if(record.tanggal.slice(0,7)!==$('month').value){$('month').value=record.tanggal.slice(0,7);render();}}
  });
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
  function txRows(tx){return [['ID','Tanggal kas','Jenis','Masuk/Keluar','Kategori','Rekening/Sumber','Jumlah kas (Rp)','Omzet bruto (Rp)','Tanggal omzet','Status tinjauan','Catatan'],...tx.map(t=>[t.id,t.tanggal,flowLabel(t),t.tipe==='in'?'Masuk':'Keluar',t.kategori||'',t.channel||'',t.jumlah,F.classify(t)==='sale'?(t.gross??'Belum diperiksa'):'',F.classify(t)==='sale'?(t.omzetTanggal||t.tanggal):'',needsReview(t)?'Perlu ditinjau':'',t.catatan||''])];}
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
    return [['Rekap omzet & estimasi PPh Final UMKM',m],['Profil','Orang pribadi — hanya jika memenuhi syarat'],['Status',t.ready?'Estimasi untuk pengecekan':'BELUM LENGKAP — bukan nol pajak'],['Masalah',(t.errors||[]).join(' ')],['Peringatan',(t.warnings||[]).join(' ')],['Mulai pencatatan lengkap',p.startMonth||'Belum diatur'],['Omzet sebelum mulai',p.openingTurnover??'Belum diisi'],['Omzet bruto bulan ini',t.monthTurnover||0],['Kumulatif sebelum bulan ini',t.previousTurnover||0],['Kumulatif sampai bulan ini',t.ytdTurnover||0],['Batas omzet tahunan tidak dikenai PPh final (OP)',500000000],['Omzet kena PPh bulan ini',t.ready?t.taxableMonth:'Belum dihitung'],['Tarif',0.005],['Estimasi PPh final',t.ready?t.estimate:'Belum dihitung'],['Dipotong pihak lain sesuai bukti',t.withheld??'Belum dikonfirmasi'],['Setoran masa pajak sesuai bukti',t.paid??'Belum dikonfirmasi'],['Sisa estimasi',t.ready&&t.remaining!==null?t.remaining:'Belum dihitung'],['Bukti/rekonsiliasi',p.evidence||''],['Catatan','Bukan bukti pelaporan, pembayaran, atau file impor Coretax. Cocokkan seluruh channel dan bukti pajak.'],[],['ID','Tanggal omzet','Tanggal kas','Sumber','Omzet bruto (Rp)','Uang diterima (Rp)','Catatan'],...sales.map(x=>[x.id,x.omzetTanggal||x.tanggal,x.tanggal,x.channel,x.gross??'Belum diperiksa',x.jumlah,x.catatan||''])];
  }
  function consultantIssues(){
    const s=currentSummary(),issues=[];
    if(blocked)issues.unshift('Data perangkat belum dapat dipastikan. Selesaikan kendala penyimpanan sebelum membuat berkas.');
    if(s.invalidCount)issues.push('Ada catatan dengan tanggal atau nominal tidak valid. Periksa sebelum menggunakan laporan.');
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
      if(f==='transferIn'||f==='transferOut'){transfers.push(x);return;}
      cash.push(x);
      if(!F.validAmount(x.jumlah))throw new RangeError('Ada nominal transaksi yang belum valid.');
      if(x.tipe==='in')incoming=add(incoming,x.jumlah);else if(x.tipe==='out')outgoing=add(outgoing,x.jumlah);else throw new RangeError('Arah transaksi belum valid.');
    });
    return {cash,transfers,openings,incoming,outgoing,difference:add(incoming,-outgoing),issues:consultantIssues()};
  }
  function plainCashRows(tx){
    return [['Tanggal','Jenis transaksi','Kategori','Rekening / sumber','Pemasukan (Rp)','Pengeluaran (Rp)','Penjualan sebelum potongan (Rp)','Tanggal penjualan','Keterangan'],...tx.map(x=>{
      const f=F.classify(x),note=[f==='review'?'Jenis perlu ditinjau':'',x.catatan||''].filter(Boolean).join(' · ');
      return [x.tanggal,flowLabel(x),x.kategori||'',x.channel||'',x.tipe==='in'?x.jumlah:'',x.tipe==='out'?x.jumlah:'',f==='sale'?(F.validAmount(x.gross,true)?x.gross:'Belum diisi'):'',f==='sale'?(x.omzetTanggal||x.tanggal):'',note];
    })];
  }
  function consultantRows(d){
    d=d||consultantData();
    return [['Laporan pemasukan dan pengeluaran usaha',$('month').value],['Total pemasukan (Rp)',d.incoming],['Total pengeluaran (Rp)',d.outgoing],['Selisih pemasukan dan pengeluaran (Rp)',d.difference],['Periode','Berdasarkan tanggal uang masuk / keluar. Rincian pribadi, saldo awal dan transfer sendiri tidak dihitung dalam total di atas.'],...(d.issues.length?[['Catatan pemeriksaan',d.issues.join(' ')]]:[]),[],...plainCashRows(d.cash),...(d.transfers.length?[[],['Transfer antar-rekening sendiri — tidak masuk total'],...plainCashRows(d.transfers)]:[]),...(d.openings.length?[[],['Saldo awal tercatat — bukan pemasukan'],['Tanggal','Keterangan','Jumlah (Rp)'],...d.openings.map(x=>[x.tanggal,x.catatan||flowLabel(x),x.jumlah])]:[])];
  }
  function reportSourceAvailable(){
    if(blocked){alert('Berkas belum dibuat karena data perangkat belum dapat dipastikan. Selesaikan kendala penyimpanan; jangan hapus data situs.');return false;}
    if(currentSummary().invalidCount){alert('Berkas belum dibuat: perbaiki tanggal atau nominal catatan yang tidak valid dahulu. Data tidak diubah.');return false;}
    return true;
  }
  function exportCsv(name,rows){download(name+'-'+$('month').value+'.csv',F.csv(rows),'text/csv;charset=utf-8');}
  $('downloadCash').onclick=()=>exportCsv('kas-transaksi',txRows(currentSummary().tx));
  $('downloadSummary').onclick=()=>exportCsv('kas-ringkasan',summaryRows());
  $('downloadTax').onclick=()=>exportCsv('kas-omzet-pph',taxRows());
  $('downloadConsultant').onclick=()=>{
    if(!reportSourceAvailable())return;
    try{exportCsv('kas-konsultan',consultantRows());toast('Laporan pemasukan dan pengeluaran berhasil diunduh.');}catch(e){alert('Laporan belum dibuat: '+e.message);}
  };
  function table(rows){return '<table><thead><tr>'+rows[0].map(v=>'<th>'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.slice(1).map(r=>'<tr>'+r.map(v=>'<td>'+esc(typeof v==='number'?v.toLocaleString('id-ID'):v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}
  $('printReport').onclick=()=>{
    if(!reportSourceAvailable())return;
    try{
      const d=consultantData();
      $('printArea').innerHTML='<h1>Laporan pemasukan dan pengeluaran usaha</h1><p>'+esc(monthName($('month').value))+'</p>'+table([['Ringkasan','Jumlah (Rp)'],['Total pemasukan',d.incoming],['Total pengeluaran',d.outgoing],['Selisih pemasukan dan pengeluaran',d.difference]])+'<p>Berdasarkan tanggal uang masuk / keluar. Rincian pribadi, saldo awal dan transfer sendiri tidak dihitung dalam total di atas.</p>'+(d.issues.length?'<p>'+esc(d.issues.join(' '))+'</p>':'')+'<h2>Rincian pemasukan dan pengeluaran</h2>'+table(plainCashRows(d.cash))+(d.transfers.length?'<h2>Transfer antar-rekening sendiri — tidak masuk total</h2>'+table(plainCashRows(d.transfers)):'')+(d.openings.length?'<h2>Saldo awal tercatat — bukan pemasukan</h2>'+table([['Tanggal','Keterangan','Jumlah (Rp)'],...d.openings.map(x=>[x.tanggal,x.catatan||flowLabel(x),x.jumlah])]):'');
      window.print();
    }catch(e){alert('Laporan belum dibuat: '+e.message);}
  };
  function debtValues(x){const principal=Number(x.jumlah||0)+(x.tambahan||[]).reduce((s,b)=>s+Number(b.jumlah||0),0);const historical=x.legacyPaidOpening!==undefined?Number(x.legacyPaidOpening):(!(x.bayar||[]).length&&x.status==='lunas'?Number(x.jumlah||0):0);const paid=historical+(x.bayar||[]).filter(b=>!b.voided).reduce((s,b)=>s+Number(b.jumlah||0),0);return {principal,paid,remaining:Math.max(0,principal-paid)};}
  function preserveLegacyPaid(debt){if(debt.legacyPaidOpening===undefined&&!(debt.bayar||[]).length&&debt.status==='lunas')debt.legacyPaidOpening=Number(debt.jumlah||0);}
  function renderDebts(){
    const debts=DB.pi.filter(x=>x&&x.tipe==='utang');
    $('debtList').innerHTML=debts.length?debts.map(x=>{const v=debtValues(x);return '<div class="transaction"><strong>'+esc(x.nama)+'</strong><p>'+esc(x.catatan||'')+'</p>'+line('Pokok / sudah dibayar',rupiah(v.principal)+' / '+rupiah(v.paid))+line('Sisa utang',v.remaining)+'<p>Jatuh tempo: '+esc(x.tempo||'Belum ditentukan')+'</p>'+(v.remaining?'<button data-pay="'+esc(x.id)+'">Bayar utang</button>':'<span class="positive">Lunas</span>')+'<details><summary>Riwayat pembayaran & tambahan</summary>'+[...(x.tambahan||[]).map(b=>'<p>Tambahan '+esc(b.tanggal)+' · '+esc(rupiah(b.jumlah))+' · '+esc(b.catatan||'')+'</p>'),...(x.bayar||[]).map(b=>'<p>'+esc(b.voided?'Dibatalkan':'Bayar')+' '+esc(b.tanggal)+' · '+esc(rupiah(b.jumlah))+'</p>')].join('')+'</details></div>';}).join(''):'<p class="empty">Belum ada utang tercatat.</p>';
    $('legacyReceivables').innerHTML=DB.pi.filter(x=>x&&x.tipe!=='utang').map(x=>{const v=debtValues(x);return '<div class="transaction"><strong>'+esc(x.nama)+'</strong><p>'+esc(x.catatan||'')+'</p>'+line('Sisa tercatat',v.remaining)+'</div>';}).join('')||'<p class="hint">Tidak ada catatan piutang lama.</p>';
    debts.forEach(debt=>{
      const node=document.createElement('details');node.innerHTML='<summary>Kelola '+esc(debt.nama)+'</summary><div class="actions"><button data-debt-edit="'+esc(debt.id)+'">Edit pokok / catatan</button><button data-debt-add="'+esc(debt.id)+'">Tambah utang ke orang ini</button></div>';
      $('debtList').appendChild(node);
    });
  }
  function resetDebt(){ $('debtForm').reset();$('debtEditId').value='';$('debtMode').value='';$('debtName').readOnly=false;$('debtDate').value=defaultDate();$('debtFormTitle').textContent='Tambah utang';$('debtAmountLabel').firstChild.textContent='Pokok utang (Rp)';$('debtSave').textContent='Tambah catatan utang';$('debtCancel').classList.add('hidden'); }
  function editDebt(id,mode){
    const d=DB.pi.find(x=>x&&x.id===id);if(!d)return;
    resetDebt();$('debtEditId').value=id;$('debtMode').value=mode;$('debtName').value=d.nama;$('debtName').readOnly=mode==='add';$('debtDue').value=d.tempo||'';$('debtCancel').classList.remove('hidden');
    if(mode==='add'){$('debtFormTitle').textContent='Tambah utang ke '+d.nama;$('debtAmountLabel').firstChild.textContent='Tambahan utang (Rp)';$('debtSave').textContent='Simpan tambahan utang';}
    else{$('debtFormTitle').textContent='Edit catatan utang';setMoney('debtAmount',d.jumlah);$('debtDate').value=d.tanggal||defaultDate();$('debtNote').value=d.catatan||'';$('debtSave').textContent='Simpan perubahan utang';}
    go('debts');
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
    if(b.hasAttribute('data-review'))showHistory('reviewAll');
  });
  function showHistory(filter){$('txFilter').value=filter;$('searchTx').value='';go('transactions');$('entryHistory').open=true;renderTransactions();$('entryHistory').scrollIntoView?.({behavior:'smooth',block:'start'});}
  $('showHistory').onclick=()=>showHistory('all');
  $('reviewOld').onclick=()=>showHistory('reviewAll');
  $('openTax').onclick=()=>{go('reports');$('reportMore').open=true;$('taxSettings').open=true;$('reportMore').scrollIntoView?.({behavior:'smooth',block:'start'});};
  $('grossDate').addEventListener('invalid',()=>{$('saleDateDetails').open=true;});
  $('flow').onchange=flowChanged;$('cancelEdit').onclick=resetForm;$('amount').addEventListener('input',renderSplitPreview);
  $('sameGross').onclick=()=>{const n=parseMoney('amount');if(n===null)return alert('Isi uang diterima terlebih dahulu.');setMoney('gross',n);};
  $('date').onchange=()=>{if(!$('editId').value&&$('grossDate').value===previousCashDate)$('grossDate').value=$('date').value;previousCashDate=$('date').value;};
  $('searchTx').oninput=renderTransactions;$('txFilter').onchange=renderTransactions;
  $('month').onchange=()=>{if(!F.validMonth($('month').value)){$('month').value=localDate().slice(0,7);}if(!$('editId').value&&!$('amount').value&&!$('gross').value&&!$('category').value&&!$('note').value&&$('grossDate').value===previousCashDate&&$('date').value===previousCashDate){$('date').value=defaultDate();$('grossDate').value=defaultDate();previousCashDate=$('date').value;}render();fillTaxSettings();};
  window.addEventListener('storage',e=>{if(e.key===KEY&&e.newValue!==raw){blocked=true;notice('Data berubah di tab lain. Form di sini belum dibuang. Unduh cadangan jika perlu, lalu buka ulang halaman sebelum melanjutkan.',true);}});
  document.querySelectorAll('input[inputmode="numeric"]').forEach(el=>el.addEventListener('blur',()=>{const n=parseMoney(el.id);if(n!==null)setMoney(el.id,n);}));
  resetForm();$('debtDate').value=localDate();fillTaxSettings();render();
  notice(loaded.error||'Tersimpan di perangkat ini · belum sinkron antar-perangkat',!!loaded.error);
})();
