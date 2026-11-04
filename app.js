/*
 * OSJL Property Atlas — vanilla JavaScript, CSV-powered.
 * Edit the two filenames below only if the files in DATA/ are renamed.
 * All data, categories, and totals are calculated from those CSVs.
 */
'use strict';
const CONFIG = {
  storeCSV: 'DATA/OSJL_183_Stores_and_Owned_Properties_Updated.csv',
  portfolioCSV: 'DATA/OSJL_Property_Portfolio_With_Ownership_Types_2026-11-02(2).csv',
  refreshMilliseconds: 20000,
  defaultZoom: 7
};
const OWNER_TYPES = [
  {key:'Owned + OSJL Store', label:'Owned + OSJL Store', color:'#177c6d'},
  {key:'Owned + No OSJL Store', label:'Owned + No OSJL Store', color:'#c28543'},
  {key:'Leased OSJL Store', label:'Leased OSJL Store', color:'#4285b6'},
  {key:'Ground / Master Leased Property', label:'Ground / Master Leased', color:'#9259b0'},
  {key:'Unknown', label:'Unknown / Unverified', color:'#929b9e'}
];
const DISPLAY_FIELDS = [
  ['OSJL_Area_SF','OSJL Area','sf'],
  ['OSJL_Type','OSJL Type'],
  ['Retail_Center_Type','Retail Center Type'],
  ['Total_GLA_SF','Total GLA','sf'],
  ['Tenants','Tenants'],
  ['Type_of_Space_Available','Space Available'],
  ['Property_Ownership_Type','Ownership Type'],
  ['Record_Type','Record Type']
];
const PORTFOLIO_FIELDS = [
  ['OSJL_Area_SF','OSJL Area','sf'],
  ['OSJL_Type','OSJL Type'],
  ['Retail_Center_Type','Retail Center Type'],
  ['Total_GLA_SF','Total GLA','sf'],
  ['Land_Area_Acres','Land Area','acres'],
  ['Acquisition_Year','Acquisition Year'],
  ['Acquired_Asset_Type','Acquired Asset Type'],
  ['Previous_Retail_Use','Previous Retail Use'],
  ['Reported_Purchase_Price_USD','Reported Purchase Price','usd'],
  ['Tenants','Tenants']
];
let storeRows=[], portfolioRows=[], previousStoreText=null, previousPortfolioText=null;
let map=null, markerLayer=null, markers=[], hasInitialBounds=false, activeTab='map';
let updating=false, renderSerial=0;
// Satellite maps in the renovation cards are initialized only when near the viewport.
let cardMapObserver=null, cardMaps=[];
const $ = id => document.getElementById(id);

