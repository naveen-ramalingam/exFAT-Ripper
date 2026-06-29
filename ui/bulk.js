/* ============================================================================
 * bulk.js — context menu, bulk operations, onboarding, and app bootstrap
 * ----------------------------------------------------------------------------
 * PURPOSE      The right-click context menu, multi-select bulk operations (via the
 *              single runBulkOperation abstraction), onboarding/close dialogs,
 *              window-drag fallback, and the whenApiReady() startup sequence.
 * PUBLIC       openContextMenu, ctxAction, runBulkOperation, bulk* actions,
 *              showOnboard, startup bootstrap (loads last, after all modules).
 * DEPENDS ON   app.js, library.js, files.js, settings.js (loads LAST).
 * RESPONSIBLE  cross-cutting actions + bootstrap; must load after all the above.
 * ========================================================================== */

// ── Context menu ───────────────────────────────────────────────────────────
let _ctxRi=-1; // the card right-clicked (for "Open details")
function openContextMenu(x,y,ri){
  const m=$('ctx-menu');if(!m)return;
  if(ri!==undefined)_ctxRi=ri;
  // Update the Favorite/Unfavorite label based on the selection: if every
  // selected game is already a favorite, the action becomes "Unfavorite".
  const sel=selectedGames();
  const allFav=sel.length>0&&sel.every(isFavGame);
  txt('ctx-fav-lbl',allFav?'Unfavorite':'Favorite');
  updateSelectionBar(); // keeps Compare enabled-state correct
  // Show first (to measure), then clamp within the viewport.
  m.style.display='block';m.style.visibility='hidden';
  const w=m.offsetWidth,h=m.offsetHeight;
  const px=Math.min(x,window.innerWidth-w-8);
  const py=Math.min(y,window.innerHeight-h-8);
  m.style.left=Math.max(8,px)+'px';m.style.top=Math.max(8,py)+'px';
  m.style.visibility='visible';
}
function closeContextMenu(){const m=$('ctx-menu');if(m)m.style.display='none';}
function ctxAction(action){
  closeContextMenu();
  switch(action){
    case 'open':{const ri=_ctxRi>=0?_ctxRi:[...selectedRows][0];if(ri!==undefined&&ri>=0)doSelGame(ri);break;}
    case 'fav':bulkFavorite();break;
    case 'enrich':bulkEnrich();break;
    case 'rescrape':bulkRescrape();break;
    case 'export':bulkExport();break;
    case 'ftp':bulkFtp();break;
    case 'compare':bulkCompare();break;
    case 'clear':clearSelection();break;
  }
}

// ── Bulk actions ───────────────────────────────────────────────────────────
// These operate on the current selection. Per-item operations (metadata,
// re-scrape) drive the existing single-item backend endpoints sequentially from
// the front-end with a non-blocking progress modal — the full Operation Queue
// is intentionally NOT built here (that's a later tier). The modal keeps the UI
// responsive and cancelable rather than freezing on a long batch.
let _bulkCancel=false;

function bulkFavorite(){
  const sel=selectedGames();if(!sel.length){toast('No games selected');return;}
  // If all are already favorites, toggle them off; otherwise favorite all.
  const allFav=sel.every(isFavGame);
  sel.forEach(g=>setFavGameState(g,!allFav));
  saveFavs();txt('cnt-favs',favs.size);
  if(filter==='favs')applyFilters();else renderGrid();
  refreshSelectionUI();
  toast(allFav?`Removed ${sel.length} from favorites`:`Added ${sel.length} to favorites`,'ok');
}

