/* ============================================================================
 * verify.js — the Verify Library hub
 * ----------------------------------------------------------------------------
 * PURPOSE      The verification hub overlay: runs the real library checks
 *              (metadata + cover coverage; local-install when holdings exist).
 * PUBLIC       openVerifyHub, closeVerifyHub.
 * DEPENDS ON   app.js (helpers), library.js (allGames).
 * RESPONSIBLE  the verification surface only.
 * NOTE         Verify Hub shows ONLY real checks (Charter: no "Coming Soon").
 * ========================================================================== */

function openVerifyHub(){
  const a=api(),o=$('verify-overlay'),list=$('vh-list');
  if(!o||!list)return;
  // Verify Hub shows ONLY real checks (Product Charter: no "Coming Soon").
  // Live today: Metadata + Covers, computed from real library stats.
  // Local install appears ONLY when holdings data actually exists in the stats
  // payload — it is never faked. Until Holdings (Issue #03) provides that data,
  // the row simply does not appear. Link/host/update checks were intentionally
  // removed: they are downloader-domain and are Non-Goals before 1.0.
  const checkSvg='<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
  const warnSvg='<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  const renderRows=(stats)=>{
    const row=(ic,icSvg,name,detail)=>
      `<div class="vh-row"><div class="vh-ic ${ic}">${icSvg}</div><div class="vh-body"><div class="vh-name">${name}</div><div class="vh-detail">${detail}</div></div><span class="vh-badge live">Live</span></div>`;
    const metaTotal=stats?stats.total:0, metaDone=stats?stats.has_meta:0;
    const covTotal=stats?stats.total:0, covDone=stats?stats.has_cover:0;
    const metaOk=metaTotal>0&&metaDone===metaTotal;
    const covOk=covTotal>0&&covDone===covTotal;
    let h='';
    h+=row(metaOk?'ok':'warn',metaOk?checkSvg:warnSvg,'Metadata',
      metaTotal?`${metaDone} of ${metaTotal} titles have metadata`:'No titles loaded');
    h+=row(covOk?'ok':'warn',covOk?checkSvg:warnSvg,'Covers',
      covTotal?`${covDone} of ${covTotal} covers cached`:'No titles loaded');
    // Local install: ONLY if real holdings data is present in the payload.
    // (stats.local_total is supplied by Holdings/Issue #03 when it exists.)
    if(stats&&typeof stats.local_total==='number'&&stats.local_total>=0
       &&typeof stats.has_local==='number'){
      const liOk=stats.local_total>0&&stats.has_local===stats.local_total;
      h+=row(liOk?'ok':'warn',liOk?checkSvg:warnSvg,'Local install',
        `${stats.has_local} of ${stats.local_total} titles present on disk`);
    }
    list.innerHTML=h;
  };
  // Show immediately with a loading state, then fill real numbers.
  renderRows(null);
  o.style.display='flex';requestAnimationFrame(()=>o.classList.add('show'));
  if(a&&a.get_library_stats){a.get_library_stats(SRC).then(r=>{if(r&&r.ok)renderRows(r);});}
}
function closeVerifyHub(){const o=$('verify-overlay');if(!o)return;o.classList.remove('show');o.style.display='none';}
function rescrapeOne(){if(selIdx<0)return;const a=api();if(!a)return;if(!confirm(`Re-scrape "${selGameObj?.title||'this game'}"?`))return;setStatus(true,'Re-scraping...');a.rescrape_one(selIdx,SRC).then(r=>{if(!r.ok){toast(r.error||'Failed','err');setStatus(false);}});}
function doImport(){const a=api();if(!a)return;a.import_library(SRC).then(r=>{if(r.ok){toast('Imported '+r.count+' games','ok');loadLibrary();}else if(r.error!=='Import cancelled.')toast(r.error||'Import failed','err');});}
function doExport(){const a=api();if(!a)return;a.export_library(SRC).then(r=>{if(r.ok)toast('Exported to '+r.path,'ok');else if(r.error!=='Export cancelled.')toast(r.error||'Export failed','err');});}
function doExportPegasus(){const a=api();if(!a)return;toast('Building Pegasus catalog (decrypting links)...');a.export_pegasus(SRC).then(r=>{if(r.ok)toast('Pegasus catalog exported ('+r.packages+' packages) to '+r.path,'ok');else if(r.error!=='Export cancelled.')toast(r.error||'Pegasus export failed','err');});}
function openFtpModal(){
  const o=$('ftp-overlay');if(!o)return;
  // Prefill saved details if we have them.
  if(appSettings){
    if(appSettings.ps5_ftp_host) $('ftp-host').value=appSettings.ps5_ftp_host;
    $('ftp-port').value=appSettings.ps5_ftp_port||1337;
    if(appSettings.ps5_ftp_user) $('ftp-user').value=appSettings.ps5_ftp_user;
    if(appSettings.ps5_ftp_pass) $('ftp-pass').value=appSettings.ps5_ftp_pass;
  }
  const st=$('ftp-status');if(st){st.textContent='';st.className='ftp-status';}
  o.style.display='';o.classList.add('show');
  setTimeout(()=>$('ftp-host')&&$('ftp-host').focus(),50);
}
function closeFtpModal(){const o=$('ftp-overlay');if(!o)return;o.classList.remove('show');o.style.display='none';}
function _ftpBusy(on){
  ['ftp-test-btn','ftp-send-btn'].forEach(id=>{const b=$(id);if(b)b.disabled=on;});
}
function doTestFtp(){
  const a=api();if(!a){toast('Backend not ready','err');return;}
  const host=($('ftp-host').value||'').trim();
  const port=($('ftp-port').value||'1337').trim();
  const user=($('ftp-user').value||'').trim();
  const pass=$('ftp-pass').value||'';
  const st=$('ftp-status');const tb=$('ftp-test-btn');
  if(!host){st.className='ftp-status err';st.textContent='Enter your PS5\u2019s IP address.';return;}
  st.className='ftp-status busy';st.textContent='Connecting to '+host+':'+port+'\u2026';
  _ftpBusy(true);if(tb)tb.textContent='Testing\u2026';
  a.test_pegasus_ftp(host,port,user,pass).then(r=>{
    _ftpBusy(false);if(tb)tb.textContent='Test Connection';
    if(r.ok){st.className='ftp-status ok';st.textContent='\u2713 '+(r.message||'Connected successfully.');}
    else{st.className='ftp-status err';st.textContent=r.error||'Connection failed.';}
  }).catch(e=>{_ftpBusy(false);if(tb)tb.textContent='Test Connection';st.className='ftp-status err';st.textContent='Test failed: '+e;});
}
function doSendFtp(){
  const a=api();if(!a){toast('Backend not ready','err');return;}
  const host=($('ftp-host').value||'').trim();
  const port=($('ftp-port').value||'1337').trim();
  const user=($('ftp-user').value||'').trim();
  const pass=$('ftp-pass').value||'';
  const remember=$('ftp-remember').checked;
  const st=$('ftp-status');
  const btn=$('ftp-send-btn');
  if(!host){st.className='ftp-status err';st.textContent='Enter your PS5\u2019s IP address.';return;}
  st.className='ftp-status busy';st.textContent='Building Pegasus catalog\u2026';
  _ftpBusy(true);if(btn)btn.textContent='Sending\u2026';
  const steps=['Connecting to PS5\u2026','Downloading existing Pegasus config\u2026','Merging exFAT Ripper source\u2026','Uploading config\u2026','Verifying upload\u2026'];
  let si=0;
  const ticker=setInterval(()=>{if(si<steps.length){st.textContent=steps[si++];}},650);
  a.send_pegasus_ftp(host,port,user,pass,remember,SRC).then(r=>{
    clearInterval(ticker);
    _ftpBusy(false);if(btn)btn.textContent='Send to PS5';
    if(r.ok){
      st.className='ftp-status ok';
      let m='\u2713 Done. Sent '+r.packages+' packages to '+r.host+'. Refresh the source in Pegasus DL on your PS5.';
      if(r.created)m='\u2713 Done. Created a new Pegasus config with '+r.packages+' packages on '+r.host+'. Refresh the source in Pegasus DL on your PS5.';
      st.textContent=m;
      toast('Catalog sent to PS5 ('+r.packages+' packages)','ok');
      setTimeout(closeFtpModal,3200);
    }else{
      st.className='ftp-status err';
      st.textContent=r.error||'Send failed.';
    }
  }).catch(e=>{
    clearInterval(ticker);
    _ftpBusy(false);if(btn)btn.textContent='Send to PS5';
    st.className='ftp-status err';st.textContent='Send failed: '+e;
  });
}
