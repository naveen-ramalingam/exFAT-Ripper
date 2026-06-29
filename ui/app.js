/* ============================================================================
 * app.js — core bootstrap, shared helpers, global state, selection, appState
 * ----------------------------------------------------------------------------
 * PURPOSE      Foundational module loaded first. Owns the shared DOM helpers,
 *              global library arrays, the favorites + multi-selection models,
 *              and the global application-state object (appState) that drives
 *              the activity banner, status bar, health widget, and conflict locks.
 * PUBLIC       $, txt, htm, esc, api, toast, appState, setAppState, renderAppState,
 *              setStatus/setProgress (compat shims), selection helpers, favs helpers.
 * DEPENDS ON   nothing (must load before all other UI modules).
 * RESPONSIBLE  shared utilities + global state only; no feature rendering.
 * ========================================================================== */

var SRC='exfat';
// Lightweight error logger — surfaces to console and the in-app log instead of
// silently swallowing exceptions, so issues are diagnosable.
function logErr(where,err){try{console.error('[exFAT Ripper] '+where+':',err);const a=api&&api();if(a&&a.log_error)a.log_error(String(where)+': '+String(err&&err.message||err));}catch(e){}}
var SECTION_ORDER=['GAME','BACKPORT','DLC','DUMP','UPDATE','FIX','OTHER'];
var SORT_MODES=[
  {k:'az',label:'Sort: Title (A-Z)'},
  {k:'za',label:'Sort: Title (Z-A)'},
  {k:'rating',label:'Sort: Top Rated'},
  {k:'size',label:'Sort: Largest First'},
  {k:'recent',label:'Sort: Recently Added'},
];
var allGames=[],filteredGames=[];
// Index map: game object -> its position in allGames. Built once when the
// library loads, so we never pay O(n) allGames.indexOf(g) per card (which at a
// few thousand games made every render quadratic). riOf(g) is the lookup.
var _gameIdx=new Map();
function rebuildGameIndex(){_gameIdx=new Map();allGames.forEach((g,i)=>_gameIdx.set(g,i));}
function riOf(g){const i=_gameIdx.get(g);return i===undefined?-1:i;}
// Favorites are keyed by a STABLE identity (PPSA + version), not array index,
// so they survive re-sorting, additions, and removals. Legacy index-based
// favorites (er_favs) are ignored; the new store is er_favs_v2.
function favKey(g){if(!g)return'';return((g.ppsa||'').toUpperCase().trim())+'|'+((g.version||'').trim());}
var favs=new Set(JSON.parse(localStorage.getItem('er_favs_v2')||'[]'));
function saveFavs(){try{localStorage.setItem('er_favs_v2',JSON.stringify([...favs]));}catch(e){logErr('saveFavs',e);}}
function isFavGame(g){return favs.has(favKey(g));}
function toggleFavGame(g){if(!g)return;const k=favKey(g);if(!k||k==='|')return;if(favs.has(k))favs.delete(k);else favs.add(k);saveFavs();txt('cnt-favs',favs.size);}
// Non-toggling setter for bulk operations (doesn't save on each call — caller
// saves once after the batch for efficiency).
function setFavGameState(g,on){if(!g)return;const k=favKey(g);if(!k||k==='|')return;if(on)favs.add(k);else favs.delete(k);}
var viewMode='lib',filter='all',pillFilter='all';
var cardMode='grid',currentPg=1,sortIdx=0;
var selIdx=-1,selGameObj=null,descExpanded=false;
// ── Multi-selection model ──────────────────────────────────────────────────
// Selection is keyed by the same stable PPSA|version identity favorites use, so
// it survives re-sorting/filtering. selAnchor is the index of the last single
// click, used as the pivot for Shift-range selection. This is separate from the
// single-select detail panel (selIdx/selGameObj), which still drives the
// right-hand panel; multi-select is an additional layer for bulk operations.
// Selection is UI state, not library state. It maps to rows in the current
// filtered view (by their index in allGames, which is stable while the library
// is loaded). It deliberately does NOT use the durable PPSA|version identity
// that favorites use: selection should survive *paging* within a view, but
// vanish when the view context changes (filter / sort / search) — the same way
// Windows Explorer behaves. clearSelectionOnViewChange() enforces that.
// When the future Operation Queue needs persistence, it snapshots the
// PPSA|version identifiers of selectedGames() at enqueue time.
var selectedRows=new Set(); // indices into allGames
var selAnchor=-1;           // allGames index of last single click (range pivot)
function isSelectedRi(ri){return selectedRows.has(ri);}
function isSelected(g){const ri=riOf(g);return ri>=0&&selectedRows.has(ri);}
function selectedGames(){return [...selectedRows].map(ri=>allGames[ri]).filter(Boolean);}
function selectedCount(){return selectedRows.size;}
function clearSelection(){if(!selectedRows.size&&selAnchor<0){return;}selectedRows.clear();selAnchor=-1;refreshSelectionUI();}
function setSelectedRi(ri,on){if(ri<0||!allGames[ri])return;if(on)selectedRows.add(ri);else selectedRows.delete(ri);}
function setSelected(g,on){setSelectedRi(riOf(g),on);}
function toggleSelectedRi(ri){setSelectedRi(ri,!selectedRows.has(ri));}
// Called whenever the filtered view itself changes (filter, sort, or search) —
// NOT on paging. Selection is scoped to a view, so a context change clears it.
function clearSelectionOnViewChange(){if(selectedRows.size||selAnchor>=0){selectedRows.clear();selAnchor=-1;}}
var appSettings={};
var $=id=>document.getElementById(id);
var txt=(id,t)=>{const e=$(id);if(e)e.textContent=t;};
var htm=(id,h)=>{const e=$(id);if(e)e.innerHTML=h;};
var esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
var parseSize=s=>{if(!s)return 0;const m=String(s).match(/([\d.]+)\s*(GB|MB|TB)?/i);if(!m)return 0;const n=parseFloat(m[1]),u=(m[2]||'').toUpperCase();return u==='TB'?n*1000:u==='MB'?n/1000:n;};
var GRAD=['linear-gradient(160deg,#1a0a3a,#0a1a3a)','linear-gradient(160deg,#1a0808,#2a0a0a)','linear-gradient(160deg,#0a1a2a,#1a2a0a)','linear-gradient(160deg,#0a0a1a,#1a0a1a)','linear-gradient(160deg,#1a1208,#081218)','linear-gradient(160deg,#0a1a0a,#0a2a1a)','linear-gradient(160deg,#1a0818,#0a1818)'];
var grad=i=>GRAD[i%GRAD.length];
function api(){return window.pywebview?.api||null;}
function whenApiReady(cb){if(api()){cb();return;}const t=setInterval(()=>{if(api()){clearInterval(t);cb();}},100);}
function isSafeUrl(u){try{const p=new URL(u);return p.protocol==='http:'||p.protocol==='https:';}catch(e){return false;}}
function openExt(u){if(!isSafeUrl(u)){toast('Blocked unsafe link','err');return;}const a=api();if(a)a.open_url(u);else window.open(u,'_blank','noopener');}
var toastT=null;
function toast(msg,type=''){
  const el=$('toast');
  clearTimeout(toastT);
  if(type==='critical'){
    // Critical errors (disk full, auth failure) must NOT auto-dismiss — they
    // stay until the user acknowledges them. Distinct red styling + close btn.
    el.innerHTML='<span class="toast-msg"></span><button class="toast-x" onclick="dismissToast()" title="Dismiss">&times;</button>';
    el.querySelector('.toast-msg').textContent=msg;
    el.className='toast show critical';
    return;
  }
  el.textContent=msg;
  el.className='toast show'+(type?' '+type:'');
  toastT=setTimeout(()=>el.className='toast',2900);
}
function dismissToast(){const el=$('toast');if(el){el.className='toast';el.textContent='';}}
// Show an error, auto-escalating genuinely critical conditions (disk full,
// permission denied, etc.) to the persistent `critical` tier so they can't be
// missed. Ordinary errors use the normal transient `err` toast.
function errToast(msg){
  const m=String(msg||'Failed');
  const low=m.toLowerCase();
  const critical=/no space|space left|disk full|errno 28|enospc|permission denied|errno 13|read-only|read only|access is denied|out of memory/.test(low);
  toast(m,critical?'critical':'err');
}
// ── Global application state ────────────────────────────────────────────────
// ONE shared object that holds "what is the app doing right now". Every surface
// (status bar, health widget, page activity banner, conflicting-button disabled
// state) reads from this — instead of being mutated ad-hoc from many places.
// This is not a new subsystem or event bus: it's one object + one render
// function, fed by the existing onScrapeProgress channel.
var appState={
  status:'idle',        // idle | working | paused | waiting | completed | failed
  operation:null,       // { name, current, total, currentItem, pct, etaSec } | null
};
// Maintenance actions that conflict with an active operation (they touch the
// library/cover/db resource an operation owns). Disabled while status==='working'.
var CONFLICTING_BTN_IDS=['scrape-btn','mfb-btn'];
var CONFLICTING_SETTINGS_FNS=['repairCovers','rebuildCovers','clearCacheConfirm','enrichAll','repairDb','startScrape'];