function openBulkModal(title,total){
  _bulkCancel=false;
  const o=$('bulk-overlay');if(!o)return;
  txt('bulk-title',title);txt('bulk-status','0 / '+total);
  const fill=$('bulk-bar-fill');if(fill)fill.style.width='0%';
  const sp=$('bulk-spinner');if(sp)sp.style.display='';
  const cb=$('bulk-cancel');if(cb){cb.textContent='Cancel';cb.disabled=false;}
  o.style.display='flex';requestAnimationFrame(()=>o.classList.add('show'));
}
function updateBulkModal(done,total,label){
  txt('bulk-status',(label?label+'  ':'')+done+' / '+total);
  const fill=$('bulk-bar-fill');if(fill)fill.style.width=(total?Math.round(done/total*100):0)+'%';
}
function finishBulkModal(msg){
  const sp=$('bulk-spinner');if(sp)sp.style.display='none';
  const cb=$('bulk-cancel');if(cb){cb.textContent='Done';cb.disabled=false;}
  if(msg)txt('bulk-title',msg);
  // Auto-close shortly after success unless the user already closed it.
  setTimeout(()=>{const o=$('bulk-overlay');if(o&&o.classList.contains('show'))closeBulkModal();},1400);
}
function closeBulkModal(){const o=$('bulk-overlay');if(!o)return;o.classList.remove('show');o.style.display='none';}
function cancelBulk(){const cb=$('bulk-cancel');if(cb&&cb.textContent==='Done'){closeBulkModal();return;}_bulkCancel=true;closeBulkModal();toast('Cancelled');}

// Generic sequential runner over selected games' real indices.
// ── runBulkOperation: the single abstraction all per-item bulk work flows
// through. Takes a title, the list of games to operate on, and a worker that
// returns a promise per game. This is intentionally the seam the future
// lightweight TaskRunner (v3.2.2) will extend rather than replace — every bulk
// action (metadata, re-scrape, and later verify, download-covers, repair, send)
// becomes a one-line call. opts.confirm gates with a confirm() first;
// opts.reloadAfter refreshes the library when the batch finishes.
async function runBulkOperation(title,games,worker,opts){
  opts=opts||{};
  const list=(games||[]).filter(Boolean);
  if(!list.length){toast('No games selected');return;}
  if(opts.confirm&&!confirm(opts.confirm.replace('{n}',list.length)))return;
  const a=api();if(!a){toast('Backend unavailable');return;}
  openBulkModal(title,list.length);
  let done=0,failed=0;
  for(const g of list){
    if(_bulkCancel)break;
    const ri=riOf(g);
    try{const r=await worker(g,ri);if(r&&r.ok===false)failed++;}
    catch(e){failed++;logErr('runBulkOperation',e);}
    done++;updateBulkModal(done,list.length,g?.title?.slice(0,28)||'');
  }
  if(_bulkCancel)return;
  finishBulkModal(failed?`Done — ${failed} failed`:'Done');
  if(opts.reloadAfter!==false)loadLibrary(); // refresh data/covers once at end
  toast(failed?`Completed with ${failed} error(s)`:`${done} game(s) updated`,failed?'err':'ok');
}

