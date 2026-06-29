/* ============================================================================
 * library.js — library grid, filtering, paging, navigation, health widget
 * ----------------------------------------------------------------------------
 * PURPOSE      The All-Games library view: view switching, loading the library,
 *              applying filters/sort, rendering the grid, pagination, card click
 *              routing (plain/ctrl/shift), and the sidebar health widget.
 * PUBLIC       showView, loadLibrary, applyFilters, renderGrid, setFilter, setPill,
 *              cycleSortMode, setView, chPg, pgJump, cardClick, updateHealthWidget.
 * DEPENDS ON   app.js (helpers, globals, appState).
 * RESPONSIBLE  the library browsing surface; not the detail panel or settings.
 * ========================================================================== */

function showView(v){
  viewMode=v;
  ['scroll-area','settings-pg','credits-pg','updates-pg'].forEach(id=>{const e=$(id);if(e)e.style.display='none';});
  $('topbar').style.display=v==='lib'?'':'none';
  $('pills-row').style.display=v==='lib'?'':'none';
  $('view-hdr').style.display=v==='lib'?'':'none';
  // Pagination is a sticky footer of the content column — only show in library.
  const pg=$('pagination');if(pg)pg.style.display=(v==='lib'&&allGames.length)?'':'none';
  // Collapse the right detail panel while in Settings/Credits so those pages
  // get the full width and don't feel cramped.
  const dp=$('detail-panel');if(dp)dp.classList.toggle('collapsed',v==='settings'||v==='credits'||v==='updates');
  document.querySelectorAll('.sbi').forEach(e=>e.classList.remove('on'));
  if(v==='lib'){
    $('scroll-area').style.display='flex';$('scroll-area').style.flexDirection='column';
    $('nav-all')?.classList.add('on');
    checkApiWarn();
    updateMetaBannerApiWarn();
    if(pg&&allGames.length)pg.style.display='';
    requestAnimationFrame(reflowToolbar);
  } else if(v==='settings'){
    $('settings-pg').style.display='block';$('nav-settings')?.classList.add('on');
    loadSettingsForm();
  } else if(v==='credits'){
    $('credits-pg').style.display='block';$('nav-credits')?.classList.add('on');
  } else if(v==='updates'){
    $('updates-pg').style.display='block';$('nav-updates')?.classList.add('on');
    loadLibraryChanges();
  }
}
const FILTER_TITLES={all:'All Games',favs:'Favorites',bp:'Backports',dlc:'DLCs',recent:'Recently Added',no_cover:'Missing Covers',no_meta:'Missing Metadata',dupes:'Duplicates'};
function setFilter(f){
  filter=f;currentPg=1;
  document.querySelectorAll('.sbi').forEach(e=>e.classList.remove('on'));
  const m={all:'nav-all',favs:'nav-favs',bp:'nav-bp',dlc:'nav-dlc',recent:'nav-recent',no_cover:'nav-miss',no_meta:'nav-nometa',dupes:'nav-dupes'};
  $(m[f]||'nav-all')?.classList.add('on');
  txt('view-title',FILTER_TITLES[f]||'Games');
  // show/hide the fix-all banner
  const banner=$('meta-fix-banner');
  if(banner){
    if(f==='no_meta'){
      banner.style.display='';
      const missing=allGames.filter(g=>!(g.enrichment?.description));
      txt('mfb-count', missing.length);
      // show API warning if no keys configured
      const apiWarn=$('mfb-api-warn');
      if(apiWarn) apiWarn.style.display=(appSettings.rawg_api_key||appSettings.igdb_client_id)?'none':'';
    } else {
      banner.style.display='none';
    }
  }
  applyFilters();
}
function setPill(p){pillFilter=p;currentPg=1;document.querySelectorAll('.pill').forEach(e=>e.classList.remove('on'));$('pill-'+p)?.classList.add('on');applyFilters();}
let sortMode=SORT_MODES[0];
let _changeMap={};  // PPSA -> {kind, g} for Recent Changes summary cards
function cycleSortMode(){sortIdx=(sortIdx+1)%SORT_MODES.length;sortMode=SORT_MODES[sortIdx];txt('sort-lbl',sortMode.label);applyFilters();}
function setView(m){cardMode=m;$('vt-grid').classList.toggle('on',m==='grid');$('vt-list').classList.toggle('on',m==='list');renderGrid();}
function loadLibrary(){
  const a=api();if(!a){renderGrid();return;}
  a.load_library(SRC).then(r=>{if(r.ok){allGames=r.games||[];rebuildGameIndex();updateCounts();updateHealthWidget();applyFilters();const lp=parseInt(localStorage.getItem('er_lastpage_'+SRC)||'1');if(lp>1){const pp=parseInt($('per-pg')?.value||'12');const total=Math.max(1,Math.ceil(filteredGames.length/pp));currentPg=Math.min(lp,total);renderGrid();}}});
  a.get_library_stats(SRC).then(r=>{if(!r.ok)return;txt('cnt-miss-cov',r.missing_covers||'0');txt('cnt-miss-meta',r.missing_meta||'0');txt('sb-covers',(r.has_cover||0)+' covers');updateHealthWidget(r);});
  a.get_duplicates(SRC).then(r=>{if(r.ok)txt('cnt-dupes',r.duplicates?.length||'0');});
}
function updateCounts(){
  const t=allGames.length;
  txt('cnt-all',t);
  const bpCnt=allGames.filter(g=>g.is_backport||g.backport_text||g.backport).length;
  txt('cnt-bp',bpCnt);txt('cnt-dlc',allGames.filter(g=>g.has_dlc||g.is_dlc).length);
  txt('cnt-favs',favs.size);txt('cnt-recent',Math.min(7,t));txt('sb-total',t+' games');
  txt('pcnt-all',t);txt('pcnt-native',t-bpCnt);txt('pcnt-bp',bpCnt);
  txt('pcnt-dlc',allGames.filter(g=>g.has_dlc||g.is_dlc).length);txt('pcnt-updates',0);
  txt('cnt-verify',t>0?t:'?');
}
function updateHealthWidget(stats){
  const total=allGames.length;if(!total)return;
  const hasCover=stats?.has_cover??allGames.filter(g=>g.cover_local_path).length;
  const hasMeta=stats?.has_meta??allGames.filter(g=>g.enrichment?.description).length;
  const missMeta=stats?.missing_meta??(total-hasMeta);
  const missCov=stats?.missing_covers??(total-hasCover);
  // Composite health is based only on signals we actually measure today:
  // cover coverage and metadata coverage. (Link/file verification will feed in
  // here once those checks exist — see the Verify Library hub.)
  const coverPct=hasCover/total;
  const metaPct=hasMeta/total;
  // Weights: covers 55%, metadata 45%.
  let score=coverPct*0.55+metaPct*0.45;
  const pct=Math.max(0,Math.min(100,Math.round(score*100)));

  const circ=2*Math.PI*19,fill=$('hw-ring');
  // Colour the ring by health band.
  const col=pct>=90?'#22c55e':pct>=70?'#84cc16':pct>=50?'#fbbf24':'#fb7185';
  if(fill){fill.setAttribute('stroke-dasharray',`${(circ*pct/100).toFixed(1)} ${(circ*(1-pct/100)).toFixed(1)}`);fill.setAttribute('stroke',col);}
  const pctEl=$('hw-pct');if(pctEl)pctEl.setAttribute('fill',col);
  const stEl=$('hw-status');if(stEl)stEl.style.color=col;
  txt('hw-pct',pct+'%');txt('hw-score',pct+'%');
  txt('hw-status',pct>=90?'Excellent':pct>=70?'Good':pct>=50?'Fair':'Needs Repair');
  txt('hwi-games',total+' Games');txt('hwi-covers',hasCover+' Covers cached');
  txt('hwi-meta',missMeta+' Missing Metadata');txt('hwi-ver',hasMeta+' Metadata complete');

  // Real storage (cover cache only is known) — surface it if the backend
  // reported usable disk numbers; otherwise the widget stays hidden.
  if(stats&&typeof stats.disk_used_bytes==='number'&&typeof stats.disk_total_bytes==='number'&&stats.disk_total_bytes>0){
    const sw=$('storage-widget');if(sw)sw.style.display='';
    const fmt=b=>b>=1099511627776?(b/1099511627776).toFixed(2)+' TB':(b/1073741824).toFixed(0)+' GB';
    const spct=Math.round(stats.disk_used_bytes/stats.disk_total_bytes*100);
    txt('sw-nums',fmt(stats.disk_used_bytes)+' / '+fmt(stats.disk_total_bytes));
    txt('sw-sub','Free: '+fmt(stats.disk_total_bytes-stats.disk_used_bytes));
    txt('sw-pct',spct+'%');
    const sc=2*Math.PI*17,sr=$('sw-ring');
    if(sr)sr.setAttribute('stroke-dasharray',`${(sc*spct/100).toFixed(1)} ${(sc*(1-spct/100)).toFixed(1)}`);
  }
}
function applyFilters(){
  // A change to filter/sort/search means the view context changed, so any
  // active selection no longer maps to what's on screen — clear it. (Paging
  // goes through renderGrid directly and preserves selection.)
  clearSelectionOnViewChange();
  const q=($('search')?.value||'').toLowerCase();
  const fw=$('filter-fw')?.value||'';const ext=$('filter-extra')?.value||'';
  let base=[...allGames];
  if(filter==='favs')base=base.filter(g=>isFavGame(g));
  else if(filter==='bp')base=base.filter(g=>g.is_backport||g.backport_text||g.backport);
  else if(filter==='dlc')base=base.filter(g=>g.has_dlc||g.is_dlc);
  else if(filter==='recent')base=base.slice(-7).reverse();
  else if(filter==='no_cover')base=base.filter(g=>!g.cover_local_path);
  else if(filter==='no_meta')base=base.filter(g=>!(g.enrichment?.description));
  else if(filter==='dupes'){const seen=new Set();base=base.filter(g=>{const k=(g.title||'').toLowerCase().trim();if(seen.has(k))return true;seen.add(k);return false;});}
  if(pillFilter==='native')base=base.filter(g=>!(g.is_backport||g.backport_text||g.backport));
  else if(pillFilter==='bp')base=base.filter(g=>g.is_backport||g.backport_text||g.backport);
  else if(pillFilter==='dlc')base=base.filter(g=>g.has_dlc||g.is_dlc);
  if(q)base=base.filter(g=>(g.title||'').toLowerCase().includes(q)||(g.ppsa||'').toLowerCase().includes(q));
  if(fw)base=base.filter(g=>{const v=(g.firmware_required||g.firmware||g.backport_text||'').toLowerCase();return v.includes(fw.replace('.xx','').replace('+',' '));});
  if(ext==='backport')base=base.filter(g=>g.is_backport||g.backport_text);
  if(ext==='dlc')base=base.filter(g=>g.has_dlc||g.is_dlc);
  if(ext==='no_meta')base=base.filter(g=>!(g.enrichment?.description));
  if(ext==='no_cover')base=base.filter(g=>!g.cover_local_path);
  if(sortMode.k==='az')base.sort((a,b)=>(a.title||'').localeCompare(b.title||''));
  if(sortMode.k==='za')base.sort((a,b)=>(b.title||'').localeCompare(a.title||''));
  if(sortMode.k==='rating')base.sort((a,b)=>(b.enrichment?.rating||0)-(a.enrichment?.rating||0));
  if(sortMode.k==='size')base.sort((a,b)=>parseSize(b.size)-parseSize(a.size));
  filteredGames=base;
  txt('view-count',filteredGames.length+' games');
  renderGrid();
}
function renderGrid(){
  const grid=$('grid'),pg=$('pagination'),empty=$('empty-state');
  if(!filteredGames.length){
    grid.innerHTML='';
    if(!allGames.length){if(empty){empty.className='empty show';grid.appendChild(empty);}}
    else{grid.innerHTML='<div class="empty show"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><h2>No games match</h2><p>Try adjusting filters.</p></div>';}
    if(pg)pg.style.display='none';return;
  }
  if(empty)empty.className='empty';
  const pp=parseInt($('per-pg')?.value||'12');
  const pages=Math.ceil(filteredGames.length/pp);
  currentPg=Math.max(1,Math.min(currentPg,pages));
  const sl=filteredGames.slice((currentPg-1)*pp,currentPg*pp);
  grid.className=cardMode==='list'?'lm':'';
  grid.innerHTML=sl.map(g=>{
    const ri=riOf(g);
    const hasMeta=!!(g.enrichment?.description);
    const rating=g.enrichment?.rating;
    const fw=g.firmware_required||g.firmware||(g.backport_text&&g.backport_text.match(/[\d]+\.x/i)?.[0])||'';
    const isBp=!!(g.is_backport||g.backport_text||g.backport);
    const isDlc=!!(g.has_dlc||g.is_dlc);
    const isFav=isFavGame(g);
    const isSel=isSelected(g);
    const fwBdg=fw?`<span class="bdg ${isBp?'bg-purple':'bg-green'}">${esc(fw)}</span>`:'';
    const bpBdg=isBp?`<span class="bdg bg-purple">BACKPORT</span>`:'';
    const dlcBdg=isDlc?`<span class="bdg bg-amber">DLC</span>`:'';
    if(cardMode==='list')return`<div class="card${ri===selIdx?' sel':''}${isSel?' msel':''}" onclick="cardClick(${ri},event)" oncontextmenu="cardContext(${ri},event)" id="c${ri}"><div class="msel-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div><div class="card-art"><div class="card-fb" style="background:${grad(ri)};width:100%;height:100%;"></div></div><div class="card-bdgs">${fwBdg}${bpBdg}${dlcBdg}</div><div class="card-info"><div class="card-title">${esc(g.title||'Unknown')}</div><div class="card-meta"><span class="card-ppsa">${esc(g.ppsa||'')}</span><span class="card-sep">*</span><span class="card-sub">${esc(g.version||'')} * ${esc(g.size||'')}</span></div></div>${rating?`<div class="card-rat">* ${parseFloat(rating).toFixed(1)}</div>`:''}</div>`;
    return`<div class="card${ri===selIdx?' sel':''}${isSel?' msel':''}" onclick="cardClick(${ri},event)" oncontextmenu="cardContext(${ri},event)" id="c${ri}">
      <div class="msel-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
      <div class="card-art">
        <img id="ci${ri}" alt="${esc(g.title||'')}" onload="imgOk(this)" onerror="imgErr(this,${ri})">
        <div class="card-fb" id="cf${ri}" style="background:${grad(ri)}">${esc((g.title||'').substring(0,22))}</div>
        <div class="card-bdgs">${fwBdg}${bpBdg}${dlcBdg}</div>
        ${rating?`<div class="card-rat">* ${parseFloat(rating).toFixed(1)}</div>`:''}
        <div class="card-fav${isFav?' on':''}" onclick="event.stopPropagation();toggleFavIdx(${ri})" title="Favorite"><svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
        <div class="card-quick">
          <div class="qb" title="Favorite" onclick="event.stopPropagation();toggleFavIdx(${ri})"><svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
          <div class="qb" title="Open folder" onclick="event.stopPropagation();toast('Open folder: game must be installed')"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
          <div class="qb" title="Re-scrape" onclick="event.stopPropagation();doSelGame(${ri});rescrapeOne()"><svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.09-3"/></svg></div>
          <div class="qb" title="Fetch metadata" onclick="event.stopPropagation();doSelGame(${ri});enrichOne()"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
        </div>
      </div>
      <div class="card-info">
        <div class="card-title">${esc(g.title||'Unknown')}</div>
        <div class="card-meta"><span class="card-ppsa">${esc(g.ppsa||'')}</span><span class="card-sep">*</span><span class="card-sub">${esc(g.version||'')}</span><span class="card-sep">*</span><span class="card-sub">${esc(g.size||'')}</span></div>
        ${!hasMeta?'<div class="card-nm"><svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>No metadata</div>':''}
      </div>
    </div>`;
  }).join('');
  loadCovers(sl);
  if(pg){pg.style.display=pages>1?'':'none';renderPg(pages);}
  updateSelectionBar();
}
function imgOk(img){img.classList.add('loaded');const fb=$('cf'+img.id.slice(2));if(fb)fb.style.display='none';}
function imgErr(img,ri){img.classList.remove('loaded');const g=allGames[ri];if(g?.cover_local_path)loadOneCover(ri);}
function loadCovers(slice){
  const a=api();if(!a)return;
  // Only load covers for the games actually on screen (the current page slice),
  // not the entire filtered set. Loading all of filteredGames fired one backend
  // call per game even though only a page is visible.
  const list=slice||filteredGames;
  list.forEach(g=>{
    const ri=riOf(g);const img=$('ci'+ri);if(!img)return;
    if(g.cover_local_path){a.get_cover_data_url(g.cover_local_path).then(r=>{if(r.ok)img.src=r.data_url;else if(g.cover||g.enrichment?.cover_url)img.src=g.cover||g.enrichment.cover_url;});}
    else if(g.cover||g.enrichment?.cover_url){img.src=g.cover||g.enrichment.cover_url;}
  });
}
function loadOneCover(ri){const a=api(),g=allGames[ri];if(!a||!g?.cover_local_path)return;a.get_cover_data_url(g.cover_local_path).then(r=>{if(r.ok){const img=$('ci'+ri);if(img)img.src=r.data_url;}});}
function renderPg(total){
  const b=$('pgbtns');if(!b)return;
  const atFirst=currentPg<=1, atLast=currentPg>=total;
  // First / Prev
  let h=`<button class="pgbtn pgnav" onclick="chPg(1)" ${atFirst?'disabled':''} title="First page">\u00ab</button>`;
  h+=`<button class="pgbtn pgnav" onclick="chPg(${currentPg-1})" ${atFirst?'disabled':''} title="Previous page">\u2039</button>`;
  // Numbered window (unchanged windowing logic)
  const pgs=[];if(total<=7){for(let i=1;i<=total;i++)pgs.push(i);}
  else{pgs.push(1);if(currentPg>3)pgs.push('...');for(let i=Math.max(2,currentPg-1);i<=Math.min(total-1,currentPg+1);i++)pgs.push(i);if(currentPg<total-2)pgs.push('...');pgs.push(total);}
  pgs.forEach(p=>{h+=p==='...'?`<span class="pgdots">...</span>`:`<button class="pgbtn${p===currentPg?' on':''}" onclick="chPg(${p})">${p}</button>`;});
  // Next / Last
  h+=`<button class="pgbtn pgnav" onclick="chPg(${currentPg+1})" ${atLast?'disabled':''} title="Next page">\u203a</button>`;
  h+=`<button class="pgbtn pgnav" onclick="chPg(${total})" ${atLast?'disabled':''} title="Last page">\u00bb</button>`;
  // Jump-to-page (only worth showing when there are enough pages to warrant it)
  if(total>7){h+=`<span class="pgjump">Page <input type="number" min="1" max="${total}" value="${currentPg}" id="pg-jump" onkeydown="if(event.key==='Enter')pgJump()" onchange="pgJump()"> / ${total}</span>`;}
  b.innerHTML=h;
}
function pgJump(){const el=$('pg-jump');if(!el)return;let p=parseInt(el.value||'1');const pp=parseInt($('per-pg')?.value||'12');const total=Math.max(1,Math.ceil(filteredGames.length/pp));p=Math.max(1,Math.min(p,total));chPg(p);}
function chPg(p){currentPg=p;renderGrid();$('scroll-area')?.scrollTo(0,0);try{localStorage.setItem('er_lastpage_'+SRC,String(p));}catch(e){}}
function doSelGame(ri){selIdx=ri;selGameObj=allGames[ri];if(!selGameObj)return;renderGrid();renderDetail(selGameObj,ri);}
function closeDetail(){selIdx=-1;selGameObj=null;renderGrid();txt('d-title','Select a game');htm('hero-bdgs','');}

