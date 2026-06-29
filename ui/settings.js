/* ============================================================================
 * settings.js — settings form, library-actions menu, toolbar reflow
 * ----------------------------------------------------------------------------
 * PURPOSE      Loads/saves the settings form, the Update Library split-button
 *              menu (Refresh/Maintenance/Advanced), and responsive toolbar reflow.
 * PUBLIC       loadSettingsForm, saveSettings, startScrape, toggleScrapeMenu,
 *              repairCovers/rebuildCovers/clearCacheConfirm/repairDb, reflow.
 * DEPENDS ON   app.js (helpers, appState), library.js (loadLibrary).
 * RESPONSIBLE  configuration + maintenance controls; not the actions themselves.
 * ========================================================================== */

function loadSettingsForm(){
  const a=api();if(!a)return;
  a.get_settings().then(r=>{
    if(!r.ok)return;
    const s=r.settings;
    appSettings=s;  // always sync in-memory copy
    const sv=(id,v)=>{const e=$(id);if(!e)return;e.type==='checkbox'?e.checked=!!v:e.value=v||'';};
    sv('s-rawg',s.rawg_api_key);sv('s-igdb-id',s.igdb_client_id);sv('s-igdb-tok',s.igdb_token);
    sv('s-covers-dir',s.covers_folder);sv('s-dl-covers',s.download_covers_on_scrape);
    sv('s-prefer-cache',s.prefer_cached_covers);sv('s-auto-enrich',s.auto_enrich);sv('s-offline',s.offline_mode);
    // Re-evaluate warning after form is populated with real data
    checkApiWarn();
    updateMetaBannerApiWarn();
  });
}
function saveSettings(){
  const a=api();if(!a)return;
  const gv=id=>{const e=$(id);return e?e.type==='checkbox'?e.checked:e.value:null;};
  const newSettings={
    rawg_api_key:gv('s-rawg')||'',igdb_client_id:gv('s-igdb-id')||'',igdb_token:gv('s-igdb-tok')||'',
    covers_folder:gv('s-covers-dir')||'',download_covers_on_scrape:gv('s-dl-covers'),
    prefer_cached_covers:gv('s-prefer-cache'),auto_enrich:gv('s-auto-enrich'),offline_mode:gv('s-offline')
  };
  a.save_settings(newSettings).then(r=>{
    if(r.ok){
      Object.assign(appSettings,newSettings);
      checkApiWarn();
      updateMetaBannerApiWarn();
    }
    toast(r.ok?'Settings saved!':'Save failed',r.ok?'ok':'err');
  });
}
const es=document.createElement('style');
es.textContent=`
/* ── version-grouped download UI ─────────────────────────────────────────── */

/* region wrapper (multi-region games) */
.region-card{border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:12px;background:var(--bg3);}
.region-head{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surf2);border-bottom:1px solid var(--line);font-size:12px;font-weight:700;}
.rh-ppsa{color:var(--acc3);font-family:'JetBrains Mono','Consolas','Courier New',monospace;}
.rh-dot{color:var(--dim);}
.rh-region{color:var(--text2);background:var(--asoft);padding:2px 7px;border-radius:4px;font-size:11px;}
.region-body{padding:10px 12px 12px;}

/* kind chip above each group */
.dl-group{margin-bottom:14px;}
.dl-group:last-child{margin-bottom:0;}
.dl-group-hdr{margin-bottom:6px;}
.kind-chip{display:inline-flex;align-items:center;font-size:9.5px;font-weight:800;padding:3px 9px;border-radius:5px;letter-spacing:.06em;text-transform:uppercase;}
.kc-game{background:var(--asoft);color:var(--acc3);border:1px solid rgba(109,40,217,.2);}
.kc-bp{background:rgba(167,139,250,.1);color:#c4b5fd;border:1px solid rgba(167,139,250,.18);}
.kc-dlc{background:var(--amsoft);color:var(--amber);border:1px solid rgba(245,158,11,.18);}
.kc-upd{background:var(--csoft);color:var(--cyan);border:1px solid rgba(14,165,233,.18);}
.kc-fix{background:var(--gsoft);color:var(--green);border:1px solid rgba(16,185,129,.18);}
.kc-other{background:var(--surf2);color:var(--text2);border:1px solid var(--line2);}

/* version section (collapsible row) */
.bld-section{border:1px solid var(--line2);border-radius:9px;overflow:hidden;margin-bottom:6px;background:var(--bg3);}
.bld-section:last-child{margin-bottom:0;}
.bld-hdr{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;user-select:none;transition:background .1s;}
.bld-hdr:hover{background:var(--surf2);}
.bld-chevron{color:var(--dim);flex-shrink:0;transition:transform .18s;}
.bld-collapsed .bld-chevron{transform:rotate(-90deg);}
.bld-ver{font-size:13px;font-weight:700;color:var(--text);font-family:'JetBrains Mono','Consolas','Courier New',monospace;}
.bld-fw{font-size:10px;font-weight:700;padding:2px 6px;background:var(--csoft);color:var(--cyan);border-radius:4px;}
.bld-grp{font-size:10px;color:var(--dim);}
.bld-old-tag{margin-left:auto;font-size:9.5px;font-weight:700;color:var(--dim);background:var(--surf2);border:1px solid var(--line2);padding:2px 7px;border-radius:4px;letter-spacing:.04em;}
.bld-body{padding:8px 10px 10px;display:flex;flex-direction:column;gap:5px;}
.bld-collapsed .bld-body{display:none;}
.bld-body-plain{display:flex;flex-direction:column;gap:5px;padding:2px 0;}

/* host card */
.dlh-card{background:var(--bg2);border:1px solid var(--line2);border-radius:8px;overflow:hidden;transition:border-color .12s;}
.dlh-card:hover{border-color:rgba(109,40,217,.3);}
.dlh-head{display:flex;align-items:center;gap:9px;padding:8px 11px;}
.dlh-icon{width:32px;height:32px;border-radius:7px;background:#f4f5f8;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06);}
.dlh-fav{width:24px;height:24px;object-fit:contain;display:block;}
.slink{color:var(--acc3);cursor:pointer;font-weight:600;text-decoration:none;}
.slink:hover{text-decoration:underline;}
.dlh-name{flex:1;font-size:13px;font-weight:700;color:var(--text);}
.dlh-badge{font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:99px;background:var(--asoft);color:var(--acc3);flex-shrink:0;}
.dlh-btns{display:flex;gap:5px;flex-shrink:0;}
.dlh-btn{display:flex;align-items:center;gap:4px;padding:5px 10px;border-radius:6px;font-size:11.5px;font-weight:600;cursor:pointer;transition:all .12s;border:1px solid;}
.dlh-btn svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
.dlh-open{background:var(--asoft);border-color:rgba(109,40,217,.28);color:var(--acc3);}
.dlh-open:hover{background:var(--aglow);border-color:rgba(109,40,217,.5);}
.dlh-copy{background:var(--surf2);border-color:var(--line2);color:var(--text2);}
.dlh-copy:hover{border-color:var(--line2);color:var(--text);}

/* multi-part / mirror rows */
.dlh-parts{border-top:1px solid var(--line);}
.dlh-part{display:flex;align-items:center;gap:8px;padding:6px 11px;border-bottom:1px solid var(--line);font-size:11.5px;}
.dlh-part:last-child{border-bottom:none;}
.dlh-part-n{font-size:10px;font-weight:700;color:var(--dim);min-width:52px;flex-shrink:0;}
.dlh-part-url{flex:1;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;font-family:'JetBrains Mono','Consolas','Courier New',monospace;opacity:.7;}
.dlh-pbtn{padding:3px 9px;border-radius:5px;font-size:10.5px;font-weight:600;cursor:pointer;transition:all .1s;border:1px solid;}
.dlh-pbtn-o{background:var(--asoft);border-color:rgba(109,40,217,.22);color:var(--acc3);}
.dlh-pbtn-o:hover{background:var(--aglow);}
.dlh-pbtn-c{background:var(--surf2);border-color:var(--line2);color:var(--text2);}
.dlh-pbtn-c:hover{color:var(--text);}

/* pkg info */
.pkg-info{margin-top:10px;padding:9px 11px;background:var(--bg2);border:1px solid var(--line);border-radius:8px;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:11.5px;}
.pk{color:var(--dim);font-weight:700;}
.pv{color:var(--text2);}
.pv.mono{font-family:'JetBrains Mono','Consolas','Courier New',monospace;color:var(--acc3);}

/* empty state */
.dl-empty{color:var(--dim);font-size:12px;padding:8px 0;}
`;
document.head.appendChild(es);
$('search').addEventListener('input',()=>{currentPg=1;applyFilters();});
$('filter-fw').addEventListener('change',()=>{currentPg=1;applyFilters();});
$('filter-extra').addEventListener('change',()=>{currentPg=1;applyFilters();});
// Live-update API warn banner as user types in settings
document.addEventListener('input',e=>{
  if(e.target.id==='s-rawg'||e.target.id==='s-igdb-id'){
    checkApiWarn();
    updateMetaBannerApiWarn();
  }
});