function bulkEnrich(){
  const a=api();if(!a)return;
  runBulkOperation('Fetching metadata…',selectedGames(),(g,ri)=>a.enrich_one(ri,SRC));
}
function bulkRescrape(){
  const a=api();if(!a)return;
  runBulkOperation('Re-scraping…',selectedGames(),(g,ri)=>a.rescrape_one(ri,SRC),
    {confirm:'Re-scrape {n} selected game(s)?'});
}
function bulkExport(){
  const sel=selectedGames();if(!sel.length){toast('No games selected');return;}
  const a=api();if(!a)return;
  const indices=sel.map(g=>riOf(g)).filter(i=>i>=0);
  toast(`Exporting ${sel.length} game(s) to Pegasus…`);
  // Whole-batch export (not per-item), so it doesn't use runBulkOperation —
  // the backend exports just the supplied indices in one call.
  a.export_pegasus(SRC,indices).then(r=>{
    if(r&&r.ok)toast(`Exported ${r.packages} package(s) to ${r.path}`,'ok');
    else if(r&&r.error!=='Export cancelled.')errToast(r?.error||'Export failed');
  });
}
function bulkFtp(){
  // Reuse the existing FTP flow. (Selection-scoped send can be wired once the
  // backend send accepts indices; for now it opens the standard send modal.)
  if(typeof openFtpModal==='function')openFtpModal();
}
function bulkCompare(){
  const sel=selectedGames();
  if(sel.length!==2){toast('Select exactly 2 games to compare');return;}
  // The Compare *view* is a separate deliverable (v3.2.2); this wires the entry
  // point and the exactly-two gating. Surface a clear placeholder for now.
  toast(`Compare: ${sel[0].title} vs ${sel[1].title} — coming in the Compare view`);
}
function showOnboard(){const o=document.getElementById('onboard-overlay');o.style.display='';o.classList.add('show');}
function closeOnboard(){const o=document.getElementById('onboard-overlay');o.classList.remove('show');o.style.display='none';}
function tryClose(){const o=document.getElementById('support-overlay');o.style.display='';o.classList.add('show');}
function cancelClose(){const o=document.getElementById('support-overlay');o.classList.remove('show');o.style.display='none';}
function confirmClose(){const a=api();if(a)a.win_close();else window.close();}
let galleryUrls=[],galleryIdx=0;
function openGallery(i){
  const shots=selGameObj?.enrichment?.screenshots||[];
  if(!shots.length){toast('No screenshots available');return;}
  galleryUrls=shots;galleryIdx=Math.max(0,Math.min(i,shots.length-1));
  document.getElementById('gallery-overlay').classList.add('open');
  document.addEventListener('keydown',galleryKey);
  renderGallery();
}
function closeGallery(){document.getElementById('gallery-overlay').classList.remove('open');document.removeEventListener('keydown',galleryKey);}
function galleryBgClick(e){if(e.target.id==='gallery-overlay')closeGallery();}
function galleryKey(e){if(e.key==='Escape')closeGallery();else if(e.key==='ArrowLeft')gallerySt(-1);else if(e.key==='ArrowRight')gallerySt(1);}
function gallerySt(d){galleryIdx=(galleryIdx+d+galleryUrls.length)%galleryUrls.length;renderGallery();}
function renderGallery(){
  const img=document.getElementById('gallery-img'),sp=document.getElementById('gallery-spinner'),ctr=document.getElementById('gallery-counter'),thumbs=document.getElementById('gallery-thumbs');
  if(!img)return;
  img.classList.remove('zoomed');img.style.opacity='0';sp.classList.add('show');
  const url=galleryUrls[galleryIdx];
  img.onload=()=>{sp.classList.remove('show');img.style.opacity='1';};
  img.onerror=()=>{sp.classList.remove('show');img.style.opacity='.3';};
  img.src=url;
  ctr.textContent=(galleryIdx+1)+' / '+galleryUrls.length;
  thumbs.innerHTML=galleryUrls.map((u,i)=>`<img class="gallery-thumb${i===galleryIdx?' on':''}" src="${u}" onclick="galleryIdx=${i};renderGallery()" loading="lazy">`).join('');
  [-1,1].forEach(d=>{const pi=(galleryIdx+d+galleryUrls.length)%galleryUrls.length;new Image().src=galleryUrls[pi];});
}
function galleryZoom(){document.getElementById('gallery-img')?.classList.toggle('zoomed');}