function setAppState(status,operation){
  appState.status=status;
  appState.operation=operation||null;
  renderAppState();
}
function appBusy(){return appState.status==='working'||appState.status==='waiting';}

// The single function that updates EVERY state-reflecting surface from appState.
function renderAppState(){
  const op=appState.operation;
  const working=appBusy();
  // 1) Bottom status bar
  const sEl=$('sbar-s');
  if(sEl){
    if(working){sEl.innerHTML='<span class="dot-a"></span><span>'+esc(op?.name||op?.message||'Working...')+'</span>';}
    else{sEl.innerHTML='<span class="dot-g"></span><span id="sbar-txt">Ready</span>';}
  }
  // 2) Status-bar progress strip
  const prog=$('sbar-prog'),bar=$('tb-pf');
  if(working&&op){
    if(prog)prog.style.display='';
    const pct=op.pct||0;
    if(bar)bar.style.width=Math.min(100,pct)+'%';
    const fill=$('prog-fill');if(fill)fill.style.width=Math.min(100,pct)+'%';
    txt('prog-lbl',op.currentItem?op.name+' — '+op.currentItem:(op.name||op.message||''));
    txt('prog-pct',Math.round(pct)+'%');
    txt('prog-extra',op.total>0?op.current+' / '+op.total:'');
  }else{
    if(prog)prog.style.display='none';
    if(bar)bar.style.width='0%';
  }
  // 3) Page activity banner (shared across every page)
  renderActivityBanner();
  // 4) Conflicting maintenance buttons: disabled-with-reason while working
  renderConflictLocks();
  // 5) Health widget reflects activity honestly while working; when idle it is
  //    restored to its normal library-health readout (computed from the loaded
  //    library, so it's correct even before loadLibrary()'s async refresh).
  const hwStatus=$('hw-status');
  if(hwStatus){
    if(working){hwStatus.textContent=op?.name||'Working…';}
    else if(typeof updateHealthWidget==='function'&&(window.allGames&&allGames.length)){updateHealthWidget();}
  }
}