function toggleScrapeMenu(e){
  e.stopPropagation();
  const menu=document.getElementById('scrape-menu');
  const btn=document.getElementById('lib-btn-wrap')||e.currentTarget.closest('.lib-btn-wrap');
  if(btn){
    const r=btn.getBoundingClientRect();
    // open upward if near bottom of screen, else downward
    const spaceBelow=window.innerHeight-r.bottom;
    if(spaceBelow<180){
      menu.style.top='auto';
      menu.style.bottom=(window.innerHeight-r.top+4)+'px';
    } else {
      menu.style.bottom='auto';
      menu.style.top=(r.bottom+4)+'px';
    }
    menu.style.left=r.left+'px';
    menu.style.width=r.width+'px';
  }
  menu.classList.toggle('open');
}
function closeScrapeMenu(){document.getElementById('scrape-menu')?.classList.remove('open');}
function toggleMoreMenu(e){e.stopPropagation();document.getElementById('more-menu').classList.toggle('open');}
function closeMoreMenu(){document.getElementById('more-menu')?.classList.remove('open');}

/* ── Responsive action toolbar ──────────────────────────────────────────────
   The action buttons (Import/Export/Pegasus/Send to PS5/Backup) share a row
   with the count pills. When the detail panel opens and narrows the row, the
   lowest-priority buttons are moved into a "⋯ More" overflow menu instead of
   being clipped, then restored when space returns. Priority: buttons collapse
   right-to-left (Backup first, Import last). */