// --- Trailer: RAWG /movies clip first; YouTube search fallback otherwise -----
let _trailerData=null;
let _trailerTitle='';
function renderTrailer(tr,title){
  const sec=document.getElementById('d-trailer');
  if(!sec)return;
  _trailerData=tr&&tr.video?tr:null;
  _trailerTitle=title||'';
  if(_trailerData){
    // RAWG trailer available — play it in-app.
    const thumb=_trailerData.preview?`<img src="${esc(_trailerData.preview)}" alt="" loading="lazy">`:
      '<div class="d-trailer-noth"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>';
    sec.innerHTML=`<div class="d-trailer-card" onclick="openTrailer()">
      <div class="d-trailer-thumb">${thumb}<div class="d-trailer-play"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>
      <div class="d-trailer-meta"><div class="d-trailer-name">${esc(_trailerData.name||'Trailer')}</div><div class="d-trailer-sub">Play Trailer</div></div>
    </div>`;
    return;
  }
  // No RAWG trailer — offer a user-driven YouTube search. We do NOT auto-pick a
  // video (avoids wrong trailers) and do NOT scrape or require an API key. The
  // YouTube search results page can't be embedded (X-Frame-Options + the
  // deprecated search-list API), so this opens YouTube search in the browser
  // where the user chooses the correct official trailer themselves.
  if(_trailerTitle){
    sec.innerHTML=`<div class="d-trailer-card d-trailer-yt" onclick="searchYouTubeTrailer()">
      <div class="d-trailer-thumb d-trailer-yt-thumb"><svg viewBox="0 0 24 24"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-2C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.41 19c1.71.46 8.59.46 8.59.46s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="currentColor" stroke="none"/></svg></div>
      <div class="d-trailer-meta"><div class="d-trailer-name">Find a trailer on YouTube</div><div class="d-trailer-sub">Search YouTube Trailer</div></div>
    </div>`;
  } else {
    sec.innerHTML='<div class="d-trailer-none">No trailer available</div>';
  }
}
function searchYouTubeTrailer(){
  if(!_trailerTitle)return;
  // Build a focused query that surfaces official PS5 trailers first.
  const q=`${_trailerTitle} PS5 official trailer`;
  const url='https://www.youtube.com/results?search_query='+encodeURIComponent(q);
  openUrl(encodeURIComponent(url));
  toast('Opening YouTube search — pick the official trailer','ok');
}
function openTrailer(){
  if(!_trailerData||!_trailerData.video)return;
  const ov=document.getElementById('trailer-overlay');
  const vid=document.getElementById('trailer-video');
  const fb=document.getElementById('trailer-fallback');
  if(!ov||!vid)return;
  fb.style.display='none';
  vid.src=_trailerData.video;
  vid.onerror=()=>{fb.style.display='';};
  ov.classList.add('open');
  document.addEventListener('keydown',trailerKey);
  vid.play().catch(()=>{/* autoplay may be blocked; user can press play */});
}
function closeTrailer(){
  const ov=document.getElementById('trailer-overlay');
  const vid=document.getElementById('trailer-video');
  if(vid){try{vid.pause();}catch(e){}vid.removeAttribute('src');vid.load&&vid.load();}
  if(ov)ov.classList.remove('open');
  document.removeEventListener('keydown',trailerKey);
}
function trailerBgClick(e){if(e.target.id==='trailer-overlay')closeTrailer();}
function trailerKey(e){if(e.key==='Escape')closeTrailer();}
function trailerOpenExt(){if(_trailerData&&_trailerData.video)openUrl(encodeURIComponent(_trailerData.video));}
function checkApiWarn(){
  // Check live form inputs first (user may have typed but not saved yet),
  // then fall back to the persisted appSettings
  const liveRawg=($('s-rawg')?.value||'').trim();
  const liveIgdb=($('s-igdb-id')?.value||'').trim();
  const hasApi=!!(liveRawg||liveIgdb||appSettings.rawg_api_key||appSettings.igdb_client_id);
  const warn=document.getElementById('d-api-warn');
  if(warn) warn.style.display=hasApi?'none':'flex';
}
function updateMetaBannerApiWarn(){
  // Keep the missing-metadata page banner in sync too
  const liveRawg=($('s-rawg')?.value||'').trim();
  const liveIgdb=($('s-igdb-id')?.value||'').trim();
  const hasApi=!!(liveRawg||liveIgdb||appSettings.rawg_api_key||appSettings.igdb_client_id);
  const apiWarn=$('mfb-api-warn');
  if(apiWarn) apiWarn.style.display=hasApi?'none':'';
  const btn=$('mfb-btn');
  if(btn){
    btn.disabled=false;
    const cnt=allGames.filter(g=>!(g.enrichment?.description)).length;
    btn.innerHTML='<svg viewBox="0 0 24 24" width="13" height="13" style="stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Fetch All Missing Metadata';
  }
}
function startScrape(mode){
  const msgs={update:'Checking for new games...',metadata:'Fetching missing metadata...',covers:'Repairing missing covers...',rebuild_covers:'Rebuilding cover cache...',full:'Starting full library scrape...'};
  const a=api();if(!a){toast('Backend not ready','err');return;}
  const b=document.getElementById('scrape-btn');if(b)b.disabled=true;
  setStatus(true,msgs[mode]||'Working...');
  a.start_scrape(SRC,mode).then(r=>{if(!r.ok){errToast(r.error||'Failed');setStatus(false);if(b)b.disabled=false;}});
}
function maybeShowOnboard(){if(!localStorage.getItem('er_scraped')&&!allGames.length)showOnboard();}