function escapeHTML(x) {
  return String(x ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function csvRows(text) {
  // RFC-4180-style parser; handles quoted commas, double-quotes, CRLF and newlines inside cells.
  const rows=[]; let field='', row=[], quoted=false;
  text=String(text).replace(/^\uFEFF/, '');
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if (quoted) {
      if(c==='"' && text[i+1]==='"') { field+='"'; i++; }
      else if(c==='"') quoted=false;
      else field+=c;
    } else if(c==='"') quoted=true;
    else if(c===',') {row.push(field);field='';}
    else if(c==='\r' || c==='\n') {
      if(c==='\r' && text[i+1]==='\n') i++;
      row.push(field);field='';
      if(row.some(v=>v.trim()!=='')) rows.push(row);
      row=[];
    } else field+=c;
  }
  row.push(field); if(row.some(v=>v.trim()!=='')) rows.push(row);
  if(!rows.length) return [];
  const head=rows.shift().map(s=>s.trim());
  return rows.map(cells => {
    const obj={};head.forEach((name,i)=>obj[name] = (cells[i] ?? '').trim());return obj;
  });
}
const str = value => String(value??'').trim();
const normOwner = value => OWNER_TYPES.some(t=>t.key===str(value)) ? str(value) : 'Unknown';
const categoryInfo = value => OWNER_TYPES.find(t=>t.key===normOwner(value));
const readableNum = n => { const a=Number(String(n).replace(/[$,]/g,''));return Number.isFinite(a) ? a.toLocaleString('en-US',{maximumFractionDigits:2}) : str(n); };
function formatted(v,kind) {
  if(!str(v)) return '—';
  if(kind==='sf') return readableNum(v)+' SF';
  if(kind==='acres') return readableNum(v)+' acres';
  if(kind==='usd') return '$'+readableNum(v);
  return str(v);
}
function safeLink(address,row) {
  const lat=Number(row.Latitude),lng=Number(row.Longitude);
  const text=Number.isFinite(lat) && Number.isFinite(lng) && str(row.Latitude) && str(row.Longitude) ? `${lat},${lng}` : address;
  return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(text);
}
function shortAddress(row) { return str(row.Street_Address) || [row.City,row.State,row.ZIP_Code].filter(Boolean).join(', '); }
function displayTitle(row) {return [str(row.City),str(row.State)].filter(Boolean).join(', ') || str(row.Store_ID) || 'Unknown location';}
function rowId(row) {return str(row.Store_ID)||str(row.Property_Record_ID)||'NO ID';}
function searchable(row) {return Object.values(row).join(' ').toLocaleLowerCase();}
function labelLocationCount(n) {return n.toLocaleString('en-US');}

function setTab(tab) {
  if(!['map','renovation','taxonomy'].includes(tab))return;
  if(activeTab!==tab)disposeCardMaps();
  activeTab=tab;
  $('page-map').hidden=tab!=='map';
  $('page-renovation').hidden=tab!=='renovation';
  $('page-taxonomy').hidden=tab!=='taxonomy';
  document.querySelectorAll('[data-tab]').forEach(btn=>{
    const active=btn.dataset.tab===tab;btn.classList.toggle('active',active);btn.setAttribute('aria-selected',String(active));
  });
  if(tab==='map' && map)setTimeout(()=>map.invalidateSize(),50);
  if(tab==='renovation')renderRenovation();
  if(tab==='taxonomy')renderTaxonomy();
}
function fillOwnerFilters() {
  for(const id of ['map-owner-filter','reno-owner-filter','tax-owner-filter']) {
    const select=$(id), old=select.value;
    select.innerHTML='<option value="all">All property types</option>'+OWNER_TYPES.map(t=>`<option value="${escapeHTML(t.key)}">${escapeHTML(t.label)}</option>`).join('');
    select.value=[...select.options].some(o=>o.value===old) ? old:'all';
  }
}
function mapFilter() {
  const query=$('map-search').value.trim().toLocaleLowerCase(); const owner=$('map-owner-filter').value;
  return row=>(!query || searchable(row).includes(query)) && (owner==='all'||normOwner(row.Property_Ownership_Type)===owner);
}
function matchingMapRows(){return storeRows.filter(mapFilter());}
function tooltipHTML(row,withLink=false) {
  let title=displayTitle(row), address=shortAddress(row);
  const mapDetails=DISPLAY_FIELDS.filter(([key])=>str(row[key])).map(([key,label,kind])=>
    `<span>${escapeHTML(label)}</span><strong>${escapeHTML(formatted(row[key],kind))}</strong>`).join('');
  const source=`<div class="map-tooltip-footer">${escapeHTML(rowId(row))}${str(row.Property_Record_ID)?' · '+escapeHTML(row.Property_Record_ID):''}</div>`;
  return `<div class="map-tooltip-body"><div class="map-tooltip-title">${escapeHTML(title)}</div>
    <div class="map-tooltip-address">${escapeHTML(address)}</div>
    <div class="map-tooltip-grid">${mapDetails}</div>${source}
    ${withLink?`<a class="map-popup-btn" target="_blank" rel="noopener noreferrer" href="${escapeHTML(safeLink(address,row))}">Open in Google Maps ↗</a>`:''}</div>`;
}
function ensureMap() {
  if(map || typeof L==='undefined') {
    if(typeof L==='undefined') $('map-fallback').hidden=false;
    return;
  }
  const streets=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,attribution:'© OpenStreetMap contributors'
  });
  const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
    maxZoom:19,attribution:'Imagery © Esri and contributors'
  });
  map=L.map('map',{zoomControl:true,layers:[streets],preferCanvas:true}).setView([41.3,-72.8],7);
  L.control.layers({'Street map':streets,'Satellite':satellite},null,{position:'topright',collapsed:false}).addTo(map);
  markerLayer=L.layerGroup().addTo(map);
}
function makeMarkers() {
  ensureMap(); if(!map) return;
  markerLayer.clearLayers(); markers=[];
  storeRows.forEach(row=>{
    const lat=Number(row.Latitude),lng=Number(row.Longitude);
    if(!str(row.Latitude)||!str(row.Longitude)||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return;
    const info=categoryInfo(row.Property_Ownership_Type);
    const marker=L.circleMarker([lat,lng],{radius:7,weight:2,color:'#fff',fillColor:info.color,fillOpacity:.94,opacity:1});
    marker.bindTooltip(tooltipHTML(row),{direction:'top',offset:[0,-8],className:'osjl-tooltip',sticky:true});
    marker.bindPopup(tooltipHTML(row,true),{maxWidth:340,minWidth:275});
    markers.push({marker,row});
  });
  if(!hasInitialBounds && markers.length) {
    map.fitBounds(L.latLngBounds(markers.map(m=>m.marker.getLatLng())),{padding:[35,35],maxZoom:9});
    hasInitialBounds=true;
  }
  updateVisibleMarkers();
}
function updateVisibleMarkers() {
  const filter=mapFilter();
  if(map && markerLayer) {markerLayer.clearLayers();markers.forEach(item=>{if(filter(item.row)) item.marker.addTo(markerLayer);});}
  const filtered=matchingMapRows();
  $('map-visible-count').textContent=labelLocationCount(filtered.length)+' shown';
  const counts=new Map(OWNER_TYPES.map(t=>[t.key,0]));
  storeRows.forEach(r=>counts.set(normOwner(r.Property_Ownership_Type),counts.get(normOwner(r.Property_Ownership_Type))+1));
  $('ownership-legend').innerHTML=OWNER_TYPES.map(t=>`<div class="legend-item" tabindex="0" role="button" data-filter="${escapeHTML(t.key)}" title="Filter ${escapeHTML(t.label)}"><span class="legend-circle" style="background:${t.color}"></span><span>${escapeHTML(t.label)}</span><span class="legend-value">${counts.get(t.key)}</span></div>`).join('');
  $('ownership-legend').querySelectorAll('[data-filter]').forEach(el=>{
    const activate=()=>{$('map-owner-filter').value=el.dataset.filter;updateVisibleMarkers();};
    el.addEventListener('click',activate);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}});
  });
  const list=$('map-location-list');
  if(!filtered.length){list.innerHTML='<div class="empty-state">No matching properties.</div>';return;}
  list.innerHTML=filtered.map((r,i)=>{
    const info=categoryInfo(r.Property_Ownership_Type);
    return `<button class="location-row" data-idx="${i}" type="button"><span class="location-dot" style="background:${info.color}"></span><span class="location-info"><strong>${escapeHTML(displayTitle(r))}</strong><small>${escapeHTML(shortAddress(r))}</small></span><span class="location-chevron">›</span></button>`;
  }).join('');
  list.querySelectorAll('[data-idx]').forEach(btn=>btn.addEventListener('click',()=>{
    const row=filtered[Number(btn.dataset.idx)];const match=markers.find(m=>m.row===row);
    if(!match||!map)return;
    map.setView(match.marker.getLatLng(),Math.max(15,map.getZoom()),{animate:true});
    setTimeout(()=>match.marker.openPopup(),260);
  }));
}