// ── Click routing: plain vs Ctrl (toggle) vs Shift (range) ─────────────────
function cardClick(ri,ev){
  const g=allGames[ri];if(!g)return;
  const ctrl=ev&&(ev.ctrlKey||ev.metaKey);
  const shift=ev&&ev.shiftKey;
  if(ctrl){
    // Toggle this row in/out of the selection; don't disturb the detail panel.
    toggleSelectedRi(ri);selAnchor=ri;refreshSelectionUI();return;
  }
  if(shift&&selAnchor>=0){
    // Select the contiguous range (in current filtered order) between the
    // anchor row and this row.
    const fi=filteredGames.indexOf(g);
    const anchorG=allGames[selAnchor];
    const ai=anchorG?filteredGames.indexOf(anchorG):-1;
    if(fi>=0&&ai>=0){
      const lo=Math.min(fi,ai),hi=Math.max(fi,ai);
      for(let i=lo;i<=hi;i++)setSelected(filteredGames[i],true);
      refreshSelectionUI();return;
    }
  }
  // Plain click: clear any multi-selection and open the detail panel.
  if(selectedRows.size){selectedRows.clear();}
  selAnchor=ri;
  doSelGame(ri);
  refreshSelectionUI();
}
function cardContext(ri,ev){
  if(ev){ev.preventDefault();ev.stopPropagation();}
  const g=allGames[ri];if(!g)return;
  // Right-click on an unselected card selects just that card; right-click on a
  // card already in the selection keeps the whole selection.
  if(!isSelectedRi(ri)){selectedRows.clear();setSelectedRi(ri,true);selAnchor=ri;doSelGame(ri);refreshSelectionUI();}
  openContextMenu(ev.clientX,ev.clientY,ri);
}
// Re-apply selection visuals without a full grid re-render where possible, and
// keep the toolbar selection bar in sync.
function refreshSelectionUI(){
  // Update each visible card's selected class.
  document.querySelectorAll('.card').forEach(c=>{
    const id=c.id;if(!id||id[0]!=='c')return;
    const ri=parseInt(id.slice(1));const g=allGames[ri];
    if(!g)return;c.classList.toggle('msel',isSelected(g));
  });
  updateSelectionBar();
}
function updateSelectionBar(){
  const n=selectedCount();
  const bar=$('sel-bar');if(!bar)return;
  if(n>0){bar.style.display='flex';txt('sel-count',n+' selected');}
  else{bar.style.display='none';}
  // Compare is only valid for exactly two.
  const cmp=$('sel-compare');if(cmp)cmp.classList.toggle('disabled',n!==2);
  const ctxCmp=$('ctx-compare');if(ctxCmp)ctxCmp.classList.toggle('disabled',n!==2);
}