// Global Escape: clear multi-selection first (per spec), then dismiss overlays.
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  // Context menu closes on any Escape.
  closeContextMenu();
  // Priority 1: if a multi-selection is active, clear it and stop here so the
  // user doesn't also lose their open panel in the same keystroke.
  if(selectedRows.size){clearSelection();return;}
  ['support-overlay','onboard-overlay','ftp-overlay','verify-overlay','bulk-overlay'].forEach(id=>{
    const o=document.getElementById(id);
    if(o&&(o.classList.contains('show')||o.style.display==='flex')){o.classList.remove('show');o.style.display='none';}
  });
  const g=document.getElementById('gallery-overlay');
  if(g&&g.classList.contains('open'))g.classList.remove('open');
});
// Ctrl/Cmd+A: select all games in the current filtered view (library view only,
// not while typing in a field).
document.addEventListener('keydown',e=>{
  if(viewMode!=='lib')return;
  if(!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='a')return;
  const t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'))return;
  e.preventDefault();
  filteredGames.forEach(g=>setSelected(g,true));
  if(filteredGames.length)selAnchor=riOf(filteredGames[0]);
  refreshSelectionUI();
});
// Pagination shortcuts: Ctrl/Cmd + Left/Right to page. Only in library view,
// and never while typing in a field.
document.addEventListener('keydown',e=>{
  if(viewMode!=='lib')return;
  if(!(e.ctrlKey||e.metaKey))return;
  const t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'))return;
  if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
  const pp=parseInt($('per-pg')?.value||'12');
  const total=Math.max(1,Math.ceil(filteredGames.length/pp));
  if(e.key==='ArrowLeft'&&currentPg>1){e.preventDefault();chPg(currentPg-1);}
  else if(e.key==='ArrowRight'&&currentPg<total){e.preventDefault();chPg(currentPg+1);}
});

// ── Window drag fallback (for renderers that ignore pywebview-drag-region) ──
(function(){
  const tb=document.querySelector('.tb');
  if(!tb)return;
  let dragging=false,lastX=0,lastY=0,moved=false;
  tb.addEventListener('mousedown',e=>{
    // ignore clicks on buttons / interactive children
    if(e.target.closest('button,.tb-ibtn,.wc-btn,.tb-right'))return;
    if(e.button!==0)return;
    dragging=true;moved=false;lastX=e.screenX;lastY=e.screenY;
  });
  window.addEventListener('mousemove',e=>{
    if(!dragging)return;
    const dx=e.screenX-lastX, dy=e.screenY-lastY;
    if(dx===0&&dy===0)return;
    lastX=e.screenX;lastY=e.screenY;moved=true;
    // Only use JS fallback if the native drag-region didn't already move it.
    // Calling win_move is harmless even if native drag works, but we guard
    // against double-move by only firing when the API exists.
    const a=api();
    if(a&&a.win_move)a.win_move(dx,dy);
  });
  window.addEventListener('mouseup',()=>{dragging=false;});
  window.addEventListener('blur',()=>{dragging=false;});
  // Double-click titlebar to maximise/restore (standard Windows behaviour)
  tb.addEventListener('dblclick',e=>{
    if(e.target.closest('button,.tb-ibtn,.wc-btn,.tb-right'))return;
    const a=api();if(a&&a.win_toggle_maximize)a.win_toggle_maximize();
  });
})();
whenApiReady(()=>{loadLibrary();api().get_settings?.().then(r=>{if(r?.ok){appSettings=r.settings;checkApiWarn();}});api().get_version?.().then(r=>{if(r?.ok)txt('sbar-ver','v'+r.version);});setTimeout(maybeShowOnboard,700);initToolbarReflow();});