function renovationCategory(value) {
  const v=str(value).toLowerCase().replace(/[.\s]+$/,'');
  if(!v) return 'blank';
  if(/^(no\s+improvements?|no\s+visible\s+improvements?|none|no\s+renovation|n\/a)$/i.test(v)) return 'no';
  return 'yes';
}
function renovationFilter() {
  const query=$('reno-search').value.trim().toLocaleLowerCase(); const owner=$('reno-owner-filter').value;
  return row=>(!query||searchable(row).includes(query)) && (owner==='all'||normOwner(row.Property_Ownership_Type)===owner);
}
function propertyCard(row,type) {
  const section=document.createElement('article');section.className='property-card';
  const owner=categoryInfo(row.Property_Ownership_Type);
  const values=PORTFOLIO_FIELDS.map(([key,label,kind])=>{
    const value=str(row[key]); const wide=key==='Tenants'||key==='Acquired_Asset_Type'||key==='Previous_Retail_Use';
    return `<div class="property-field ${wide?'wide':''}"><div class="field-label">${escapeHTML(label)}</div><div class="field-value ${value?'':'missing'} ${key==='Tenants'?'tenants-value':''}">${escapeHTML(formatted(value,kind))}</div></div>`;
  }).join('');
  const mapURL=safeLink(shortAddress(row),row);
  const lat=Number(row.Latitude), lng=Number(row.Longitude);
  const hasCoordinates=str(row.Latitude)&&str(row.Longitude)&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
  const satelliteMarkup=hasCoordinates
    ? `<div class="card-satellite-block"><div class="card-satellite-heading"><span class="media-heading">SATELLITE MAP</span><span class="card-satellite-hint">Drag to pan · + / − to zoom</span></div><div class="card-satellite-map" data-lat="${lat}" data-lng="${lng}" role="region" aria-label="Interactive satellite map for ${escapeHTML(displayTitle(row))}"></div></div>`
    : '';
  section.innerHTML=`<div class="card-head"><div class="card-topline"><span class="card-id">${escapeHTML(rowId(row))}</span><span class="card-owner" style="background:${owner.color}18;color:${owner.color}">${escapeHTML(str(row.Property_Ownership_Type)||'Unknown / Unverified')}</span></div>
    <h4>${escapeHTML(displayTitle(row))}</h4><div class="card-address">${escapeHTML(shortAddress(row))}</div></div>
    <div class="reno-highlight"><span class="field-label">RENOVATION</span>${escapeHTML(row.Renovation)}</div>
    <div class="card-fields">${values}</div>
    <div class="card-media-slot"></div>
    ${satelliteMarkup}
    <div class="card-footer"><a href="${escapeHTML(mapURL)}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a>
    ${str(row.Acquisition_Source_URL)&&/^https?:\/\//i.test(row.Acquisition_Source_URL)?`<a href="${escapeHTML(row.Acquisition_Source_URL)}" target="_blank" rel="noopener noreferrer">Property source ↗</a>`:''}</div>`;
  return section;
}
// Paths in CSV may use Windows backslashes. Only allow local PICTURE/ and PLAN/,
// or full HTTP(S) URLs; never treat a Windows file path as a browser URL.
function assetUrl(value,folder) {
  const val=str(value).replaceAll('\\','/');
  if(!val)return '';
  if(/^https?:\/\//i.test(val))return val;
  if(/^(?:[A-Za-z]:|\/|\.\.\/)/.test(val))return '';
  let parts=val.replace(/^\.\//,'').split('/').filter(Boolean);
  if(!parts.length || parts.includes('..')) return '';
  if(!['PICTURE','PLAN'].includes(parts[0].toUpperCase()))parts.unshift(folder);
  return parts.map(encodeURIComponent).join('/');
}
function assetCandidates(row,field,category) {
  const paths=[];const preferred=assetUrl(row[field],category);
  if(preferred)paths.push(preferred);
  const id=rowId(row); const city=str(row.City).replace(/[^A-Za-z0-9]/g,''); const state=str(row.State).replace(/[^A-Za-z]/g,'');
  if(category==='PICTURE' && /^OSJL\d+$/i.test(id)) {
    const suffix=field==='renovation before'?'Before':'After';
    for(const ext of ['png','jpg','jpeg','webp'])paths.push(assetUrl(`PICTURE/${id}_${suffix}.${ext}`,'PICTURE'));
  }
  if(category==='PLAN') {
    for(const name of [`Plan_${city}${state}`,`Plan_${city}`])for(const ext of ['png','jpg','jpeg','pdf','webp'])paths.push(assetUrl(`PLAN/${name}.${ext}`,'PLAN'));
  }
  return [...new Set(paths.filter(Boolean))];
}
async function firstExisting(list) {
  for(const url of list) {
    try {const res=await fetch(url,{method:'HEAD',cache:'no-store'});if(res.ok)return url;}
    catch(_e){} // A missing local file is expected and is simply not displayed.
  }
  return '';
}
function previewFigure(url,caption) {
  const figure=document.createElement('figure');figure.className='media-figure';
  const preview=document.createElement('div');preview.className='media-preview';
  const img=document.createElement('img');img.src=url;img.alt=caption;img.loading='lazy';
  preview.appendChild(img); preview.addEventListener('click',()=>openLightbox(url,caption));
  const label=document.createElement('figcaption');label.textContent=caption;
  figure.appendChild(preview);figure.appendChild(label);return figure;
}
function openLightbox(url,caption) {
  $('lightbox-img').src=url; $('lightbox-img').alt=caption; $('lightbox-caption').textContent=caption; $('lightbox').hidden=false;
}
function closeLightbox(){$('lightbox').hidden=true; $('lightbox-img').src='';}
async function addMediaToCard(card,row,serial) {
  const [before,after,plan]=await Promise.all([
    firstExisting(assetCandidates(row,'renovation before','PICTURE')),
    firstExisting(assetCandidates(row,'renovation after','PICTURE')),
    firstExisting(assetCandidates(row,'plans','PLAN'))
  ]);
  if(serial!==renderSerial||!card.isConnected||(!before&&!after&&!plan))return;
  const slot=card.querySelector('.card-media-slot');
  if(before||after){
    const wrapper=document.createElement('div');wrapper.className='media-block';
    wrapper.innerHTML='<div class="media-heading">BEFORE / AFTER</div>';
    const grid=document.createElement('div');grid.className='before-after-grid';
    if(before)grid.appendChild(previewFigure(before,'BEFORE'));
    if(after)grid.appendChild(previewFigure(after,'AFTER'));
    wrapper.appendChild(grid);slot.appendChild(wrapper);
  }
  if(plan){
    const wrapper=document.createElement('div');wrapper.className='media-block';
    wrapper.innerHTML='<div class="media-heading">SITE PLAN</div>';
    const stage=document.createElement('div');stage.className='plan-preview';
    const isPDF=/\.pdf(?:$|\?)/i.test(decodeURIComponent(plan));
    if(isPDF){const frame=document.createElement('iframe');frame.src=plan+'#toolbar=0&view=FitH';frame.title='Site plan PDF';frame.loading='lazy';stage.appendChild(frame);}
    else {const img=document.createElement('img');img.src=plan;img.alt='Site plan';img.loading='lazy';img.addEventListener('click',()=>openLightbox(plan,'SITE PLAN'));stage.appendChild(img);}
    const link=document.createElement('a');link.className='plan-link';link.href=plan;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open site plan ↗';
    wrapper.appendChild(stage);wrapper.appendChild(link);slot.appendChild(wrapper);
  }
}
// Shared lazy satellite previews for renovation and taxonomy pages.
// Destroy off-tab maps so switching pages doesn't retain hundreds of tile layers.
function disposeCardMaps() {
  if(cardMapObserver){cardMapObserver.disconnect();cardMapObserver=null;}
  cardMaps.forEach(instance=>instance.remove());
  cardMaps=[];
  document.querySelectorAll('.card-satellite-map[data-map-loaded]').forEach(el=>delete el.dataset.mapLoaded);
}
function mountCardSatellite(element) {
  if(!element.isConnected || element.dataset.mapLoaded==='true' || typeof L==='undefined')return;
  const lat=Number(element.dataset.lat),lng=Number(element.dataset.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return;
  const zoom=Number(element.dataset.zoom)||15;
  const instance=L.map(element,{
    zoomControl:true,attributionControl:true,dragging:true,touchZoom:true,doubleClickZoom:true,
    // Long pages are easier to scroll if a mouse wheel doesn't zoom every inset map.
    scrollWheelZoom:false
  }).setView([lat,lng],zoom);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
    maxZoom:19,attribution:'Imagery © Esri and contributors'
  }).addTo(instance);
  L.circleMarker([lat,lng],{radius:6,color:'#fff',weight:2.5,fillColor:'#147c70',fillOpacity:1,interactive:false}).addTo(instance);
  element.dataset.mapLoaded='true';cardMaps.push(instance);
  requestAnimationFrame(()=>{if(element.isConnected)instance.invalidateSize();});
}
function observeCardSatellites(pageId) {
  const elements=[...document.querySelectorAll(`#${pageId} .card-satellite-map`)];
  if(typeof L==='undefined'||!elements.length)return;
  if('IntersectionObserver' in window){
    cardMapObserver=new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(!entry.isIntersecting)continue;
        mountCardSatellite(entry.target);
        cardMapObserver?.unobserve(entry.target);
      }
    },{rootMargin:'260px 0px',threshold:0.01});
    elements.forEach(el=>cardMapObserver.observe(el));
  }else elements.forEach(mountCardSatellite);
}
function renderRenovation() {
  const filter=renovationFilter();
  const classified=portfolioRows.filter(r=>renovationCategory(r.Renovation)!=='blank');
  const filtered=classified.filter(filter);
  const no=filtered.filter(r=>renovationCategory(r.Renovation)==='no');
  const yes=filtered.filter(r=>renovationCategory(r.Renovation)==='yes');
  $('reno-total').textContent=labelLocationCount(classified.length);
  $('tab-reno-count').textContent=labelLocationCount(classified.length);
  $('no-improvement-count').textContent=labelLocationCount(no.length);
  $('improvements-count').textContent=labelLocationCount(yes.length);
  ++renderSerial;const serial=renderSerial;
  disposeCardMaps();
  for(const [id,items,type] of [['cards-no-improvement',no,'no'],['cards-improvement',yes,'yes']]) {
    const container=$(id);container.replaceChildren();
    if(!items.length){container.innerHTML='<div class="empty-state">No matching projects.</div>';continue;}
    const frag=document.createDocumentFragment();const result=[];
    for(const row of items){const card=propertyCard(row,type);frag.appendChild(card);result.push([card,row]);}
    container.appendChild(frag);
    result.forEach(([card,row])=>{addMediaToCard(card,row,serial).catch(e=>console.warn('Image preview:',e));});
  }
  observeCardSatellites('page-renovation');
}
// ===== Third tab: ownership → layout hierarchy, derived entirely from the portfolio CSV =====
const layoutName = row => str(row.Retail_Center_Type) || 'Unclassified Layout';
function fillLayoutFilter() {
  const select=$('tax-layout-filter'), old=select.value;
  const names=[...new Set(portfolioRows.map(layoutName))].sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'}));
  select.innerHTML='<option value="all">All layout types</option>'+names.map(name=>`<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');
  select.value=[...select.options].some(option=>option.value===old)?old:'all';
}
function taxonomyFilter(row) {
  const query=$('tax-search').value.trim().toLocaleLowerCase();
  const owner=$('tax-owner-filter').value;
  const type=$('tax-layout-filter').value;
  return (!query||searchable(row).includes(query)) &&
         (owner==='all'||normOwner(row.Property_Ownership_Type)===owner) &&
         (type==='all'||layoutName(row)===type);
}
function projectMiniField(label,value,kind) {
  return `<div class="taxonomy-mini-field"><span>${escapeHTML(label)}</span><strong>${escapeHTML(formatted(value,kind))}</strong></div>`;
}
function taxonomyProjectCard(row) {
  const title=displayTitle(row), addr=shortAddress(row), id=rowId(row);
  const lat=Number(row.Latitude), lng=Number(row.Longitude);
  const hasCoords=str(row.Latitude)&&str(row.Longitude)&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
  const mapMarkup=hasCoords ? `<div class="card-satellite-block taxonomy-satellite"><div class="card-satellite-heading"><span class="media-heading">SATELLITE MAP</span><span class="card-satellite-hint">Drag to pan · + / − to zoom</span></div><div class="card-satellite-map" data-lat="${lat}" data-lng="${lng}" data-zoom="15" role="region" aria-label="Interactive satellite map for ${escapeHTML(title)}"></div></div>` : '<div class="taxonomy-map-empty">No verified coordinates in CSV</div>';
  const note=str(row.Notes);
  const tenants=str(row.Tenants);
  const meta=[
    projectMiniField('OSJL AREA',row.OSJL_Area_SF,'sf'),
    projectMiniField('TOTAL GLA',row.Total_GLA_SF,'sf'),
    projectMiniField('OSJL POSITION',row.OSJL_Type),
    projectMiniField('ACQUIRED',row.Acquisition_Year)
  ].join('');
  return `<article class="taxonomy-project-card">
    <div class="tax-project-top"><span class="tax-project-id">${escapeHTML(id)}</span><span class="tax-project-location">${escapeHTML(str(row.State))}</span></div>
    <h4>${escapeHTML(title)}</h4>
    <div class="tax-project-address">${escapeHTML(addr)}</div>
    <div class="taxonomy-mini-fields">${meta}</div>
    ${tenants?`<div class="tax-project-tenants"><strong>TENANTS</strong><span>${escapeHTML(tenants)}</span></div>`:''}
    ${note?`<div class="tax-project-note" title="${escapeHTML(note)}">${escapeHTML(note)}</div>`:''}
    ${mapMarkup}
    <div class="tax-project-footer"><a target="_blank" rel="noopener noreferrer" href="${escapeHTML(safeLink(addr,row))}">Open in Google Maps ↗</a></div>
  </article>`;
}
// Preserve manually collapsed/expanded sections across periodic CSV updates.
function expandedTaxonomyState() {
  const state=new Map();
  document.querySelectorAll('#taxonomy-results details[data-tree-key]').forEach(el=>state.set(el.dataset.treeKey,el.open));
  return state;
}
function renderTaxonomy() {
  const previous=expandedTaxonomyState();
  const filtered=portfolioRows.filter(taxonomyFilter);
  $('tax-visible-count').textContent=`${labelLocationCount(filtered.length)} shown`;
  $('tax-total').textContent=labelLocationCount(portfolioRows.length);
  $('tab-tax-count').textContent=labelLocationCount(portfolioRows.length);
  const overview=$('taxonomy-tree'),results=$('taxonomy-results');
  disposeCardMaps();
  if(!filtered.length){
    overview.innerHTML='<div class="tax-empty-message">No matching properties in the selected categories.</div>';
    results.innerHTML='<div class="empty-state">No matching projects.</div>';
    return;
  }
  const categories=OWNER_TYPES.map(owner=>({owner,rows:filtered.filter(r=>normOwner(r.Property_Ownership_Type)===owner.key)})).filter(group=>group.rows.length);
  const overviewRows=[];
  const groupRows=[];
  for(const category of categories){
    const {owner,rows}=category;
    const ownerIndex=OWNER_TYPES.findIndex(o=>o.key===owner.key);
    const ownerId=`tax-owner-${ownerIndex}`;
    const perType=new Map();
    for(const row of rows){const label=layoutName(row);if(!perType.has(label))perType.set(label,[]);perType.get(label).push(row);}
    const types=[...perType.entries()].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]));
    const layoutButtons=types.map(([label,projects],index)=>`<button type="button" data-jump="${ownerId}-layout-${index}" class="tree-type-pill">${escapeHTML(label)} <b>${projects.length}</b></button>`).join('');
    overviewRows.push(`<div class="tree-owner-branch" style="--branch-color:${owner.color}">
      <button type="button" data-jump="${ownerId}" class="tree-owner-node"><i></i><span>${escapeHTML(owner.label)}</span><b>${rows.length}</b></button>
      <div class="tree-type-rail">${layoutButtons}</div>
    </div>`);
    const layoutDetails=types.map(([label,projects],index)=>{
      const key=`${owner.key}::${label}`;
      const open=previous.has(key)?previous.get(key):true;
      const cards=projects.map(taxonomyProjectCard).join('');
      return `<details class="taxonomy-layout-group" data-tree-key="${escapeHTML(key)}" id="${ownerId}-layout-${index}" ${open?'open':''}>
        <summary class="taxonomy-layout-heading"><span class="type-branch-icon" aria-hidden="true"></span><span class="layout-name">${escapeHTML(label)}</span><span class="type-count">${projects.length} ${projects.length===1?'property':'properties'}</span><span class="disclosure-chevron" aria-hidden="true"></span></summary>
        <div class="taxonomy-card-grid">${cards}</div>
      </details>`;
    }).join('');
    const ownerOpen=previous.has(owner.key)?previous.get(owner.key):true;
    groupRows.push(`<details class="taxonomy-owner-group" data-tree-key="${escapeHTML(owner.key)}" id="${ownerId}" style="--branch-color:${owner.color}" ${ownerOpen?'open':''}>
      <summary class="taxonomy-owner-heading"><span class="tax-owner-symbol" aria-hidden="true"></span><span class="owner-heading-body"><strong>${escapeHTML(owner.label)}</strong><small>${types.length} ${types.length===1?'layout type':'layout types'}</small></span><span class="owner-heading-count">${rows.length}</span><span class="disclosure-chevron" aria-hidden="true"></span></summary>
      <div class="taxonomy-layout-list">${layoutDetails}</div>
    </details>`);
  }
  overview.innerHTML=`<div class="tree-root-label"><span class="root-symbol">◆</span><span>OSJL PROPERTY PORTFOLIO</span><b>${filtered.length}</b></div><div class="tree-trunk" aria-hidden="true"></div><div class="tree-branches">${overviewRows.join('')}</div>`;
  results.innerHTML=groupRows.join('');
  observeCardSatellites('page-taxonomy');
}
function jumpToTaxonomyBranch(event) {
  const button=event.target.closest('[data-jump]');if(!button)return;
  const dest=document.getElementById(button.dataset.jump);if(!dest)return;
  let node=dest;
  while(node && node!==document.body){if(node.tagName==='DETAILS')node.open=true;node=node.parentElement;}
  dest.scrollIntoView({behavior:'smooth',block:'start'});
  dest.classList.add('tax-jump-focus');
  setTimeout(()=>dest.classList.remove('tax-jump-focus'),1100);
  // Newly opened layout branches can reveal maps that were outside the observer's viewport.
  setTimeout(()=>cardMaps.forEach(m=>m.invalidateSize()),220);
}
function paintHeader() {
  $('map-total').textContent=labelLocationCount(storeRows.length);
  $('tab-map-count').textContent=labelLocationCount(storeRows.length);
  const n=portfolioRows.filter(r=>renovationCategory(r.Renovation)!=='blank').length;
  $('tab-reno-count').textContent=labelLocationCount(n);
  $('reno-total').textContent=labelLocationCount(n);
  $('tab-tax-count').textContent=labelLocationCount(portfolioRows.length);
  $('tax-total').textContent=labelLocationCount(portfolioRows.length);
}
function fetchText(path) {
  const url=path+(path.includes('?')?'&':'?')+'_='+Date.now();
  return fetch(url,{cache:'no-store'}).then(res=>{
    if(!res.ok)throw new Error(`${path}: HTTP ${res.status}`);return res.text();
  });
}
async function reloadData(force=false) {
  if(updating)return;updating=true;
  try {
    const [storeText,portfolioText]=await Promise.all([fetchText(CONFIG.storeCSV),fetchText(CONFIG.portfolioCSV)]);
    const storeChanged=force||storeText!==previousStoreText;
    const portfolioChanged=force||portfolioText!==previousPortfolioText;
    if(storeChanged) {
      const records=csvRows(storeText);if(!records.length||!Object.hasOwn(records[0],'Latitude'))throw new Error('The stores CSV is empty or is missing Latitude.');
      storeRows=records;previousStoreText=storeText;
      makeMarkers();
    }
    if(portfolioChanged) {
      const records=csvRows(portfolioText);if(!records.length||!Object.hasOwn(records[0],'Renovation'))throw new Error('The portfolio CSV is empty or is missing Renovation.');
      portfolioRows=records.filter(r=>Object.values(r).some(v=>str(v)));previousPortfolioText=portfolioText;
      fillLayoutFilter();
      if(activeTab==='renovation')renderRenovation();
      if(activeTab==='taxonomy')renderTaxonomy();
    }
    paintHeader();
    $('updated-label').textContent=(storeChanged||portfolioChanged?'Loaded ':'Checked ')+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    $('error-notice').hidden=true;
  } catch(e) {
    console.error(e);
    $('error-notice').innerHTML=`<strong>Unable to read CSV files.</strong> ${escapeHTML(e.message)}<br>Use START_WEBSITE.bat (not a direct double-click on index.html), and check the two filenames in DATA/.`;
    $('error-notice').hidden=false;
    $('updated-label').textContent='CSV read error';
  } finally {updating=false;}
}
function init() {
  fillOwnerFilters();
  document.querySelectorAll('[data-tab]').forEach(tab=>tab.addEventListener('click',()=>setTab(tab.dataset.tab)));
  $('map-search').addEventListener('input',updateVisibleMarkers);
  $('map-owner-filter').addEventListener('change',updateVisibleMarkers);
  $('reno-search').addEventListener('input',renderRenovation);
  $('reno-owner-filter').addEventListener('change',renderRenovation);
  $('tax-search').addEventListener('input',renderTaxonomy);
  $('tax-owner-filter').addEventListener('change',renderTaxonomy);
  $('tax-layout-filter').addEventListener('change',renderTaxonomy);
  $('taxonomy-tree').addEventListener('click',jumpToTaxonomyBranch);
  $('tax-expand').addEventListener('click',()=>document.querySelectorAll('#taxonomy-results details').forEach(d=>d.open=true));
  $('tax-collapse').addEventListener('click',()=>document.querySelectorAll('#taxonomy-results details').forEach(d=>d.open=false));
  $('reload-button').addEventListener('click',()=>reloadData(true));
  $('lightbox-close').addEventListener('click',closeLightbox);
  $('lightbox').addEventListener('click',e=>{if(e.target===$('lightbox'))closeLightbox();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeLightbox();});
  ensureMap();reloadData();
  setInterval(()=>{if(!document.hidden)reloadData();},CONFIG.refreshMilliseconds);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)reloadData();});
  window.addEventListener('focus',()=>reloadData());
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