// The compact banner that appears on EVERY page while work runs, and vanishes
// when idle. One component; pages don't implement their own.
function renderActivityBanner(){
  let banner=$('app-activity-banner');
  const op=appState.operation;
  const working=appBusy();
  if(!working||!op){if(banner)banner.style.display='none';return;}
  if(!banner)return; // banner element is in the DOM (added once); guard anyway
  banner.style.display='flex';
  const etaStr=op.etaSec>0?fmtEtaShort(op.etaSec):'';
  banner.innerHTML=
    '<span class="aab-spin"></span>'+
    '<span class="aab-name">'+esc(op.name||'Working')+'</span>'+
    (op.currentItem?'<span class="aab-sep">·</span><span class="aab-item">'+esc(op.currentItem)+'</span>':'')+
    (op.total>0?'<span class="aab-sep">·</span><span class="aab-count">'+op.current+' / '+op.total+'</span>':'')+
    (op.pct>0?'<span class="aab-sep">·</span><span class="aab-pct">'+Math.round(op.pct)+'%</span>':'')+
    (etaStr?'<span class="aab-sep">·</span><span class="aab-eta">ETA '+etaStr+'</span>':'');
}

function fmtEtaShort(s){s=s||0;if(s<=0)return '';const m=Math.floor(s/60),sec=s%60;return m+':'+String(sec).padStart(2,'0');}