const STRIP_PRIORITY=['sb-import','sb-export','sb-pegasus','sb-ftp','sb-backup']; // keep order = visual order; collapse from the end
function toggleStripMore(e){if(e)e.stopPropagation();const m=document.getElementById('strip-more-menu');if(m)m.classList.toggle('show');}
function closeStripMore(){document.getElementById('strip-more-menu')?.classList.remove('show');}
function reflowToolbar(){
  const row=document.getElementById('actions-row');
  const moreWrap=document.getElementById('strip-more-wrap');
  const menu=document.getElementById('strip-more-menu');
  const moreBtn=document.getElementById('sb-more');
  const actions=document.getElementById('strip-actions');
  if(!row||!moreWrap||!menu)return;
  if(viewMode!=='lib')return; // toolbar only shown in library view

  // Reset: all buttons visible, menu empty, More hidden.
  STRIP_PRIORITY.forEach(id=>{const b=document.getElementById(id);if(b)b.style.display='';});
  menu.innerHTML=''; moreWrap.style.display='none';
  if(moreBtn)moreBtn.classList.remove('has-hidden');
  void row.offsetWidth; // flush layout so widths are real

  // The action buttons now have their own full-width row, so the available
  // space is the entire row minus its horizontal padding. Collapsing is only
  // needed at genuinely tiny widths.
  const rs=getComputedStyle(row);
  const avail=row.clientWidth-parseFloat(rs.paddingLeft)-parseFloat(rs.paddingRight);
  const AGAP=5;

  const actionsW=()=>{
    let w=0,count=0;
    for(const id of STRIP_PRIORITY){const b=document.getElementById(id);if(b&&b.style.display!=='none'){const bw=b.getBoundingClientRect().width;if(bw>0){w+=bw;count++;}}}
    if(moreWrap.style.display!=='none'){const mw=moreWrap.getBoundingClientRect().width;if(mw>0){w+=mw;count++;}}
    return w+AGAP*Math.max(0,count-1);
  };

  const collapseOrder=[...STRIP_PRIORITY].reverse(); // backup → … → import
  const moved=[];
  let guard=0;
  if(actionsW()>avail){
    moreWrap.style.display=''; // reserve the More button's space
    void row.offsetWidth;
    // Collapse buttons into More until they fit (all may collapse, leaving just
    // the compact More button) so nothing ever clips.
    while(actionsW()>avail && guard<collapseOrder.length){
      const id=collapseOrder[guard];
      const btn=document.getElementById(id);
      if(btn){btn.style.display='none';moved.push(id);void row.offsetWidth;}
      guard++;
    }
  }

  if(moved.length===0){moreWrap.style.display='none';return;}

  // Build the menu in original visual order.
  moreWrap.style.display='';
  if(moreBtn)moreBtn.classList.add('has-hidden');
  STRIP_PRIORITY.forEach(id=>{
    if(!moved.includes(id))return;
    const btn=document.getElementById(id);
    if(!btn)return;
    const label=btn.getAttribute('data-label')||btn.textContent.trim();
    const svg=btn.querySelector('svg')?.outerHTML||'';
    const item=document.createElement('div');
    item.className='smm-item';
    item.innerHTML=svg+'<span>'+label+'</span>';
    item.onclick=(ev)=>{ev.stopPropagation();closeStripMore();btn.click();};
    menu.appendChild(item);
  });
}
// Re-evaluate the toolbar whenever the content area resizes (e.g. detail panel
// opening/closing) or the window resizes.
let _toolbarRO=null,_toolbarT=null,_lastRowW=0;
function scheduleReflow(){clearTimeout(_toolbarT);_toolbarT=setTimeout(reflowToolbar,60);}
function initToolbarReflow(){
  const row=document.getElementById('actions-row');
  const content=document.getElementById('content-area');
  if('ResizeObserver'in window){
    _toolbarRO=new ResizeObserver(entries=>{
      for(const e of entries){
        const w=Math.round(e.contentRect?e.contentRect.width:0);
        if(Math.abs(w-_lastRowW)>=1){_lastRowW=w;scheduleReflow();}
      }
    });
    if(row)_toolbarRO.observe(row);
    if(content)_toolbarRO.observe(content);
  }
  window.addEventListener('resize',scheduleReflow);
  // Robust cross-environment trigger: poll the toolbar width a few times a
  // second and reflow only when it actually changes. This reliably catches
  // window resizes and the detail-panel collapse in every engine, and is
  // effectively free when nothing moves (just an integer compare).
  let _pollW=-1;
  setInterval(()=>{
    const r=document.getElementById('actions-row');
    if(!r)return;
    const w=Math.round(r.clientWidth);
    if(w&&w!==_pollW){_pollW=w;reflowToolbar();}
  },200);
  setTimeout(reflowToolbar,120);
}
document.addEventListener('click',()=>{closeScrapeMenu();closeMoreMenu();closeStripMore();closeContextMenu();});