// --- Game Updates: Changes Since Last Library Update (item 4) ----------------
function loadLibraryChanges(){
  const body=$('upd-body');const since=$('upd-since');
  if(!body)return;
  // Skeleton while loading (item 2) — feels alive instead of "Loading…".
  body.innerHTML=updSkeleton();
  const a=api();
  if(!a){body.innerHTML='<div class="upd-empty"><div class="upd-empty-t">Not available</div></div>';return;}
  a.library_changes(SRC).then(r=>{
    if(!r||!r.ok){body.innerHTML=`<div class="upd-empty"><div class="upd-empty-t">Could not load changes</div><div class="upd-empty-s">${r&&r.error?esc(r.error):''}</div></div>`;return;}
    if(!r.has_baseline){
      if(since)since.textContent='Changes detected since your previous library update.';
      body.innerHTML=`<div class="upd-empty">
        <div class="upd-empty-ic"><svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.09-3"/></svg></div>
        <div class="upd-empty-t">Recent Changes becomes available after your second library update</div>
        <div class="upd-empty-s">exFAT Ripper saves a snapshot each time you update. Once there are two, this page shows exactly what changed between them.</div>
        <button class="upd-empty-btn" onclick="showView('lib');startScrape('update')"><svg viewBox="0 0 24 24"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>Update Library</button>
      </div>`;
      return;
    }
    const added=r.added||[],removed=r.removed||[],changed=r.changed||[];
    const totalChanges=added.length+removed.length+changed.length;
    // Dynamic subtitle (item 2): "N changes detected since <when>".
    if(since){
      if(!totalChanges){since.textContent='No changes detected since your previous library update.';}
      else{const when=r.since?fmtRelative(r.since):'your previous update';since.textContent=`${totalChanges} change${totalChanges===1?'':'s'} detected since ${when}.`;}
    }
    // Build a lookup of change records by PPSA so the detail panel can show a
    // Change Summary card (no duplication — the cards already hold this data).
    _changeMap={};
    added.forEach(g=>{_changeMap[(g.ppsa||'').toUpperCase()]={kind:'add',g};});
    changed.forEach(g=>{_changeMap[(g.ppsa||'').toUpperCase()]={kind:'chg',g};});
    removed.forEach(g=>{_changeMap[(g.ppsa||'').toUpperCase()]={kind:'rem',g};});
    if(!added.length&&!removed.length&&!changed.length){
      body.innerHTML=`<div class="upd-empty">
        <div class="upd-empty-ic"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
        <div class="upd-empty-t">No changes detected</div>
        <div class="upd-empty-s">Your library is identical to the last snapshot.</div>
      </div>`;
      return;
    }
    let h='';
    if(added.length){
      h+=updSection('Newly Added',added.length,'add',
        added.map(g=>updCard(g,'add')).join(''));
    }
    if(changed.length){
      h+=updSection('Updated',changed.length,'chg',
        changed.map(g=>updCard(g,'chg')).join(''));
    }
    if(removed.length){
      h+=updSection('Removed',removed.length,'rem',
        removed.map(g=>updCard(g,'rem')).join(''));
    }
    body.innerHTML=h;
  }).catch(e=>{body.innerHTML='<div class="upd-empty"><div class="upd-empty-t">Error loading changes</div></div>';});
}
// Skeleton mirrors the card shapes that will appear (item 3 feedback).
function updSkeleton(){
  const card=`<div class="upd-sk-card"><div class="upd-sk-bar" style="width:62%"></div><div class="upd-sk-bar sm" style="width:34%"></div></div>`;
  return `<div class="upd-cards upd-skeleton">${card.repeat(6)}</div>`;
}
function updSection(title,count,kind,inner){
  return `<div class="upd-sec"><div class="upd-sec-hd upd-${kind}"><span class="upd-sec-dot"></span>${esc(title)}<span class="upd-sec-n">${count}</span></div><div class="upd-cards">${inner}</div></div>`;
}
// Scannable badge for a change card (item 5).
function updBadge(label,cls){return `<span class="upd-badge ${cls}">${esc(label)}</span>`;}
function changeBadges(kind,g){
  if(kind==='add')return updBadge('NEW GAME','ub-new');
  if(kind==='rem')return updBadge('REMOVED','ub-rem');
  const ds=g.deltas||[];const b=[];
  if(ds.find(d=>d.type==='version'))b.push(updBadge('NEW VERSION','ub-ver'));
  if(ds.find(d=>d.type==='hosts'))b.push(updBadge('HOSTS UPDATED','ub-host'));
  if(ds.find(d=>d.type==='dlc'))b.push(updBadge('DLC','ub-dlc'));
  if(ds.find(d=>d.type==='metadata'))b.push(updBadge('METADATA','ub-meta'));
  if(ds.find(d=>d.type==='cover'))b.push(updBadge('COVER','ub-cover'));
  return b.join('');
}
// A change is shown as a card (item 4). Clicking opens the existing detail
// panel AND shows a Change Summary card on top (item 3) — context preserved,
// no panel duplication.
function updCard(g,kind){
  const dot={add:'add',chg:'chg',rem:'rem'}[kind];
  const ppsa=esc(g.ppsa||'');
  const badges=changeBadges(kind,g);
  const clickable=kind!=='rem';
  return `<div class="upd-card upd-c-${dot}${clickable?' upd-click':''}" ${clickable?`onclick="openChangeDetail('${ppsa}')"`:''}>
    <div class="upd-card-dot"></div>
    <div class="upd-card-body">
      <div class="upd-card-title">${esc(g.title||'Untitled')}</div>
      ${badges?`<div class="upd-card-badges">${badges}</div>`:''}
    </div>
    ${clickable?'<div class="upd-card-arrow"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div>':''}
  </div>`;
}
function openChangeDetail(ppsa){
  // Find the real game in the current library and open the existing detail panel.
  const idx=allGames.findIndex(g=>(g.ppsa||'').toUpperCase()===String(ppsa).toUpperCase());
  if(idx<0){toast('Game not found in current library');return;}
  const dp=$('detail-panel');if(dp)dp.classList.remove('collapsed');
  selIdx=idx;selGameObj=allGames[idx];
  renderDetail(allGames[idx],idx);          // renders full panel (hides summary)
  renderChangeSummary(ppsa);                // then show the change context on top
}
// Builds the Change Summary card at the top of the detail panel (item 3).
function renderChangeSummary(ppsa){
  const el=$('d-change-summary');if(!el)return;
  const rec=_changeMap[String(ppsa).toUpperCase()];
  if(!rec){el.style.display='none';return;}
  const {kind,g}=rec;
  let title='Updated',rows='';
  if(kind==='add'){title='Added to Library';rows=g.version?csRow('Version','v'+esc(g.version)):'';}
  else{
    const ds=g.deltas||[];
    const verD=ds.find(d=>d.type==='version');
    title=verD?'Version Updated':(ds.find(d=>d.type==='metadata')?'Metadata Refreshed':(ds.find(d=>d.type==='hosts')?'Hosts Updated':'Updated'));
    if(verD)rows+=`<div class="cs-ver"><span class="cs-v-from">v${esc(verD.from)}</span><svg class="cs-v-arr" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg><span class="cs-v-to">v${esc(verD.to)}</span></div>`;
    const hostD=ds.find(d=>d.type==='hosts');
    if(hostD){
      const parts=[];
      if((hostD.added||[]).length)parts.push('+'+hostD.added.length+' '+(hostD.added.length===1?'host':'hosts'));
      if((hostD.removed||[]).length)parts.push('−'+hostD.removed.length+' removed');
      rows+=csRow('Hosts',parts.join(', '));
    }
    const dlcD=ds.find(d=>d.type==='dlc');
    if(dlcD)rows+=csRow('DLC',esc(dlcD.from)+' → '+esc(dlcD.to));
    if(ds.find(d=>d.type==='metadata'))rows+=csRow('Metadata','Updated');
    const coverD=ds.find(d=>d.type==='cover');
    if(coverD)rows+=csRow('Cover',esc(coverD.to).replace(/^\w/,c=>c.toUpperCase()));
  }
  el.innerHTML=`<div class="cs-card cs-${kind}">
    <div class="cs-hd"><span class="cs-dot"></span>Recent Change</div>
    <div class="cs-title">${esc(title)}</div>
    ${rows}
  </div>`;
  el.style.display='';
}
function csRow(label,val){return `<div class="cs-row"><span class="cs-l">${esc(label)}</span><span class="cs-val">${val}</span></div>`;}
function fmtStamp(s){
  // s like "20250629-143022" → "2025-06-29 14:30"
  const m=String(s).match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if(!m)return s;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}
// Human-friendly relative time for the dynamic subtitle (item 2).
// "20250629-143022" → "today" / "yesterday" / "Jun 27" / "Jul 2".
function fmtRelative(s){
  const m=String(s).match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if(!m)return 'your previous update';
  const snap=new Date(+m[1],+m[2]-1,+m[3]);
  const now=new Date();
  const d0=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const s0=new Date(snap.getFullYear(),snap.getMonth(),snap.getDate());
  const days=Math.round((d0-s0)/86400000);
  if(days<=0)return 'today';
  if(days===1)return 'yesterday';
  if(days<7)return days+' days ago';
  const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return MON[snap.getMonth()]+' '+snap.getDate();
}