// Disable conflicting maintenance actions while an operation owns the resource,
// and show WHY (a reason), rather than allowing the click then erroring.
function renderConflictLocks(){
  const working=appBusy();
  const reason=working?('Unavailable — '+(appState.operation?.name||'an operation')+' currently running'):'';
  // Buttons referenced by id
  CONFLICTING_BTN_IDS.forEach(id=>{
    const b=$(id);if(!b)return;
    b.disabled=working;
    if(working){b.classList.add('locked');b.title=reason;}
    else{b.classList.remove('locked');b.title='';}
  });
  // Settings/menu actions referenced by their onclick fn name
  document.querySelectorAll('[onclick]').forEach(el=>{
    const oc=el.getAttribute('onclick')||'';
    const conflicts=CONFLICTING_SETTINGS_FNS.some(fn=>oc.includes(fn+'('));
    if(!conflicts)return;
    if(working){el.classList.add('locked');el.setAttribute('data-lock-reason',reason);el.title=reason;}
    else{el.classList.remove('locked');el.removeAttribute('data-lock-reason');if(el.title===reason)el.title='';}
  });
}

// ── Compatibility shims: existing call sites keep working, now via appState ──
// Many functions call setStatus(busy,msg)/setProgress(pct,label). Rather than
// touch all 9 sites, these now write into appState. onScrapeProgress carries the
// rich per-operation detail; these shims handle the simpler boolean calls.
function setStatus(busy,msg=''){
  if(busy){
    // Preserve any richer operation already set by onScrapeProgress; otherwise
    // create a minimal operation from the message.
    if(appState.status==='working'&&appState.operation){
      if(msg)appState.operation.name=msg;
      renderAppState();
    }else{
      setAppState('working',{name:msg||'Working...',current:0,total:0,currentItem:'',pct:0,etaSec:0});
    }
  }else{
    setAppState('idle',null);
  }
}
function setProgress(pct,label,extra){
  if(pct<=0&&!label){ // clear
    if(appState.operation){appState.operation.pct=0;}
    renderAppState();return;
  }
  if(!appState.operation)appState.operation={name:label||'',current:0,total:0,currentItem:'',pct:0,etaSec:0};
  appState.operation.pct=Math.min(100,pct);
  if(label)appState.operation.name=label;
  renderAppState();
}

window.onScrapeProgress=function(d){
  // The rich channel — populate the full operation from the enriched payload.
  const pct=d.total>0?(d.current/d.total*100):(d.pct||0);
  setAppState('working',{
    name:d.name||d.message||'Working...',
    message:d.message||'',
    current:d.current||0,
    total:d.total||0,
    currentItem:d.current_item||'',
    pct:pct,
    etaSec:d.eta||0,
  });
};
window.onScrapeDone=function(d){
  setAppState('idle',null);
  if(d.ok){toast(d.message,'ok');loadLibrary();}else errToast(d.message||'Failed');
  const b=$('scrape-btn');if(b)b.disabled=false;
};
window.onAppEvent=function(n){if(n==='library_updated')loadLibrary();};

