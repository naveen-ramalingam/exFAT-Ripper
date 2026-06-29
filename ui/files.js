/* ============================================================================
 * files.js — game detail panel and the Files tab (host links)
 * ----------------------------------------------------------------------------
 * PURPOSE      Renders the right-hand detail panel for a selected game and the
 *              Files tab that groups decrypted download links by host/version.
 * PUBLIC       renderDetail, renderLinks, openGallery, copyAll/openAll, enrichOne,
 *              rescrapeOne, doImport/doExport/doExportPegasus, FTP send modal.
 * DEPENDS ON   app.js (helpers, globals), library.js (loadLibrary).
 * RESPONSIBLE  per-game detail + links presentation; not the grid.
 * ========================================================================== */

function renderDetail(g,ri){
  // Hide any prior change-summary card; openChangeDetail re-shows it when the
  // panel was opened from the Recent Changes view.
  const csum=$('d-change-summary');if(csum)csum.style.display='none';
  const hbg=$('d-hbg');
  if(hbg){
    const a=api();
    if(g.cover_local_path&&a){a.get_cover_data_url(g.cover_local_path).then(r=>{if(r.ok)hbg.innerHTML=`<img src="${r.data_url}" style="width:100%;height:100%;object-fit:cover;display:block;" alt="">`;});}
    else if(g.cover||g.enrichment?.cover_url){hbg.innerHTML=`<img src="${esc(g.cover||g.enrichment.cover_url)}" style="width:100%;height:100%;object-fit:cover;display:block;" alt="" onerror="this.style.display='none'">`;hbg.style.background=grad(ri);}
    else{hbg.innerHTML='';hbg.style.background=grad(ri);}
  }
  const fw=g.firmware_required||g.firmware||'';
  const isBp=!!(g.is_backport||g.backport_text||g.backport);
  const isDlc=!!(g.has_dlc||g.is_dlc);
  const bdgs=[fw?`<span class="hb ${isBp?'hb-bp':'hb-fw'}">${esc(fw)}</span>`:'',isBp?`<span class="hb hb-bp">BACKPORT</span>`:'',isDlc?`<span class="hb hb-dlc">DLC</span>`:'',!isBp&&fw?`<span class="hb hb-ok">* Playable</span>`:''].join('');
  htm('hero-bdgs',bdgs);
  const dv=$('d-verified');if(dv)dv.style.display='none';
  const fb=$('fav-btn');if(fb)fb.className='d-fbtn'+(isFavGame(allGames[ri])?' on':'');
  txt('d-title',g.title||g.scraped_title||'Unknown');
  const en=g.enrichment||{};
  const sub=[en.developer,en.publisher].filter(Boolean).join(' * ');
  txt('d-sub',sub||'');
  const rating=en.rating;
  if(rating){
    const r=parseFloat(rating);let stars='<div class="stars">';
    for(let i=1;i<=5;i++)stars+=`<span class="star${i>r&&i-r>0.5?' e':''}">${i<=Math.ceil(r)?'*':'o'}</span>`;
    stars+='</div>';
    htm('d-sr',`${stars}<span class="d-rnum">${r.toFixed(1)}</span>${en.rating_count?`<span class="d-rvotes">${en.rating_count} votes</span>`:''}`);
  }else{htm('d-sr','<span style="font-size:11px;color:var(--dim)">No rating yet</span>');}
  txt('d-ppsa',g.ppsa||'-');txt('d-ver',g.version||'-');txt('d-size',g.size||'-');txt('d-region',g.region||'-');
  txt('d-fw',fw||'-');txt('d-bpfw',g.backport_firmware||g.backport_text||(isBp?'Yes':'-'));
  const meta=en.metacritic,oc=en.opencritic,rpt=en.playtime;
  const ptTip='Estimated playtime provided by RAWG. This is not HowLongToBeat data.';
  const scH=[meta?`<div class="dscore mc"><span class="dscv">${meta}</span><span class="dscl">Metacritic</span></div>`:'',oc?`<div class="dscore oc"><span class="dscv">${oc}</span><span class="dscl">OpenCritic</span></div>`:'',rpt?`<div class="dscore hltb" title="${ptTip}"><span class="dscv">${rpt}h</span><span class="dscl">Est. Playtime <span class="dsc-i">&#9432;</span></span></div>`:''].join('');
  htm('d-scores',scH);$('d-scores').style.display=scH?'':'none';
  const richItems=[
    {icon:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',l:'Developer',v:en.developer},
    {icon:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',l:'Publisher',v:en.publisher},
    {icon:'<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>',l:'Genres',v:(en.genres||[]).slice(0,3).join(', ')},
    {icon:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',l:'Play Modes',v:en.play_modes||'Single Player'},
    {icon:'<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',l:'Languages',v:en.languages||''},
    {icon:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',l:'Release Date',v:en.release_date},
  ].filter(item=>item.v);
  htm('d-rg',richItems.map(item=>`<div class="dri"><svg viewBox="0 0 24 24">${item.icon}</svg><div><div class="dri-l">${esc(item.l)}</div><div class="dri-v">${esc(item.v)}</div></div></div>`).join(''));
  const rawCreds=g.credits||g.uploader||'';
  let credsStr='';
  if(Array.isArray(rawCreds)){
    const hasRoles=rawCreds.some(c=>typeof c==='object'&&(c.role||c.type));
    if(hasRoles){credsStr=rawCreds.map(c=>{if(typeof c==='object'){const role=c.role||c.type||'';const name=c.name||c.handle||c.title||'?';return role?(role+': '+name):name;}return String(c);}).filter(Boolean).join('  ·  ');}
    else{credsStr=rawCreds.map(c=>typeof c==='object'?(c.name||c.handle||c.title||Object.values(c).filter(v=>typeof v==='string'&&v.trim()).join(' ')||null):String(c)).filter(Boolean).join(', ');}
  } else if(typeof rawCreds==='object'&&rawCreds!==null){
    // Shape: {"files":"SiESPTA","backport":"BestPig","dlc":""} — render labelled rows
    const CRED_LABELS={files:'Files',backport:'Backport',dlc:'DLC',uploader:'Uploader',credits:'Credits'};
    const parts=[];
    for(const [k,v] of Object.entries(rawCreds)){
      if(v&&String(v).trim()){
        const label=CRED_LABELS[k.toLowerCase()]||k.charAt(0).toUpperCase()+k.slice(1);
        parts.push(label+': '+String(v).trim());
      }
    }
    credsStr=parts.join('  ·  ');
  } else {
    credsStr=String(rawCreds||'');
  }
  const credsEl=$('d-creds');
  if(credsStr&&credsEl){credsEl.style.display='';txt('d-creds-v',credsStr);}else if(credsEl)credsEl.style.display='none';
  const desc=en.description||g.description||'';
  const descEl=$('d-desc');
  if(descEl){descEl.textContent=desc||'No description available. Click "Retry" to fetch metadata.';descEl.classList.remove('expanded');descExpanded=false;const rmBtn=$('rm-btn');if(rmBtn){rmBtn.style.display=desc.length>160?'':'none';rmBtn.textContent='Read More';}}
  const nmb=$('d-nmb');if(nmb)nmb.style.display=!en.description?'':'none';
  htm('d-genres',(en.genres||[]).map(gn=>`<span class="gtag">${esc(gn)}</span>`).join(''));
  // Provider attribution chip. Metadata, screenshots, trailer, ratings and
  // playtime currently all come from one provider (RAWG); a single clear chip
  // is honest without cluttering the panel. If more providers are added later,
  // this can split per-field.
  const src=en.source?String(en.source).toUpperCase():'';
  txt('d-esrc','');
  const esrcEl=$('d-esrc');
  if(esrcEl){
    esrcEl.innerHTML=src?`<span class="prov-chip" title="Metadata, screenshots & trailer provided by ${esc(src)}">${esc(src)}</span>${en.release_date?`<span class="d-esrc-date">${esc(en.release_date)}</span>`:''}`:'';
  }
  const shots=en.screenshots||[];
  const shotPh='<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
  const extra=shots.length-4;  // how many beyond the 4 visible tiles
  htm('d-shots',shots.length?shots.slice(0,4).map((s,si)=>{
    // On the 4th tile, if there are more screenshots, show a "+N" overlay
    // (Steam/Playnite style) that opens the full gallery.
    const overlay=(si===3&&extra>0)?`<div class="shot-more">+${extra}</div>`:'';
    return `<div class="shot" onclick="openGallery(${si})"><img src="${esc(s)}" alt="" loading="lazy">${overlay}</div>`;
  }).join(''):`<div class="shot-ph">${shotPh}</div><div class="shot-ph">${shotPh}</div>`);
  renderTrailer(en.trailer,g.title||g.scraped_title||'');
  switchTab(0,document.querySelector('.d-tabs .dtab'));
  htm('dtab-files','<div style="color:var(--dim);font-size:12px;padding:4px 0;">Click to load links...</div>');
}
function toggleDesc(){descExpanded=!descExpanded;const el=$('d-desc');if(!el)return;el.classList.toggle('expanded',descExpanded);const btn=$('rm-btn');if(btn)btn.textContent=descExpanded?'Show Less':'Read More';}
function switchTab(i,el){
  document.querySelectorAll('.dtab').forEach((t,j)=>t.classList.toggle('on',j===i));
  ['dtab-about','dtab-files','dtab-shots','dtab-log'].forEach((id,j)=>{const e=$(id);if(e)e.className=j===i?'show':'';});
  if(i===1&&selIdx>=0)loadLinks();
}
function loadLinks(){
  const a=api();if(!a||selIdx<0)return;
  htm('dtab-files','<div style="color:var(--dim);font-size:12px;">Resolving links...</div>');
  a.get_links(selIdx,SRC).then(res=>{if(!res?.ok){htm('dtab-files',`<div style="color:var(--dim);font-size:12px;">Could not resolve: ${esc(res?.error||'')}</div>`);return;}renderLinks(res);});
}
/* renderLinks - preserved exactly */
/* ================================================================
   FILES TAB — version-grouped download renderer
   Data shape per build: { kind, title, version, firmware,
                           release_group, hosts:[{host, links:[{url,part}]}] }
================================================================ */

/* ── host icon / label helpers ───────────────────────────────────────────── */
// Emoji fallbacks (shown if a host's favicon image fails to load).
const HOST_ICONS={
  akirabox:'📦',vikingfile:'⚓',datanodes:'💾',filekeeper:'🗄',datavault:'🔐',
  mediafire:'🔥','1fichier':'🗂',gofile:'🌐',pixeldrain:'🖥',buzzheavier:'🐝',
  ddownload:'⬇',rapidgator:'⚡',nitroflare:'⚡',uploaded:'☁',
  uptobox:'📤',filefactory:'🏭',turbobit:'⚡',hitfile:'🎯',
  filejoker:'🃏',katfile:'🐱',fileal:'📂',bowfile:'🎳',
  default:'🔗'
};
// Real host favicon / logo URLs.
const HOST_FAVICONS={
  akirabox:'https://akirabox.com/themes/basic/images/favicon.ico',
  vikingfile:'https://vikingfile.com/favicon.svg',
  datanodes:'https://datanodes.to/favicon.ico',
  filekeeper:'https://filekeeper.net/images/FileKeeper.png',
  datavault:'https://datavaults.co/images/logo.png'
};
function hostKey(name){
  return (name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
}
function hostEmoji(name){
  const k=hostKey(name);
  for(const [p,ico] of Object.entries(HOST_ICONS)){if(p!=='default'&&k.includes(p))return ico;}
  return HOST_ICONS.default;
}
function hostFavicon(name){
  const k=hostKey(name);
  for(const [p,url] of Object.entries(HOST_FAVICONS)){if(k.includes(p))return url;}
  return '';
}
// Returns an <img> of the host's real favicon, falling back to the emoji on
// load error. Used in the download-link host cards.
function hostIcon(name){
  const fav=hostFavicon(name);
  const emoji=hostEmoji(name);
  if(fav){
    return `<img class="dlh-fav" src="${fav}" alt="" `+
           `onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${emoji}'}))">`;
  }
  return emoji;
}
function hostLabel(raw){
  if(!raw||!String(raw).trim())return'Unknown Host';
  // prettify known names
  const PRETTY={
    akirabox:'Akirabox',vikingfile:'VikingFile',datanodes:'Datanodes',
    filekeeper:'FileKeeper',datavault:'DataVault',
    mediafire:'MediaFire','1fichier':'1Fichier',gofile:'GoFile',
    pixeldrain:'PixelDrain',buzzheavier:'BuzzHeavier',ddownload:'DDownload',
    rapidgator:'RapidGator',nitroflare:'NitroFlare',uploaded:'Uploaded',
    uptobox:'UpToBox',filefactory:'FileFactory',turbobit:'TurboBit',
    hitfile:'HitFile',filejoker:'FileJoker',katfile:'KatFile',
    fileal:'FileAl',bowfile:'BowFile'
  };
  const k=String(raw).trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  for(const [p,nice] of Object.entries(PRETTY)){if(k.includes(p))return nice;}
  // fallback: capitalise each word
  return String(raw).trim().replace(/\b\w/g,c=>c.toUpperCase());
}

/* ── version parsing ─────────────────────────────────────────────────────── */
function parseVer(str){
  // e.g. "v01.006" -> [1,6], "v01.002" -> [1,2], "" -> null
  if(!str)return null;
  const m=String(str).match(/v?(\d+)[._](\d+)/i);
  if(!m)return null;
  return parseInt(m[1])*100000+parseInt(m[2]);
}
function versionFromBuild(b){
  // version field first, then parse from title
  if(b.version&&b.version.trim())return b.version.trim();
  const m=(b.title||'').match(/\(([^)]+)\)/);
  return m?m[1].trim():'';
}

/* ── host card renderer ──────────────────────────────────────────────────── */
function renderPkgInfo(info){
  if(!info)return'';
  const rows=[],add=(k,v,m)=>{if(v&&String(v).trim())rows.push(`<span class="pk">${k}</span><span class="pv${m?' mono':''}">${esc(String(v))}</span>`);};
  add('Password',info.password,true);add('Note',info.note);add('Uploaded by',info.uploader);
  return rows.length?`<div class="pkg-info">${rows.join('')}</div>`:'';
}
function renderOneHost(h){
  if(!h||!Array.isArray(h.links))return'';
  const links=h.links.filter(l=>l&&String(l.url||'').trim());
  if(!links.length)return'';
  const name=hostLabel(h.host);
  const icon=hostIcon(h.host);
  const count=links.length;
  const isMultiPart=links.some(l=>l.part&&l.part>1);
  const isMultiMirror=count>1&&!isMultiPart;
  const badgeTxt=count>1?(isMultiPart?`${count} parts`:`${count} mirrors`):null;

  if(count===1){
    const enc=encodeURIComponent(links[0].url);
    return`<div class="dlh-card">
      <div class="dlh-head">
        <span class="dlh-icon">${icon}</span>
        <span class="dlh-name">${esc(name)}</span>
        <div class="dlh-btns">
          <button class="dlh-btn dlh-open" onclick="openUrl('${enc}')">
            <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Open
          </button>
          <button class="dlh-btn dlh-copy" onclick="copyUrl('${enc}')">
            <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy
          </button>
        </div>
      </div>
    </div>`;
  }

  // multi: expandable rows
  const allEnc=encodeURIComponent(JSON.stringify(links.map(l=>l.url)));
  let rows='';
  links.forEach((lnk,i)=>{
    const lbl=isMultiPart?`Part ${lnk.part||i+1}`:`Mirror ${i+1}`;
    const enc=encodeURIComponent(lnk.url);
    rows+=`<div class="dlh-part">
      <span class="dlh-part-n">${esc(lbl)}</span>
      <span class="dlh-part-url" title="${esc(lnk.url)}">${esc(lnk.url)}</span>
      <button class="dlh-pbtn dlh-pbtn-o" onclick="openUrl('${enc}')">Open</button>
      <button class="dlh-pbtn dlh-pbtn-c" onclick="copyUrl('${enc}')">Copy</button>
    </div>`;
  });
  return`<div class="dlh-card dlh-multi">
    <div class="dlh-head">
      <span class="dlh-icon">${icon}</span>
      <span class="dlh-name">${esc(name)}</span>
      ${badgeTxt?`<span class="dlh-badge">${badgeTxt}</span>`:''}
      <div class="dlh-btns">
        <button class="dlh-btn dlh-open" onclick="openAll('${allEnc}')">
          <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Open All
        </button>
        <button class="dlh-btn dlh-copy" onclick="copyAll('${allEnc}')">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy All
        </button>
      </div>
    </div>
    <div class="dlh-parts">${rows}</div>
  </div>`;
}

/* ── build section renderer (one version row) ────────────────────────────── */
function renderBuildSection(builds, sectionId, collapsed){
  // builds: array of build objects with same kind+version group
  // collect all hosts across them (e.g. a GAME and its UPDATE in same version)
  const allHosts=[];
  let fw='', grp='', ver='', kind='GAME';
  builds.forEach(b=>{
    kind=b.kind||kind;
    if(!ver)ver=versionFromBuild(b);
    if(!fw&&b.firmware)fw=b.firmware;
    if(!grp&&b.release_group)grp=b.release_group;
    (b.hosts||[]).forEach(h=>{
      if(h&&Array.isArray(h.links)&&h.links.some(l=>l&&l.url))allHosts.push(h);
    });
  });
  if(!allHosts.length)return'';
  const hostCards=allHosts.map(h=>renderOneHost(h)).filter(Boolean).join('');
  if(!hostCards)return'';

  const metaBits=[];
  if(fw)metaBits.push(`<span class="bld-fw">FW ${esc(fw)}</span>`);
  if(grp)metaBits.push(`<span class="bld-grp">@${esc(grp)}</span>`);
  const metaHtml=metaBits.join('');

  const bodyId='blds-'+sectionId;
  return`<div class="bld-section${collapsed?' bld-collapsed':''}">
    <div class="bld-hdr" onclick="toggleBldSection('${bodyId}',this)">
      <span class="bld-chevron"><svg viewBox="0 0 24 24" width="12" height="12"><polyline points="6 9 12 15 18 9" stroke="currentColor" fill="none" stroke-width="2.2" stroke-linecap="round"/></svg></span>
      <span class="bld-ver">${esc(ver||'—')}</span>
      ${metaHtml}
      ${collapsed?'<span class="bld-old-tag">Older Version</span>':''}
    </div>
    <div class="bld-body" id="${bodyId}">${hostCards}</div>
  </div>`;
}

/* ── kind badge ──────────────────────────────────────────────────────────── */
function kindChip(kind, title){
  const map={GAME:'kc-game',BACKPORT:'kc-bp',DLC:'kc-dlc',UPDATE:'kc-upd',FIX:'kc-fix',OTHER:'kc-other'};
  const cls=map[kind]||'kc-other';
  // strip version from title for the chip label — it's shown elsewhere
  const lbl=(title||kind||'?').replace(/\s*\([^)]*\)/,'').trim();
  return`<span class="kind-chip ${cls}">${esc(lbl)}</span>`;
}

/* ── main renderLinks ────────────────────────────────────────────────────── */
function renderLinks(data){
  const area=$('dtab-files');
  if(!area)return;
  const regions=(data&&data.regions)||[];
  if(!regions.length){
    area.innerHTML='<div class="dl-empty">No download links found.</div>';
    return;
  }
  const multi=data.multi_region&&regions.length>1;
  let html='';

  regions.forEach((r,ri)=>{
    const builds=(r.builds||[]).filter(b=>b&&(b.hosts||[]).some(h=>h&&(h.links||[]).some(l=>l&&l.url)));
    if(!builds.length)return;

    /* ── split by kind ── */
    const KIND_ORDER=['GAME','UPDATE','FIX','BACKPORT','DLC','OTHER'];
    const byKind={};
    builds.forEach(b=>{
      const k=b.kind||'OTHER';
      (byKind[k]=byKind[k]||[]).push(b);
    });

    let regionBody='';

    /* ── render GAME + UPDATE + FIX grouped by version (newest first) ── */
    const versionedKinds=['GAME','UPDATE','FIX'];
    const versionedBuilds=builds.filter(b=>versionedKinds.includes(b.kind||''));

    if(versionedBuilds.length){
      // group by version string
      const byVer={};
      versionedBuilds.forEach(b=>{
        const v=versionFromBuild(b)||'__unknown__';
        (byVer[v]=byVer[v]||[]).push(b);
      });
      // sort versions newest first
      const sortedVers=Object.keys(byVer).sort((a,b)=>{
        const pa=parseVer(a),pb=parseVer(b);
        if(pa===null&&pb===null)return 0;
        if(pa===null)return 1;
        if(pb===null)return -1;
        return pb-pa;
      });
      sortedVers.forEach((ver,vi)=>{
        const grpBuilds=byVer[ver];
        const isLatest=vi===0;
        const sid=`r${ri}v${vi}`;
        const sectionHtml=renderBuildSection(grpBuilds,sid,!isLatest);
        if(sectionHtml){
          // chip uses the first build's kind+title
          const representativeKind=grpBuilds[0].kind||'GAME';
          const verLabel=ver==='__unknown__'?'Unknown Version':ver;
          regionBody+=`<div class="dl-group">
            <div class="dl-group-hdr">${kindChip(representativeKind,representativeKind==='GAME'?'Game':representativeKind)}</div>
            ${sectionHtml}
          </div>`;
        }
      });
    }

    /* ── render BACKPORT, DLC, OTHER separately (no version grouping) ── */
    ['BACKPORT','DLC','OTHER'].forEach(kind=>{
      const kBuilds=(byKind[kind]||[]);
      if(!kBuilds.length)return;
      kBuilds.forEach((b,bi)=>{
        const allHosts=(b.hosts||[]).filter(h=>h&&(h.links||[]).some(l=>l&&l.url));
        if(!allHosts.length)return;
        const hostCards=allHosts.map(h=>renderOneHost(h)).filter(Boolean).join('');
        if(!hostCards)return;
        const fw=b.firmware||'';const grp=b.release_group||'';
        const metaBits=[];
        if(fw)metaBits.push(`<span class="bld-fw">FW ${esc(fw)}</span>`);
        if(grp)metaBits.push(`<span class="bld-grp">@${esc(grp)}</span>`);
        regionBody+=`<div class="dl-group">
          <div class="dl-group-hdr">${kindChip(b.kind,b.title)}</div>
          <div class="bld-section">
            <div class="bld-body-plain">${metaBits.join('')}${hostCards}</div>
          </div>
        </div>`;
      });
    });

    if(!regionBody)return;
    regionBody+=renderPkgInfo(r.info);

    if(multi){
      const pts=(r.label||'').split(' – ');
      const ppsa=pts[0]||r.label||'';
      const reg=pts.slice(1).join(' – ')||r.region||'';
      html+=`<div class="region-card">
        <div class="region-head"><span class="rh-ppsa">${esc(ppsa)}</span>${reg?`<span class="rh-dot">·</span><span class="rh-region">${esc(reg)}</span>`:''}</div>
        <div class="region-body">${regionBody}</div>
      </div>`;
    }else{
      html+=regionBody;
    }
  });

  area.innerHTML=html||'<div class="dl-empty">No download links found.</div>';
}

function toggleBldSection(bodyId, hdr){
  const body=document.getElementById(bodyId);
  if(!body)return;
  const section=hdr?.closest('.bld-section');
  const collapsed=section?.classList.toggle('bld-collapsed');
}

function openUrl(e){const u=decodeURIComponent(e);if(!isSafeUrl(u)){toast('Blocked unsafe link','err');return;}const a=api();if(a)a.open_url(u);else window.open(u,'_blank','noopener');}
function copyUrl(e){navigator.clipboard.writeText(decodeURIComponent(e)).catch(()=>{});toast('Copied!');}
function toggleParts(id,el){const b=document.getElementById(id);if(b)b.classList.toggle('open');if(el)el.classList.toggle('open');}
function copyAll(e){try{const u=JSON.parse(decodeURIComponent(e));navigator.clipboard.writeText(u.join('\n'));toast('Copied '+u.length+' links');}catch(x){}}
function openAll(e){try{JSON.parse(decodeURIComponent(e)).forEach(u=>openUrl(encodeURIComponent(u)));}catch(x){}}
function toggleFav(){if(selIdx>=0)toggleFavIdx(selIdx);}
function toggleFavIdx(ri){const g=allGames[ri];if(!g)return;toggleFavGame(g);const on=isFavGame(g);const fb=$('fav-btn');if(fb&&ri===selIdx)fb.className='d-fbtn'+(on?' on':'');const cf=$('c'+ri)?.querySelector('.card-fav');if(cf)cf.className='card-fav'+(on?' on':'');const qb=$('c'+ri)?.querySelector('.qb');if(qb)qb.classList.toggle('on',on);if(filter==='favs')applyFilters();}
function enrichOne(){if(selIdx<0)return;const a=api();if(!a)return;toast('Fetching metadata...');setStatus(true,'Enriching...');a.enrich_one(selIdx,SRC).then(r=>{setStatus(false);if(r.ok){toast('Metadata fetched!','ok');loadLibrary();}else toast(r.error||'Failed','err');});}
function enrichAll(){const a=api();if(!a)return;a.enrich_all(SRC).then(r=>{if(!r.ok)toast(r.error||'Failed','err');else toast('Enrichment started in background...');});}
function enrichAllMissing(){
  const a=api();if(!a){toast('Backend not ready','err');return;}
  if(!(appSettings.rawg_api_key||appSettings.igdb_client_id)){
    toast('Configure RAWG or IGDB API keys in Settings first','err');showView('settings');return;
  }
  const missing=allGames.filter(g=>!(g.enrichment?.description));
  if(!missing.length){toast('No games missing metadata!','ok');return;}
  const btn=$('mfb-btn');if(btn){btn.disabled=true;btn.textContent='Fetching...';}
  setStatus(true,'Fetching metadata for '+missing.length+' games...');
  setProgress(0,'Fetching missing metadata for '+missing.length+' games...');
  a.enrich_all(SRC).then(r=>{
    if(!r.ok){
      toast(r.error||'Enrichment failed','err');
      setStatus(false);setProgress(0);
      if(btn){btn.disabled=false;btn.textContent='Fetch All Missing Metadata';}
    } else {
      toast('Fetching metadata for '+missing.length+' games in background...','ok');
    }
  });
}
function repairCovers(){const a=api();if(!a)return;toast('Repairing covers...');a.repair_covers(SRC).then(r=>{if(!r.ok)toast(r.error||'Failed','err');});}
function rebuildCovers(){const a=api();if(!a)return;toast('Rebuilding cover cache...');a.rebuild_cover_cache(SRC).then(r=>{if(!r.ok)toast(r.error||'Failed','err');});}
function clearCacheConfirm(){if(!confirm('Delete all cached cover images?'))return;const a=api();if(!a)return;a.clear_cache().then(r=>{toast(r.ok?`Cleared ${r.deleted} files`:'Failed',r.ok?'ok':'err');loadLibrary();});}
function repairDb(){const a=api();if(!a)return;a.repair_database(SRC).then(r=>{toast(r.ok?`Repaired (${r.fixed} fixes)`:'Failed',r.ok?'ok':'err');});}
