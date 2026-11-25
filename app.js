/* OSJL Property Atlas — one authoritative data source: DATA/OSJL_183_Stores.csv. */
'use strict';
const CONFIG={
  csv:'DATA/OSJL_183_Stores.csv',
  refreshMilliseconds:20000,
  defaultZoom:7
};
const OWNER_TYPES=[
  {key:'Owned + OSJL Store',label:'Owned + OSJL Store',color:'#cb3049'},
  {key:'Owned + No OSJL Store',label:'Owned + No OSJL Store',color:'#cb3049'},
  {key:'Leased OSJL Store',label:'Leased OSJL Store',color:'#657ba6'},
  {key:'Unknown',label:'Unknown / Unverified',color:'#9d979b'}
];
// The center ownership scope has a separate visual encoding from tenure.
// Single Building / Parcel is deliberately NOT assumed to mean Entire or Partial Center.
const OWNED_SCOPE_COLORS={entire:'#aa1d36',partial:'#f19aa9',single:'#d8546d',undetermined:'#e8b9b7'};
const DISPLAY_FIELDS=[
  ['Property_Ownership_Type','Ownership type'],['Ownership_Scope','Owned scope'],['Property_Typology','Property typology'],
  ['Tenant_Mix_Type','Tenant mix'],['Retail_Center_Type','Retail center layout'],
  ['OSJL_Type','OSJL location'],['OSJL_Area_SF','OSJL area','sf'],
  ['Total_GLA_SF','Total GLA','sf'],['Available','Available (Q1 2026)'],['Vacant_Rate','Vacant rate (Q1 2026)'],['Land_Area_Acres','Land area','acres'],
  ['Acquisition_Year','Acquisition year'],['Lease_Start_or_Transfer_Year','Lease / transfer year'],
  ['Known_Property_Owner','Property owner'],['Previous_Retail_Use','Previous retail use'],
  ['Space_Availability_Reason','Space availability'],['Renovation','Renovation'],
  ['Tenants','Tenants'],['Type_of_Space_Available','Available space type'],
  ['Reported_Purchase_Price_USD','Purchase price','usd'],['Record_Type','Record type']
];
const PORTFOLIO_FIELDS=[
  ['Tenant_Mix_Type','Tenant mix'],['Retail_Center_Type','Retail center layout'],
  ['OSJL_Area_SF','OSJL area','sf'],['OSJL_Type','OSJL position'],
  ['Total_GLA_SF','Total GLA','sf'],['Available','Available (Q1 2026)'],['Vacant_Rate','Vacant rate (Q1 2026)'],['Land_Area_Acres','Land area','acres'],
  ['Acquisition_Year','Acquisition year'],['Lease_Start_or_Transfer_Year','Lease / transfer year'],
  ['Known_Property_Owner','Known property owner'],['Acquired_Asset_Type','Acquired asset type'],
  ['Previous_Retail_Use','Previous retail use'],['Space_Availability_Reason','Space availability reason'],
  ['Reported_Purchase_Price_USD','Reported purchase price','usd'],['Tenants','Tenants'],['Notes','Notes']
];
const MIX_ORDER=['OSJL Only','OSJL + Automotive','OSJL + Utility Retail','OSJL + Fitness','OSJL + Convenience','OSJL + Healthcare','OSJL + Mixed Services','Grocery-Anchored Retail','Retail, Services & Experiences','Other'];
let propertyRows=[],previousCSVText=null;
let map=null,markerLayer=null,markers=[],hasInitialBounds=false,activeTab='map';
let updating=false,renderSerial=0,cardMapObserver=null,cardMaps=[];
const mapOwnerSelection=new Set(OWNER_TYPES.map(t=>t.key));
const $=id=>document.getElementById(id);
const isOwned=value=>/^Owned \+ /i.test(String(value||''));
function scopeKind(value){
  const v=String(value||'').toLowerCase().trim();
  if(v==='entire retail center')return 'entire';
  if(v==='partial retail center')return 'partial';
  if(v==='single building / parcel')return 'single';
  return 'undetermined';
}
function scopeShort(value){
  return {entire:'Entire center',partial:'Partial center',single:'Single building / parcel',undetermined:'Undetermined'}[scopeKind(value)];
}
function rowColor(row){
  if(isOwned(row.Property_Ownership_Type))return OWNED_SCOPE_COLORS[scopeKind(row.Ownership_Scope)];
  return categoryInfo(row.Property_Ownership_Type).color;
}
function ownerBadge(row){
  const color=rowColor(row),label=str(row.Property_Ownership_Type)||'Unknown / Unverified';
  const scope=isOwned(row.Property_Ownership_Type)?`<span class="scope-badge" style="--scope-color:${color}">${escapeHTML(scopeShort(row.Ownership_Scope))}</span>`:'';
  return `<div class="card-badges"><span class="card-owner" style="background:${color}1a;color:#304c45">${escapeHTML(label)}</span>${scope}</div>`;
}
// Every view reads the same validated rows from the unified CSV.

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

function setTab(tab){
  if(!['map','renovation','improvement','typology','taxonomy','tenant','available'].includes(tab))return;
  if(tab!==activeTab){closeImprovementModal(false);closeTenantGuideModal(false);}
  if(activeTab!==tab)disposeCardMaps();
  activeTab=tab;
  for(const name of ['map','renovation','improvement','typology','taxonomy','tenant','available'])$('page-'+name).hidden=name!==tab;
  document.querySelectorAll('[data-tab]').forEach(btn=>{
    const active=btn.dataset.tab===tab;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-selected',String(active));
  });
  if(tab==='map'&&map)setTimeout(()=>map.invalidateSize(),50);
  if(tab==='renovation')renderRenovation();
  if(tab==='improvement')renderImprovementClassification();
  if(tab==='typology'){updateTypologySize();renderPropertyTypology();}
  if(tab==='taxonomy')renderTaxonomy();
  if(tab==='tenant')renderTenantMix();
  if(tab==='available')renderAvailableSpace();
}
function fillOwnerFilters(){
  for(const id of ['reno-owner-filter','tax-owner-filter','mix-owner-filter']){
    const select=$(id),old=select.value;
    const options=id==='reno-owner-filter'?OWNER_TYPES.filter(t=>t.key!=='Unknown'):OWNER_TYPES;
    select.innerHTML='<option value="all">All property types</option>'+options.map(t=>`<option value="${escapeHTML(t.key)}">${escapeHTML(t.label)}</option>`).join('');
    select.value=[...select.options].some(o=>o.value===old)?old:'all';
  }
}

function mapFilter(){
  const query=$('map-search').value.trim().toLocaleLowerCase();
  return row=>(!query||searchable(row).includes(query))&&mapOwnerSelection.has(normOwner(row.Property_Ownership_Type));
}
function matchingMapRows(){return propertyRows.filter(mapFilter());}

function tooltipHTML(row,withLink=false){
  const address=shortAddress(row),title=displayTitle(row);
  const details=DISPLAY_FIELDS.filter(([key])=>str(row[key])).map(([key,label,kind])=>
    `<span>${escapeHTML(label)}</span><strong>${escapeHTML(formatted(row[key],kind))}</strong>`).join('');
  const notes=withLink&&str(row.Notes)
    ?`<div class="map-popup-notes"><span>NOTES</span><p>${escapeHTML(row.Notes)}</p></div>`:'';
  const sourceLinks=withLink?[
    ['Acquisition_Source_URL','Acquisition source'],['Secondary_Source_URL','Secondary source']
  ].filter(([key])=>/^https?:\/\//i.test(str(row[key]))).map(([key,label])=>
    `<a href="${escapeHTML(str(row[key]))}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)} ↗</a>`).join(' · '):'';
  return `<div class="map-tooltip-body"><div class="map-tooltip-title">${escapeHTML(title)}</div>
    <div class="map-tooltip-address">${escapeHTML(address)}</div>
    <div class="map-tooltip-grid">${details}</div>
    ${notes}<div class="map-tooltip-footer">${escapeHTML(rowId(row))}${str(row.Property_Record_ID)&&str(row.Property_Record_ID)!==rowId(row)?' · '+escapeHTML(row.Property_Record_ID):''}</div>
    ${sourceLinks?`<div class="map-source-links">${sourceLinks}</div>`:''}
    ${withLink?`<a class="map-popup-btn" target="_blank" rel="noopener noreferrer" href="${escapeHTML(safeLink(address,row))}">Open in Google Maps ↗</a>`:''}</div>`;
}

function ensureMap(){
  if(map||typeof L==='undefined'){
    if(typeof L==='undefined')$('map-fallback').hidden=false;
    return;
  }
  // Keep the original OpenStreetMap source and desaturate only its tile layer.
  // Unlike third-party basemap styles, this does not need an extra API key.
  const grayscale=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,attribution:'© OpenStreetMap contributors',className:'osjl-grayscale-tiles'
  });
  const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
    maxZoom:19,attribution:'Imagery © Esri and contributors'
  });
  map=L.map('map',{zoomControl:true,layers:[grayscale],preferCanvas:true}).setView([41.3,-72.8],CONFIG.defaultZoom);
  L.control.layers({'Grayscale street map':grayscale,'Satellite':satellite},null,{position:'topright',collapsed:false}).addTo(map);
  markerLayer=L.layerGroup().addTo(map);
}
function makeMarkers(){
  ensureMap();if(!map){updateVisibleMarkers();return;}
  markerLayer.clearLayers();markers=[];
  propertyRows.forEach(row=>{
    const lat=Number(row.Latitude),lng=Number(row.Longitude);
    if(!str(row.Latitude)||!str(row.Longitude)||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return;
    const color=rowColor(row);
    let marker;
    if(normOwner(row.Property_Ownership_Type)==='Owned + No OSJL Store'){
      const icon=L.divIcon({className:'ownership-diamond-icon',html:`<span class="ownership-diamond" style="background:${color}"></span>`,iconSize:[19,19],iconAnchor:[9,9]});
      marker=L.marker([lat,lng],{icon});
    }else{
      marker=L.circleMarker([lat,lng],{radius:7,weight:2,color:'#fff',fillColor:color,fillOpacity:.96,opacity:1});
    }
    marker.bindTooltip(tooltipHTML(row),{direction:'top',offset:[0,-8],className:'osjl-tooltip',sticky:true});
    marker.bindPopup(tooltipHTML(row,true),{maxWidth:370,minWidth:280});
    markers.push({marker,row});
  });
  if(!hasInitialBounds&&markers.length){
    map.fitBounds(L.latLngBounds(markers.map(m=>m.marker.getLatLng())),{padding:[35,35],maxZoom:9});
    hasInitialBounds=true;
  }
  updateVisibleMarkers();
}
function updateVisibleMarkers(){
  const filter=mapFilter();
  if(map&&markerLayer){
    markerLayer.clearLayers();
    for(const item of markers)if(filter(item.row))item.marker.addTo(markerLayer);
  }
  const filtered=matchingMapRows();
  $('map-visible-count').textContent=labelLocationCount(filtered.length)+' shown';
  const counts=new Map(OWNER_TYPES.map(t=>[t.key,0]));
  propertyRows.forEach(row=>{const key=normOwner(row.Property_Ownership_Type);counts.set(key,counts.get(key)+1);});
  $('ownership-legend').innerHTML=OWNER_TYPES.map(t=>`<label class="legend-item${mapOwnerSelection.has(t.key)?'':' unchecked'}">
    <input type="checkbox" data-owner="${escapeHTML(t.key)}" ${mapOwnerSelection.has(t.key)?'checked':''}>
    <span class="legend-circle ${t.key==='Owned + No OSJL Store'?'legend-diamond':''}" style="background:${t.color}"></span>
    <span>${escapeHTML(t.label)}</span><span class="legend-value">${counts.get(t.key)}</span></label>`).join('');
  const list=$('map-location-list');
  if(!filtered.length){list.innerHTML='<div class="empty-state">No matching properties.</div>';return;}
  list.innerHTML=filtered.map((row,i)=>`<button class="location-row" data-idx="${i}" type="button">
    <span class="location-dot${normOwner(row.Property_Ownership_Type)==='Owned + No OSJL Store'?' diamond':''}" style="background:${rowColor(row)}"></span>
    <span class="location-info"><strong>${escapeHTML(displayTitle(row))}</strong><small>${escapeHTML(shortAddress(row))}</small></span>
    <span class="location-chevron">›</span></button>`).join('');
  list.querySelectorAll('[data-idx]').forEach(btn=>btn.addEventListener('click',()=>{
    const row=filtered[Number(btn.dataset.idx)],match=markers.find(m=>m.row===row);
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
  return row=>normOwner(row.Property_Ownership_Type)!=='Unknown' && (!query||searchable(row).includes(query)) && (owner==='all'||normOwner(row.Property_Ownership_Type)===owner);
}
function propertyCard(row,type){
  const section=document.createElement('article');section.className='property-card';
  const values=PORTFOLIO_FIELDS.map(([key,label,kind])=>{
    const value=str(row[key]);
    if(!value)return '';
    const wide=['Tenants','Notes','Acquired_Asset_Type','Previous_Retail_Use','Space_Availability_Reason'].includes(key);
    return `<div class="property-field ${wide?'wide':''}"><div class="field-label">${escapeHTML(label)}</div>
      <div class="field-value ${key==='Tenants'?'tenants-value':''}">${escapeHTML(formatted(value,kind))}</div></div>`;
  }).join('');
  const addr=shortAddress(row),mapURL=safeLink(addr,row);
  const lat=Number(row.Latitude),lng=Number(row.Longitude);
  const hasCoords=str(row.Latitude)&&str(row.Longitude)&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
  const satelliteMarkup=hasCoords?`<div class="card-satellite-block"><div class="card-satellite-heading"><span class="media-heading">SATELLITE MAP</span><span class="card-satellite-hint">Drag to pan · + / − to zoom</span></div>
    <div class="card-satellite-map" data-lat="${lat}" data-lng="${lng}" data-zoom="15" role="region" aria-label="Satellite map for ${escapeHTML(displayTitle(row))}"></div></div>`:'';
  const sources=[['Acquisition_Source_URL','Acquisition source'],['Secondary_Source_URL','Secondary source']]
    .filter(([key])=>/^https?:\/\//i.test(str(row[key]))).map(([key,label])=>`<a href="${escapeHTML(row[key])}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)} ↗</a>`).join('');
  section.innerHTML=`<div class="card-head"><div class="card-topline"><span class="card-id">${escapeHTML(rowId(row))}</span>${ownerBadge(row)}</div>
    <h4>${escapeHTML(displayTitle(row))}</h4><div class="card-address">${escapeHTML(addr)}</div></div>
    <div class="reno-highlight"><span class="field-label">RENOVATION</span>${escapeHTML(str(row.Renovation))}</div>
    <div class="card-fields">${values}</div><div class="card-media-slot"></div>${satelliteMarkup}
    <div class="card-footer"><a href="${escapeHTML(mapURL)}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a>${sources}</div>`;
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
  if(category==='PICTURE' && field==='renovation before') {
    const legacy=assetUrl(row['Before Picture'],'PICTURE');if(legacy)paths.push(legacy);
  }
  if(category==='PICTURE' && field==='renovation after') {
    const legacy=assetUrl(row['After Picture'],'PICTURE');if(legacy)paths.push(legacy);
  }
  const id=rowId(row); const city=str(row.City).replace(/[^A-Za-z0-9]/g,''); const state=str(row.State).replace(/[^A-Za-z]/g,'');
  if(category==='PICTURE' && ['renovation before','renovation after'].includes(field) && /^OSJL\d+$/i.test(id)) {
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
  const fieldPairs=[
    ['renovation before','renovation after'],
    ['renovation before2','renovation after2'],
    ['renovation before3','renovation after3'],
    ['renovation before4','renovation after4']
  ];
  const [imagePairs,plan]=await Promise.all([
    Promise.all(fieldPairs.map(async ([beforeField,afterField])=>Promise.all([
      firstExisting(assetCandidates(row,beforeField,'PICTURE')),
      firstExisting(assetCandidates(row,afterField,'PICTURE'))
    ]))),
    firstExisting(assetCandidates(row,'plans','PLAN'))
  ]);
  if(serial!==renderSerial||!card.isConnected||(!imagePairs.some(pair=>pair.some(Boolean))&&!plan))return;
  const slot=card.querySelector('.card-media-slot');
  for(let i=0;i<imagePairs.length;i++){
    const [before,after]=imagePairs[i];if(!before&&!after)continue;
    const wrapper=document.createElement('div');wrapper.className='media-block';
    wrapper.innerHTML=`<div class="media-heading">BEFORE / AFTER${i?' · SET '+(i+1):''}</div>`;
    const grid=document.createElement('div');grid.className='before-after-grid';
    if(before)grid.appendChild(previewFigure(before,'BEFORE'+(i?' '+(i+1):'')));
    if(after)grid.appendChild(previewFigure(after,'AFTER'+(i?' '+(i+1):'')));
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
function mountCardSatellite(element,collection=cardMaps) {
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
  L.circleMarker([lat,lng],{radius:6,color:'#fff',weight:2.5,fillColor:'#c82c44',fillOpacity:1,interactive:false}).addTo(instance);
  element.dataset.mapLoaded='true';collection.push(instance);
  requestAnimationFrame(()=>{if(element.isConnected)instance.invalidateSize();});
  return instance;
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
function renderRenovation(){
  const classified=propertyRows.filter(row=>renovationCategory(row.Renovation)!=='blank' && normOwner(row.Property_Ownership_Type)!=='Unknown');
  const filtered=classified.filter(renovationFilter);
  const sections=[['cards-no-improvement','no','no-improvement-count'],['cards-improvement','yes','improvements-count']];
  $('reno-total').textContent=labelLocationCount(classified.length);
  $('tab-reno-count').textContent=labelLocationCount(classified.length);
  ++renderSerial;const serial=renderSerial;
  disposeCardMaps();
  for(const [containerId,renovationType,countId] of sections){
    const items=filtered.filter(row=>renovationCategory(row.Renovation)===renovationType);
    $(countId).textContent=labelLocationCount(items.length);
    const container=$(containerId);container.replaceChildren();
    if(!items.length){container.innerHTML='<div class="empty-state">No matching projects.</div>';continue;}
    for(const owner of OWNER_TYPES.filter(t=>t.key!=='Unknown')){
      const group=items.filter(row=>normOwner(row.Property_Ownership_Type)===owner.key);
      if(!group.length)continue;
      const outer=document.createElement('details');outer.className='reno-owner-details';
      const heading=document.createElement('summary');heading.className='reno-owner-summary';
      heading.innerHTML=`<span class="legend-circle" style="background:${owner.color}"></span><strong>${escapeHTML(owner.label)}</strong><span class="reno-owner-count">${group.length}</span><span class="reno-chevron">⌄</span>`;
      outer.appendChild(heading);
      const children=document.createElement('div');children.className='reno-projects';
      for(const row of group.sort((a,b)=>displayTitle(a).localeCompare(displayTitle(b)))){
        const project=document.createElement('details');project.className='reno-project-details';
        const summary=document.createElement('summary');summary.className='reno-project-summary';
        const scope=isOwned(row.Property_Ownership_Type)?`<span class="reno-owned-status" style="--scope-color:${rowColor(row)}">${escapeHTML(scopeShort(row.Ownership_Scope))}</span>`:'';
        summary.innerHTML=`<span class="reno-project-name"><b>${escapeHTML(displayTitle(row))}</b><small>${escapeHTML(rowId(row))} · ${escapeHTML(shortAddress(row))}</small></span>${scope}<span class="reno-chevron">⌄</span>`;
        project.appendChild(summary);
        const body=document.createElement('div');body.className='reno-project-body';
        const card=propertyCard(row,renovationType);body.appendChild(card);project.appendChild(body);
        project.addEventListener('toggle',()=>{
          if(project.open&&!project.dataset.mediaRequested){
            project.dataset.mediaRequested='true';
            addMediaToCard(card,row,serial).catch(e=>console.warn('Media preview:',e));
          }
        });
        children.appendChild(project);
      }
      outer.appendChild(children);container.appendChild(outer);
    }
  }
  observeCardSatellites('page-renovation');
}


// ===== Eight-column classification pages =====
// The CSV field is intentionally spelled "Renovetion" as in the user's data.
const IMPROVEMENT_TYPES=[
  {field:'Tenant_Replacement_Storefront_Renovetion',label:'Tenant Replacement + Storefront Renovation',description:'A new tenant may reshape a storefront or building frontage, with related changes to paving, striping, sidewalks or parking.'},
  {field:'Pavement',label:'Pavement',description:'Restriping, new paving, parking reconfiguration or sidewalk widening.'},
  {field:'Storefront Repainting',label:'Storefront Repainting',description:'Changes to storefront or column colors without changing the form of the façade.'},
  {field:'Pad Site Modification',label:'Pad Site Modification',description:'Addition of a roadside pad site or façade and storefront improvements to an existing pad-site building.'},
  {field:'OSJL Relocation',label:'OSJL Relocation',description:'OSJL moves to a different space within the same retail center after acquisition.'},
  {field:'Landscape Removal',label:'Landscape Removal',description:'Removal of trees or shrubs, often to improve visibility from the road.'},
  {field:'Outdoor Seating Addition',label:'Outdoor Seating Addition',description:'Restaurant seating is added in an outdoor area, sometimes by repurposing part of a parking lot.'},
  {field:'OSJL Architectural Feature Removal',label:'OSJL Architectural Feature Removal',description:'Removal of arcades, decorative towers or other façade features when OSJL occupies a store.'}
];
const TYPOLOGY_TYPES=[
  {name:'Single-Tenant Standalone',diagram:'SingleTenant_Standalone.jpg',description:'One standalone OSJL building on a defined property, owned in its entirety by OSJL.',improvements:["Pad Site Modification"]},
  {name:'Multi-Tenant Big-Box',diagram:'MultiTenant_BigBox.jpg',description:'A single large-format building shared by OSJL and a few additional tenants; OSJL owns the entire property.',improvements:["Tenant Replacement + Storefront Renovation"]},
  {name:'Wide-Frontage Inline Center',diagram:'WideFrontage_Inline_Center.jpg',description:'A linear or L-shaped center with its long edge along the road, giving most storefronts strong road exposure. Pad sites may sit in front.',improvements:["OSJL Relocation","Tenant Replacement + Storefront Renovation","Landscape Removal","Pad Site Modification","Outdoor Seating Addition","Storefront Repainting"]},
  {name:'Deep-Lot Inline Center',diagram:'DeepLot_Inline_Center.jpg',description:'A narrow road frontage and deep site place some storefronts farther from traffic. Buildings may be linear or L-shaped.',improvements:["Landscape Removal","Pad Site Modification","Pavement","Tenant Replacement + Storefront Renovation"]},
  {name:'Low-Visibility Retail Center',diagram:'LowVisibility_Retail_Center.jpg',description:'Setbacks, grade changes or screening by other buildings or site features limit visibility from the main road.',improvements:[]},
  {name:'Partially Owned Inline Center',diagram:'Partially_Owned_Inline_Center.jpg',description:'A connected linear or L-shaped retail center in which OSJL owns only part of the property; pad sites may also be present.',improvements:["OSJL Relocation","Tenant Replacement + Storefront Renovation","Pad Site Modification","Landscape Removal","Pavement"]},
  {name:'Partially Owned Retail Cluster',diagram:'Partially_Owned_Retail_Cluster.jpg',description:'Several separate retail buildings share a site and generally face the road. OSJL owns only a portion of the complex.',improvements:["Storefront Repainting"]},
  {name:'Large-Scale Retail Complex',diagram:'LargeScale_Retail_Complex.jpg',description:'A large complex with numerous stores and big-box anchors. Internal buildings are often difficult to see from the main road.',improvements:["Pavement","Tenant Replacement + Storefront Renovation"]}
];
// Keep each improvement method in a consistent horizontal row in all eight
// Property Typology columns. Only methods listed in the typology summaries
// are included; blanks are intentional comparison cells.
const TYPOLOGY_METHOD_ORDER=IMPROVEMENT_TYPES
  .map(item=>item.label)
  .filter(label=>TYPOLOGY_TYPES.some(type=>type.improvements.includes(label)));
function typologyMethodGrid(type){
  const applicable=new Set(type.improvements);
  return TYPOLOGY_METHOD_ORDER.map((label,index)=>
    `<div class="typology-method-slot" data-method-row="${index+1}"${applicable.has(label)?'': ' aria-hidden="true"'}>`+
      (applicable.has(label)?classificationChip(label,'method'):'')+`</div>`
  ).join('');
}
function improvementTypesForRow(row){
  const found=IMPROVEMENT_TYPES.filter(item=>str(row[item.field])==='1');
  // Earlier uploaded CSVs predate the two newest classification columns.
  // On those files only, infer the two types from the original narrative.
  if(!Object.hasOwn(row,'Outdoor Seating Addition') && /outdoor (?:dining|seating)/i.test(str(row.Renovation)))found.push(IMPROVEMENT_TYPES[6]);
  if(!Object.hasOwn(row,'OSJL Architectural Feature Removal') && !Object.hasOwn(row,'Architectural Feature Removal') &&
    /(?:arcade removal|removal of (?:decorative|.*cupola).*tower)/i.test(str(row.Renovation)))found.push(IMPROVEMENT_TYPES[7]);
  if(!Object.hasOwn(row,'OSJL Architectural Feature Removal') && str(row['Architectural Feature Removal'])==='1' && !found.includes(IMPROVEMENT_TYPES[7]))found.push(IMPROVEMENT_TYPES[7]);
  return found;
}
function hasClassifiedImprovement(row){
  return renovationCategory(row.Renovation)==='yes'||improvementTypesForRow(row).length>0;
}
function classificationChip(label,kind){
  return `<span class="classification-chip classification-chip-${kind}">${escapeHTML(label)}</span>`;
}
function classificationCard(row,serial){
  const card=document.createElement('article');
  card.className='classification-project-card';
  const location=displayTitle(row),address=shortAddress(row);
  const categories=improvementTypesForRow(row);
  const tags=[
    ...categories.map(t=>classificationChip(t.label,'improvement')),
    str(row.Tenant_Mix_Type)?classificationChip(row.Tenant_Mix_Type,'mix'):'',
    str(row.Ownership_Scope)?classificationChip(row.Ownership_Scope,'scope'):''
  ].join('');
  const lat=Number(row.Latitude),lng=Number(row.Longitude);
  const valid=str(row.Latitude)&&str(row.Longitude)&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
  const satellite=valid?
    `<div class="classification-satellite card-satellite-map" data-lat="${lat}" data-lng="${lng}" data-zoom="15" aria-label="Satellite map of ${escapeHTML(location)}"></div>`:
    '<div class="classification-satellite classification-satellite-missing">Satellite coordinates not available</div>';
  const omitted=new Set(['Tenant_Mix_Type','Ownership_Scope','Property_Typology','Tenants']);
  const extra=[
    ['Retail_Center_Type','Retail center layout'],
    ['OSJL_Type','OSJL position'],
    ['Property_Ownership_Type','Property ownership type'],
    ['Renovation','Renovation details'],
    ['Acquisition_Year','Acquisition year'],
    ['Lease_Start_or_Transfer_Year','Lease / transfer year'],
    ['OSJL_Area_SF','OSJL area','sf'],
    ['Total_GLA_SF','Total GLA','sf'],
    ['Available','Available (Q1 2026)'],
    ['Vacant_Rate','Vacant rate (Q1 2026)'],
    ['Land_Area_Acres','Land area','acres'],
    ['Reported_Purchase_Price_USD','Purchase price','usd'],
    ['Known_Property_Owner','Known property owner'],
    ['Previous_Retail_Use','Previous retail use'],
    ['Acquired_Asset_Type','Acquired asset type'],
    ['Space_Availability_Reason','Space availability reason'],
    ['Notes','Notes']
  ].filter(([key])=>str(row[key]) && !omitted.has(key));
  const fields=extra.map(([key,label,kind])=>`<div class="classification-detail-field"><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(formatted(row[key],kind))}</dd></div>`).join('');
  const sources=[['Acquisition_Source_URL','Acquisition source'],['Secondary_Source_URL','Secondary source']]
    .filter(([key])=>/^https?:\/\//i.test(str(row[key])))
    .map(([key,label])=>`<a href="${escapeHTML(row[key])}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)} ↗</a>`).join('');
  card.innerHTML=`${satellite}
    <div class="classification-card-main">
      <div class="classification-id">${escapeHTML(rowId(row))}</div>
      <h4>${escapeHTML(location)}</h4>
      <div class="classification-tags">${tags||'<span class="classification-no-tags">No classification labels documented</span>'}</div>
    </div>
    <details class="classification-more">
      <summary>More info <span aria-hidden="true">⌄</span></summary>
      <div class="classification-more-body">
        <div class="classification-full-address"><strong>ADDRESS</strong><span>${escapeHTML(address||'—')}</span></div>
        ${str(row.Tenants)?`<div class="classification-tenants"><strong>TENANTS</strong><span>${escapeHTML(row.Tenants)}</span></div>`:''}
        <dl class="classification-detail-list">${fields}</dl>
        <div class="card-media-slot"></div>
        <div class="classification-links"><a href="${escapeHTML(safeLink(address,row))}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a>${sources}</div>
      </div>
    </details>`;
  const details=card.querySelector('.classification-more');
  details.addEventListener('toggle',()=>{
    if(details.open && !details.dataset.mediaRequested){
      details.dataset.mediaRequested='true';
      addMediaToCard(card,row,serial).catch(e=>console.warn('Classification media:',e));
    }
    if(details.open){cardMaps.forEach(m=>m.invalidateSize());}
  });
  return card;
}

// Property Typology has its own condensed card design. Do not modify
// classificationCard(): Improvement Classification intentionally keeps its layout.
function propertyTypologyCard(row,serial){
  const card=document.createElement('article');
  card.className='classification-project-card typology-project-card';
  const location=displayTitle(row),address=shortAddress(row);
  const categories=improvementTypesForRow(row);
  // Only three kinds of summary chips: improvement types, tenant mix, ownership scope.
  // Omit a kind when the CSV provides no value; never invent a classification.
  const chips=[
    ...categories.map(item=>classificationChip(item.label,'improvement')),
    str(row.Tenant_Mix_Type)?classificationChip(row.Tenant_Mix_Type,'mix'):'',
    str(row.Ownership_Scope)?classificationChip(row.Ownership_Scope,'scope'):''
  ].filter(Boolean).join('');
  const lat=Number(row.Latitude),lng=Number(row.Longitude);
  const hasCoords=str(row.Latitude)&&str(row.Longitude)&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
  const satellite=hasCoords
    ? `<div class="classification-satellite card-satellite-map" data-lat="${lat}" data-lng="${lng}" data-zoom="15" role="region" aria-label="Satellite map of ${escapeHTML(location)}"></div>`
    : '<div class="classification-satellite classification-satellite-missing">Satellite coordinates not available</div>';

  // These values appear only after expansion. In particular, avoid duplicating
  // the improvement-type, tenant-mix and ownership-scope chips above.
  const moreFields=[
    ['Retail_Center_Type','Retail center layout'],
    ['Tenants','Tenants'],
    ['OSJL_Type','OSJL position'],
    ['Property_Ownership_Type','Property ownership type'],
    ['Renovation','Renovation details'],
    ['Acquisition_Year','Acquisition year'],
    ['Lease_Start_or_Transfer_Year','Lease / transfer year'],
    ['OSJL_Area_SF','OSJL area','sf'],
    ['Total_GLA_SF','Total GLA','sf'],
    ['Available','Available (Q1 2026)'],
    ['Vacant_Rate','Vacant rate (Q1 2026)'],
    ['Land_Area_Acres','Land area','acres'],
    ['Reported_Purchase_Price_USD','Reported purchase price','usd'],
    ['Known_Property_Owner','Known property owner'],
    ['Previous_Retail_Use','Previous retail use'],
    ['Acquired_Asset_Type','Acquired asset type'],
    ['Space_Availability_Reason','Space availability reason'],
    ['Notes','Notes'],
    ['Store_ID','Store ID'],
    ['Property_Record_ID','Property record ID']
  ].filter(([key])=>str(row[key]));
  const details=moreFields.map(([key,label,kind])=>
    `<div class="classification-detail-field"><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(formatted(row[key],kind))}</dd></div>`
  ).join('');
  const sources=[['Acquisition_Source_URL','Acquisition source'],['Secondary_Source_URL','Secondary source']]
    .filter(([key])=>/^https?:\/\//i.test(str(row[key])))
    .map(([key,label])=>`<a href="${escapeHTML(row[key])}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)} ↗</a>`).join('');

  card.innerHTML=`${satellite}
    <div class="classification-card-main typology-card-main">
      <h4>${escapeHTML(location)}</h4>
      ${chips?`<div class="classification-tags typology-summary-tags">${chips}</div>`:''}
    </div>
    <details class="classification-more typology-more">
      <summary>More info <span aria-hidden="true">⌄</span></summary>
      <div class="classification-more-body">
        <div class="classification-full-address"><strong>ADDRESS</strong><span>${escapeHTML(address||'—')}</span></div>
        <dl class="classification-detail-list">${details}</dl>
        <div class="card-media-slot"></div>
        <div class="classification-links"><a href="${escapeHTML(safeLink(address,row))}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a>${sources}</div>
      </div>
    </details>`;
  const more=card.querySelector('.typology-more');
  more.addEventListener('toggle',()=>{
    if(more.open&&!more.dataset.mediaRequested){
      more.dataset.mediaRequested='true';
      addMediaToCard(card,row,serial).catch(e=>console.warn('Typology media:',e));
    }
  });
  return card;
}

function addClassificationCards(target,rows,serial,cardRenderer=classificationCard){
  if(!rows.length){target.innerHTML='<p class="classification-column-empty">No matching projects.</p>';return;}
  const ordered=[...rows].sort((a,b)=>displayTitle(a).localeCompare(displayTitle(b)));
  for(const row of ordered)target.appendChild(cardRenderer(row,serial));
}
function makeClassificationColumn(index,title,description,number,extraClass=''){
  const col=document.createElement('section');
  col.className=`classification-column ${extraClass}`;
  col.innerHTML=`<div class="classification-column-head"><span class="classification-column-number">${String(index+1).padStart(2,'0')}</span><span class="classification-column-count">${number} ${number===1?'property':'properties'}</span><h3>${escapeHTML(title)}</h3><p>${escapeHTML(description)}</p></div><div class="classification-cards"></div>`;
  return col;
}
// A compact project list for the eight-column overview. The original full
// classificationCard() is reused only inside the detail modal.
function improvementListButton(row){
  const button=document.createElement('button');
  button.type='button';
  button.className='improvement-list-item';
  button.dataset.recordIndex=String(propertyRows.indexOf(row));
  button.setAttribute('aria-label',`View improvement details for ${displayTitle(row)}, ${shortAddress(row)}`);
  button.innerHTML=`<strong>${escapeHTML(displayTitle(row))}</strong><span>${escapeHTML(shortAddress(row))}</span>`;
  return button;
}
let modalReturnFocus=null;
let modalSatellite=null;
function openImprovementModal(row){
  if(!row)return;
  closeImprovementModal(false);
  const overlay=$('improvement-modal');
  modalReturnFocus=document.activeElement;
  $('improvement-modal-title').textContent=displayTitle(row);
  const body=$('improvement-modal-content');
  body.replaceChildren();
  const card=classificationCard(row,renderSerial);
  body.appendChild(card);
  overlay.hidden=false;
  document.body.classList.add('modal-open');
  // The detail view opens in full; no second "More info" click is required.
  const details=card.querySelector('.classification-more');
  details.open=true;
  const satellite=card.querySelector('.card-satellite-map');
  requestAnimationFrame(()=>{
    if(overlay.hidden || !satellite || !satellite.isConnected)return;
    mountCardSatellite(satellite);
    modalSatellite=cardMaps.find(m=>m.getContainer()===satellite)||null;
    if(modalSatellite)modalSatellite.invalidateSize();
  });
  $('improvement-modal-close').focus();
}
function closeImprovementModal(restoreFocus=true){
  const overlay=$('improvement-modal');
  if(!overlay || overlay.hidden)return;
  overlay.hidden=true;
  document.body.classList.remove('modal-open');
  if(modalSatellite){
    const instance=modalSatellite;
    cardMaps=cardMaps.filter(m=>m!==instance);
    instance.remove();
    modalSatellite=null;
  }
  $('improvement-modal-content').replaceChildren();
  if(restoreFocus && modalReturnFocus?.isConnected)modalReturnFocus.focus();
  modalReturnFocus=null;
}
function renderImprovementClassification(){
  const search=$('improvement-search').value.trim().toLowerCase();
  const all=propertyRows.filter(row=>improvementTypesForRow(row).length);
  $('improvement-total').textContent=labelLocationCount(all.length);
  $('tab-improvement-count').textContent=labelLocationCount(all.length);
  const filtered=all.filter(row=>!search||searchable(row).includes(search));
  const serial=++renderSerial;
  disposeCardMaps();
  const target=$('improvement-columns');target.replaceChildren();
  IMPROVEMENT_TYPES.forEach((type,index)=>{
    const rows=filtered.filter(row=>improvementTypesForRow(row).includes(type));
    const column=makeClassificationColumn(index,type.label,type.description,rows.length);
    const list=column.querySelector('.classification-cards');
    if(!rows.length){list.innerHTML='<p class="classification-column-empty">No matching projects.</p>';}
    else for(const row of [...rows].sort((a,b)=>displayTitle(a).localeCompare(displayTitle(b)))){
      list.appendChild(improvementListButton(row));
    }
    target.appendChild(column);
  });
}
function diagramMarkup(diagram,name){
  // User's eight JPEGs live in DIAGRAM, alongside DATA, never inside DATA.
  const src='DIAGRAM/'+encodeURIComponent(diagram);
  return `<div class="typology-diagram"><img src="${escapeHTML(src)}" loading="lazy" alt="${escapeHTML(name)} site layout diagram" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="diagram-unavailable" hidden>Diagram not found<br><small>DIAGRAM/${escapeHTML(diagram)}</small></span></div>`;
}
const TYPOLOGY_SCALES=[1,1.25,1.5,1.75,2,2.5];
let typologySizeStep=0;
function updateTypologySize(){
  const scroller=$('typology-scroller');
  if(!scroller)return;
  const scale=TYPOLOGY_SCALES[typologySizeStep];
  scroller.classList.toggle('typology-zoomed',typologySizeStep>0);
  if(typologySizeStep){
    const width=Math.max(1,scroller.clientWidth);
    const gap=8;
    const fit=(width-7*gap)/8;
    scroller.style.setProperty('--typology-column-width',`${Math.round(Math.max(95,fit)*scale)}px`);
  }else scroller.style.removeProperty('--typology-column-width');
  $('typology-zoom-label').textContent=typologySizeStep===0?'Fit all 8':`${Math.round(scale*100)}%`;
  $('typology-zoom-out').disabled=typologySizeStep===0;
  $('typology-zoom-in').disabled=typologySizeStep===TYPOLOGY_SCALES.length-1;
  syncFrozenHeaderX();
  // Satellite tiles need to update after a column resizes.
  requestAnimationFrame(()=>cardMaps.forEach(m=>{if(m.getContainer().isConnected)m.invalidateSize();}));
}
function adjustTypologySize(delta){
  typologySizeStep=Math.min(TYPOLOGY_SCALES.length-1,Math.max(0,typologySizeStep+delta));
  updateTypologySize();
}
function renderPropertyTypology(){
  const search=$('typology-search').value.trim().toLowerCase();
  const withImprovement=$('typology-with').checked;
  const withoutImprovement=$('typology-without').checked;
  const assigned=propertyRows.filter(row=>TYPOLOGY_TYPES.some(t=>t.name===str(row.Property_Typology)));
  $('typology-total').textContent=labelLocationCount(assigned.length);
  $('tab-typology-count').textContent=labelLocationCount(assigned.length);
  const filtered=assigned.filter(row=>(!search||searchable(row).includes(search))&&
    (hasClassifiedImprovement(row)?withImprovement:withoutImprovement));
  const serial=++renderSerial;
  disposeCardMaps();
  const target=$('typology-columns');target.replaceChildren();
  const frozen=$('typology-frozen-columns');frozen.replaceChildren();
  // Every column occupies the same eight CSS subgrid rows.  This keeps the
  // description baseline, improvement methods, With/Without headers and the
  // right-aligned counts perfectly level across all eight typologies, even
  // when a column has fewer chips or project cards.
  TYPOLOGY_TYPES.forEach((type,index)=>{
    const rows=filtered.filter(row=>str(row.Property_Typology)===type.name);
    const improved=rows.filter(hasClassifiedImprovement);
    const unimproved=rows.filter(row=>!hasClassifiedImprovement(row));
    const column=document.createElement('section');
    column.className='classification-column typology-aligned-column '+(index<5?'owned-entire':'owned-partial');
    column.innerHTML=`
      <div class="typology-freeze-head">
      <div class="typology-aligned-title">
        <div class="typology-aligned-titleline"><span class="classification-column-number">${String(index+1).padStart(2,'0')}</span>
          <span class="classification-column-count">${rows.length} ${rows.length===1?'property':'properties'}</span></div>
        <h3>${escapeHTML(type.name)}</h3>
      </div>
      ${diagramMarkup(type.diagram,type.name)}
      </div>
      <p class="typology-aligned-description">${escapeHTML(type.description)}</p>
      <div class="typology-methods">
        <div class="typology-methods-label">IMPROVEMENT METHODS</div>
        <div class="typology-method-chips">${typologyMethodGrid(type)}</div>
      </div>
      <h4 class="classification-status-heading with-status typology-aligned-status" ${withImprovement?'':'hidden'}>WITH IMPROVEMENT <b>${improved.length}</b></h4>
      <div class="typology-aligned-projects typology-projects-with" ${withImprovement?'':'hidden'}></div>
      <h4 class="classification-status-heading without-status typology-aligned-status" ${withoutImprovement?'':'hidden'}>WITHOUT IMPROVEMENT <b>${unimproved.length}</b></h4>
      <div class="typology-aligned-projects typology-projects-without" ${withoutImprovement?'':'hidden'}></div>`;
    if(withImprovement)addClassificationCards(column.querySelector('.typology-projects-with'),improved,serial,propertyTypologyCard);
    if(withoutImprovement)addClassificationCards(column.querySelector('.typology-projects-without'),unimproved,serial,propertyTypologyCard);
    const headerColumn=document.createElement('section');
    headerColumn.className=column.className+' typology-frozen-column';
    headerColumn.appendChild(column.querySelector('.typology-freeze-head'));
    frozen.appendChild(headerColumn);
    target.appendChild(column);
  });
  observeCardSatellites('page-typology');
  syncFrozenHeaderX();
}

// ===== Ownership → layout hierarchy, derived entirely from the unified CSV =====
const layoutName = row => str(row.Retail_Center_Type) || 'Unclassified Layout';
function fillLayoutFilter() {
  const select=$('tax-layout-filter'), old=select.value;
  const names=[...new Set(propertyRows.map(layoutName))].sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'}));
  select.innerHTML='<option value="all">All layout types</option>'+names.map(name=>`<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');
  select.value=[...select.options].some(option=>option.value===old)?old:'all';
}
function scheduleGroupSort(a,b,key){
  if(key==='Property_Ownership_Type'){
    const ai=OWNER_TYPES.findIndex(x=>x.key===a),bi=OWNER_TYPES.findIndex(x=>x.key===b);
    return (ai<0?99:ai)-(bi<0?99:bi);
  }
  if(key==='Tenant_Mix_Type'){
    const ai=MIX_ORDER.indexOf(a),bi=MIX_ORDER.indexOf(b);
    return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b);
  }
  if(a==='Not documented')return 1;
  if(b==='Not documented')return -1;
  return a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
}
function fillMixFilter(){
  const types=[...new Set(propertyRows.map(row=>str(row.Tenant_Mix_Type)||'Not documented'))]
    .sort((a,b)=>scheduleGroupSort(a,b,'Tenant_Mix_Type'));
  for(const id of ['tax-mix-filter','mix-type-filter']){
    const select=$(id),old=select.value;
    select.innerHTML='<option value="all">All tenant mix types</option>'+types.map(value=>`<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join('');
    select.value=[...select.options].some(o=>o.value===old)?old:'all';
  }
}
function fillTenantLayoutFilter(){
  const select=$('mix-layout-filter'),old=select.value;
  const layouts=[...new Set(propertyRows.map(layoutName))].sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'}));
  select.innerHTML='<option value="all">All layout types</option>'+layouts.map(value=>`<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join('');
  select.value=[...select.options].some(o=>o.value===old)?old:'all';
}
function tenantTaxonomyFilter(row){
  const q=$('mix-search').value.trim().toLowerCase();
  const owner=$('mix-owner-filter').value;
  const mix=$('mix-type-filter').value;
  const layout=$('mix-layout-filter').value;
  return (!q||searchable(row).includes(q))&&
    (owner==='all'||normOwner(row.Property_Ownership_Type)===owner)&&
    (mix==='all'||(str(row.Tenant_Mix_Type)||'Not documented')===mix)&&
    (layout==='all'||layoutName(row)===layout);
}

function taxonomyFilter(row) {
  const query=$('tax-search').value.trim().toLocaleLowerCase();
  const owner=$('tax-owner-filter').value;
  const type=$('tax-layout-filter').value;
  const mix=$('tax-mix-filter').value;
  return (!query||searchable(row).includes(query)) &&
         (owner==='all'||normOwner(row.Property_Ownership_Type)===owner) &&
         (type==='all'||layoutName(row)===type) &&
         (mix==='all'||(str(row.Tenant_Mix_Type)||'Not documented')===mix);
}
function projectMiniField(label,value,kind) {
  return `<div class="taxonomy-mini-field"><span>${escapeHTML(label)}</span><strong>${escapeHTML(formatted(value,kind))}</strong></div>`;
}
function taxonomyProjectCard(row){
  const title=displayTitle(row),addr=shortAddress(row),id=rowId(row);
  const lat=Number(row.Latitude),lng=Number(row.Longitude);
  const coords=str(row.Latitude)&&str(row.Longitude)&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
  const mapMarkup=coords?`<div class="card-satellite-block taxonomy-satellite"><div class="card-satellite-heading"><span class="media-heading">SATELLITE MAP</span><span class="card-satellite-hint">Drag to pan · + / − to zoom</span></div><div class="card-satellite-map" data-lat="${lat}" data-lng="${lng}" data-zoom="15" role="region" aria-label="Satellite map for ${escapeHTML(title)}"></div></div>`:'<div class="taxonomy-map-empty">No coordinates in CSV</div>';
  const meta=[
    projectMiniField('OSJL AREA',row.OSJL_Area_SF,'sf'),
    projectMiniField('TOTAL GLA',row.Total_GLA_SF,'sf'),
    ...(str(row.Available)?[projectMiniField('AVAILABLE · Q1 2026',row.Available),projectMiniField('VACANT RATE · Q1 2026',row.Vacant_Rate||'Not quantifiable')]:[]),
    projectMiniField('OSJL POSITION',row.OSJL_Type),
    projectMiniField('ACQUIRED',row.Acquisition_Year),
    projectMiniField('LEASE / TRANSFER',row.Lease_Start_or_Transfer_Year),
    projectMiniField('KNOWN OWNER',row.Known_Property_Owner)
  ].join('');
  const more=[
    ...PORTFOLIO_FIELDS,
    ['Portfolio_Group','Portfolio group'],['Renovation','Renovation'],['Street_Address','Full address'],
    ['Acquisition_Source_URL','Acquisition source'],['Secondary_Source_URL','Secondary source']
  ].filter(([key])=>str(row[key])&&key!=='Tenants');
  const moreFields=more.map(([key,label,kind])=>{
    const value=str(row[key]),asLink=key.endsWith('_URL')&&/^https?:\/\//i.test(value);
    return `<div class="tax-detail-field"><dt>${escapeHTML(label)}</dt><dd>${asLink?`<a target="_blank" rel="noopener noreferrer" href="${escapeHTML(value)}">Open source ↗</a>`:escapeHTML(formatted(value,kind))}</dd></div>`;
  }).join('');
  const mix=str(row.Tenant_Mix_Type);
  return `<article class="taxonomy-project-card">
    <div class="tax-project-top"><span class="tax-project-id">${escapeHTML(id)}</span><span class="tax-project-location">${escapeHTML(str(row.State))}</span></div>
    <h4>${escapeHTML(title)}</h4><div class="tax-project-address">${escapeHTML(addr)}</div>
    <div class="tax-card-tags">${ownerBadge(row)}${mix?`<span class="tax-mix-badge">${escapeHTML(mix)}</span>`:''}</div>
    <div class="taxonomy-mini-fields">${meta}</div>
    ${str(row.Tenants)?`<div class="tax-project-tenants"><strong>TENANTS</strong><span>${escapeHTML(row.Tenants)}</span></div>`:''}
    <details class="tax-extra-details"><summary>More property information</summary><dl>${moreFields}</dl></details>
    ${mapMarkup}
    <div class="tax-project-footer"><a target="_blank" rel="noopener noreferrer" href="${escapeHTML(safeLink(addr,row))}">Open in Google Maps ↗</a></div>
  </article>`;
}

// Maintain separate expansion state for the layout and tenant-mix trees.
function expandedTaxonomyState(containerId){
  const state=new Map();
  document.querySelectorAll(`#${containerId} details[data-tree-key]`).forEach(el=>state.set(el.dataset.treeKey,el.open));
  return state;
}
function renderTaxonomyView(mode){
  const tenant=mode==='tenant',prefix=tenant?'mix':'tax';
  const resultsId=tenant?'mix-results':'taxonomy-results';
  const previous=expandedTaxonomyState(resultsId);
  const filtered=propertyRows.filter(tenant?tenantTaxonomyFilter:taxonomyFilter);
  $(prefix+'-visible-count').textContent=`${labelLocationCount(filtered.length)} shown`;
  $(prefix+'-total').textContent=labelLocationCount(propertyRows.length);
  $('tab-'+(tenant?'tenant':'tax')+'-count').textContent=labelLocationCount(propertyRows.length);
  const overview=$(tenant?'mix-tree':'taxonomy-tree'),results=$(resultsId);
  disposeCardMaps();
  if(tenant)populateTenantGuideMaps();
  if(!filtered.length){
    overview.innerHTML='<div class="tax-empty-message">No matching properties in the selected categories.</div>';
    results.innerHTML='<div class="empty-state">No matching projects.</div>';
    if(tenant)observeCardSatellites('page-tenant');
    return;
  }
  const categories=OWNER_TYPES.map(owner=>({owner,rows:filtered.filter(r=>normOwner(r.Property_Ownership_Type)===owner.key)})).filter(group=>group.rows.length);
  const overviewRows=[],groupRows=[];
  for(const {owner,rows} of categories){
    const ownerIndex=OWNER_TYPES.findIndex(o=>o.key===owner.key);
    const ownerId=`${prefix}-owner-${ownerIndex}`;
    const byType=new Map();
    for(const row of rows){
      const label=tenant?(str(row.Tenant_Mix_Type)||'Not documented'):layoutName(row);
      if(!byType.has(label))byType.set(label,[]);
      byType.get(label).push(row);
    }
    const types=[...byType.entries()].sort((a,b)=>tenant?
      scheduleGroupSort(a[0],b[0],'Tenant_Mix_Type'):
      b[1].length-a[1].length||a[0].localeCompare(b[0]));
    const typeButtons=types.map(([label,projects],i)=>`<button type="button" data-jump="${ownerId}-type-${i}" class="tree-type-pill">${escapeHTML(label)} <b>${projects.length}</b></button>`).join('');
    overviewRows.push(`<div class="tree-owner-branch" style="--branch-color:${owner.color}">
      <button type="button" data-jump="${ownerId}" class="tree-owner-node"><i></i><span>${escapeHTML(owner.label)}</span><b>${rows.length}</b></button>
      <div class="tree-type-rail">${typeButtons}</div></div>`);
    const typeDetails=types.map(([label,projects],i)=>{
      const key=`${owner.key}::${label}`;
      const open=previous.has(key)?previous.get(key):true;
      const cards=projects.map(taxonomyProjectCard).join('');
      return `<details class="taxonomy-layout-group" data-tree-key="${escapeHTML(key)}" id="${ownerId}-type-${i}" ${open?'open':''}>
        <summary class="taxonomy-layout-heading"><span class="type-branch-icon" aria-hidden="true"></span><span class="layout-name">${escapeHTML(label)}</span><span class="type-count">${projects.length} ${projects.length===1?'property':'properties'}</span><span class="disclosure-chevron" aria-hidden="true"></span></summary>
        <div class="taxonomy-card-grid">${cards}</div></details>`;
    }).join('');
    const open=previous.has(owner.key)?previous.get(owner.key):true;
    groupRows.push(`<details class="taxonomy-owner-group" data-tree-key="${escapeHTML(owner.key)}" id="${ownerId}" style="--branch-color:${owner.color}" ${open?'open':''}>
      <summary class="taxonomy-owner-heading"><span class="tax-owner-symbol" aria-hidden="true"></span><span class="owner-heading-body"><strong>${escapeHTML(owner.label)}</strong><small>${types.length} ${tenant?'tenant mix':'layout'} ${types.length===1?'type':'types'}</small></span><span class="owner-heading-count">${rows.length}</span><span class="disclosure-chevron" aria-hidden="true"></span></summary>
      <div class="taxonomy-layout-list">${typeDetails}</div></details>`);
  }
  overview.innerHTML=`<div class="tree-root-label"><span class="root-symbol">◆</span><span>OSJL PROPERTY PORTFOLIO</span><b>${filtered.length}</b></div><div class="tree-trunk" aria-hidden="true"></div><div class="tree-branches">${overviewRows.join('')}</div>`;
  results.innerHTML=groupRows.join('');
  observeCardSatellites(tenant?'page-tenant':'page-taxonomy');
}
function renderTaxonomy(){renderTaxonomyView('taxonomy');}
// Fill example satellite views from the unified CSV.
// Use Store_ID or Property_Record_ID; multiple properties may share a city.
function populateTenantGuideMaps(){
  const typeCounts=new Map();
  for(const row of propertyRows){
    const type=str(row.Tenant_Mix_Type);
    typeCounts.set(type,(typeCounts.get(type)||0)+1);
  }
  for(const card of document.querySelectorAll('#page-tenant .tenant-guide-card[data-tenant-type]')){
    const n=typeCounts.get(card.dataset.tenantType)||0;
    const count=card.querySelector('[data-guide-count]');
    if(count) count.textContent=`${n} ${n===1?'property':'properties'}`;
  }
  for(const slot of document.querySelectorAll('#page-tenant .tenant-guide-map-slot[data-example-store-id]')){
    const id=str(slot.dataset.exampleStoreId);
    const row=propertyRows.find(r=>rowId(r).toUpperCase()===id.toUpperCase());
    if(!row){
      slot.innerHTML='<span class="tenant-guide-map-missing">Example project not found in unified CSV.</span>';
      delete slot.dataset.mapCoordinates;
      continue;
    }
    const lat=Number(row.Latitude),lng=Number(row.Longitude);
    if(!str(row.Latitude)||!str(row.Longitude)||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180){
      slot.innerHTML='<span class="tenant-guide-map-missing">Satellite coordinates unavailable.</span>';
      delete slot.dataset.mapCoordinates;
      continue;
    }
    const signature=`${lat},${lng}`;
    if(slot.dataset.mapCoordinates===signature && slot.querySelector('.card-satellite-map'))continue;
    slot.dataset.mapCoordinates=signature;
    const name=str(slot.dataset.exampleName)||displayTitle(row);
    const mapURL=safeLink(shortAddress(row),row);
    slot.innerHTML=`<div class="card-satellite-map tenant-guide-satellite-map" data-lat="${lat}" data-lng="${lng}" data-zoom="16" role="region" aria-label="Satellite map of ${escapeHTML(name)}"></div>
      <div class="tenant-guide-map-caption"><span>${escapeHTML(name)}</span><a href="${escapeHTML(mapURL)}" target="_blank" rel="noopener noreferrer" aria-label="View ${escapeHTML(name)} on Google Maps">Google Maps ↗</a></div>`;
  }
}

// Tenant guide: one portfolio-wide modal per category, independent of the
// ownership tree filters. Its lazy satellite maps have a separate lifecycle.
let tenantGuideModalType=null,tenantGuideReturnFocus=null;
let tenantGuideModalObserver=null,tenantGuideModalMaps=[];
function disposeTenantGuideModalMaps(){
  if(tenantGuideModalObserver){tenantGuideModalObserver.disconnect();tenantGuideModalObserver=null;}
  tenantGuideModalMaps.forEach(instance=>instance.remove());
  tenantGuideModalMaps=[];
}
function renderTenantGuideModal(){
  const dialog=$('tenant-guide-modal');
  if(!dialog.open || tenantGuideModalType===null)return;
  const content=$('tenant-guide-modal-content');
  const previousScroll=content.scrollTop;
  disposeTenantGuideModalMaps();
  const rows=propertyRows.filter(row=>str(row.Tenant_Mix_Type)===tenantGuideModalType)
    .sort((a,b)=>displayTitle(a).localeCompare(displayTitle(b))||shortAddress(a).localeCompare(shortAddress(b))||rowId(a).localeCompare(rowId(b)));
  $('tenant-guide-modal-title').textContent=tenantGuideModalType;
  $('tenant-guide-modal-count').textContent=`${labelLocationCount(rows.length)} / ${labelLocationCount(propertyRows.length)}`;
  $('tenant-guide-modal-count-label').textContent='PROPERTIES IN PORTFOLIO';
  const grid=$('tenant-guide-modal-grid');
  grid.innerHTML=rows.length?rows.map(taxonomyProjectCard).join(''):'<div class="empty-state">No properties in this category.</div>';
  content.scrollTop=previousScroll;
  const elements=[...grid.querySelectorAll('.card-satellite-map')];
  if(typeof L==='undefined'){
    elements.forEach(el=>{el.textContent='Satellite map unavailable.';el.classList.add('tenant-modal-map-fallback');});
    return;
  }
  if('IntersectionObserver' in window){
    tenantGuideModalObserver=new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(!entry.isIntersecting||!dialog.open||!entry.target.isConnected)continue;
        mountCardSatellite(entry.target,tenantGuideModalMaps);
        tenantGuideModalObserver?.unobserve(entry.target);
      }
    },{root:content,rootMargin:'240px 0px',threshold:0.01});
    elements.forEach(el=>tenantGuideModalObserver.observe(el));
  }else elements.forEach(el=>mountCardSatellite(el,tenantGuideModalMaps));
}
function openTenantGuideModal(type,trigger){
  if(!MIX_ORDER.includes(type))return;
  const dialog=$('tenant-guide-modal');
  if(dialog.open)return;
  tenantGuideModalType=type;
  tenantGuideReturnFocus=trigger;
  $('tenant-guide-modal-content').scrollTop=0;
  dialog.showModal();
  document.body.classList.add('tenant-guide-modal-open');
  renderTenantGuideModal();
  $('tenant-guide-modal-content').scrollTop=0;
  $('tenant-guide-modal-close').focus();
}
function closeTenantGuideModal(restoreFocus=true){
  const dialog=$('tenant-guide-modal');
  if(!dialog||!dialog.open)return;
  dialog.close();
  disposeTenantGuideModalMaps();
  $('tenant-guide-modal-grid').replaceChildren();
  document.body.classList.remove('tenant-guide-modal-open');
  tenantGuideModalType=null;
  if(restoreFocus&&tenantGuideReturnFocus?.isConnected)tenantGuideReturnFocus.focus({preventScroll:true});
  tenantGuideReturnFocus=null;
}
function initTenantGuideModal(){
  const dialog=$('tenant-guide-modal');
  $('tenant-guide-cards').addEventListener('click',event=>{
    const card=event.target.closest('.tenant-guide-card[data-tenant-type]');
    // Keep the original map pan/zoom and Google Maps links independent.
    if(!card||event.target.closest('.card-satellite-map,a'))return;
    openTenantGuideModal(card.dataset.tenantType,card.querySelector('.tenant-guide-open'));
  });
  $('tenant-guide-modal-close').addEventListener('click',()=>closeTenantGuideModal());
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeTenantGuideModal();});
  dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;
    const rect=dialog.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeTenantGuideModal();
  });
}

function renderTenantMix(){renderTaxonomyView('tenant');}
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
function paintHeader(){
  $('map-total').textContent=labelLocationCount(propertyRows.length);
  $('tab-map-count').textContent=labelLocationCount(propertyRows.length);
  const n=propertyRows.filter(row=>renovationCategory(row.Renovation)!=='blank'&&normOwner(row.Property_Ownership_Type)!=='Unknown').length;
  $('tab-reno-count').textContent=labelLocationCount(n);
  $('reno-total').textContent=labelLocationCount(n);
  $('tab-tax-count').textContent=labelLocationCount(propertyRows.length);
  $('tax-total').textContent=labelLocationCount(propertyRows.length);
  $('tab-tenant-count').textContent=labelLocationCount(propertyRows.length);
  $('mix-total').textContent=labelLocationCount(propertyRows.length);
  $('tab-improvement-count').textContent=labelLocationCount(propertyRows.filter(r=>improvementTypesForRow(r).length).length);
  $('improvement-total').textContent=$('tab-improvement-count').textContent;
  $('tab-typology-count').textContent=labelLocationCount(propertyRows.filter(r=>TYPOLOGY_TYPES.some(t=>t.name===str(r.Property_Typology))).length);
  $('typology-total').textContent=$('tab-typology-count').textContent;
  $('tab-available-count').textContent=labelLocationCount(propertyRows.filter(row=>str(row.Available)).length);
  $('available-total').textContent=$('tab-available-count').textContent;
}

function fetchText(path) {
  const url=path+(path.includes('?')?'&':'?')+'_='+Date.now();
  return fetch(url,{cache:'no-store'}).then(res=>{
    if(!res.ok)throw new Error(`${path}: HTTP ${res.status}`);return res.text();
  });
}
function applyCSVText(csvText,force=false){
  const changed=force||csvText!==previousCSVText;
  if(changed){
    const rows=csvRows(csvText);
    if(!rows.length)throw Error('OSJL_183_Stores.csv is empty.');
    const needed=['Store_ID','Property_Record_ID','Latitude','Longitude','Property_Ownership_Type',
      'Tenant_Mix_Type','Retail_Center_Type','Renovation'];
    const missing=needed.filter(key=>!Object.hasOwn(rows[0],key));
    if(missing.length)throw Error('CSV is missing required columns: '+missing.join(', '));
    const used=new Set();
    for(const row of rows){
      const id=rowId(row);
      if(id==='NO ID')throw Error('A property is missing both Store_ID and Property_Record_ID.');
      if(used.has(id))throw Error('Duplicate Store_ID / Property_Record_ID: '+id);
      used.add(id);
    }
    propertyRows=rows;
    previousCSVText=csvText;
    fillLayoutFilter();fillMixFilter();fillTenantLayoutFilter();
    makeMarkers();
    if(activeTab==='renovation')renderRenovation();
    if(activeTab==='improvement')renderImprovementClassification();
    if(activeTab==='typology')renderPropertyTypology();
    if(activeTab==='taxonomy')renderTaxonomy();
    if(activeTab==='tenant'){renderTenantMix();renderTenantGuideModal();}
    if(activeTab==='available')renderAvailableSpace();
  }
  paintHeader();
  $('error-notice').hidden=true;
}

function reportCSVError(error){
  console.error(error);
  const direct=window.location.protocol==='file:';
  const help=direct
    ? 'Use the “Choose CSV” button for direct file mode, or run a local HTTP server as described in README.txt.'
    : 'Ensure DATA/OSJL_183_Stores.csv exists with the exact filename and the site is served over HTTP(S).';
  $('error-notice').innerHTML=`<strong>Unable to read the CSV.</strong> ${escapeHTML(error.message)}<br>${escapeHTML(help)}`;
  $('error-notice').hidden=false;
}

async function reloadData(force=false){
  if(updating)return;
  if(window.location.protocol==='file:'){
    if(force)$('csv-file-input').click();
    else if(!previousCSVText)reportCSVError(new Error('Direct file mode requires selecting the CSV once.'));
    return;
  }
  updating=true;
  try{
    const csvText=await fetchText(CONFIG.csv);
    applyCSVText(csvText,force);
  }catch(e){reportCSVError(e);}
  finally{updating=false;}
}

async function loadLocalCSV(file){
  if(!file)return;
  try{
    applyCSVText(await file.text(),true);
  }catch(e){reportCSVError(e);}
}


// Native sticky header rows: only horizontal scroll positions are synchronized.
function syncFrozenHeaderX(){
  const x=$('typology-scroll-body').scrollLeft;
  $('typology-header-viewport').scrollLeft=x;
  $('typology-ownership-viewport').scrollLeft=x;
  $('available-header-viewport').scrollLeft=$('available-columns').scrollLeft;
}
function initFrozenHeaders(){
  $('typology-scroll-body').addEventListener('scroll',syncFrozenHeaderX,{passive:true});
  $('available-columns').addEventListener('scroll',syncFrozenHeaderX,{passive:true});
  window.addEventListener('resize',syncFrozenHeaderX,{passive:true});
}

function init(){
  initFrozenHeaders();
  fillOwnerFilters();
  $('csv-file-button').hidden=window.location.protocol!=='file:';
  $('csv-file-button').addEventListener('click',()=>$('csv-file-input').click());
  $('csv-file-input').addEventListener('change',e=>loadLocalCSV(e.target.files[0]));
  document.querySelectorAll('[data-tab]').forEach(tab=>tab.addEventListener('click',()=>setTab(tab.dataset.tab)));
  $('map-search').addEventListener('input',updateVisibleMarkers);
  $('ownership-legend').addEventListener('change',e=>{
    const input=e.target.closest('input[data-owner]');if(!input)return;
    if(input.checked)mapOwnerSelection.add(input.dataset.owner);else mapOwnerSelection.delete(input.dataset.owner);
    updateVisibleMarkers();
  });
  $('owner-select-all').addEventListener('click',()=>{OWNER_TYPES.forEach(t=>mapOwnerSelection.add(t.key));updateVisibleMarkers();});
  $('owner-clear').addEventListener('click',()=>{mapOwnerSelection.clear();updateVisibleMarkers();});
  $('reno-search').addEventListener('input',renderRenovation);
  $('reno-owner-filter').addEventListener('change',renderRenovation);
  $('tax-search').addEventListener('input',renderTaxonomy);
  $('tax-owner-filter').addEventListener('change',renderTaxonomy);
  $('tax-layout-filter').addEventListener('change',renderTaxonomy);
  $('tax-mix-filter').addEventListener('change',renderTaxonomy);
  $('taxonomy-tree').addEventListener('click',jumpToTaxonomyBranch);
  $('tax-expand').addEventListener('click',()=>document.querySelectorAll('#taxonomy-results details').forEach(d=>d.open=true));
  $('tax-collapse').addEventListener('click',()=>document.querySelectorAll('#taxonomy-results details').forEach(d=>d.open=false));
  initTenantGuideModal();
  $('mix-search').addEventListener('input',renderTenantMix);
  $('mix-owner-filter').addEventListener('change',renderTenantMix);
  $('mix-type-filter').addEventListener('change',renderTenantMix);
  $('mix-layout-filter').addEventListener('change',renderTenantMix);
  $('mix-tree').addEventListener('click',jumpToTaxonomyBranch);
  $('mix-expand').addEventListener('click',()=>document.querySelectorAll('#mix-results details').forEach(d=>d.open=true));
  $('mix-collapse').addEventListener('click',()=>document.querySelectorAll('#mix-results details').forEach(d=>d.open=false));
  $('improvement-search').addEventListener('input',renderImprovementClassification);
  $('available-search').addEventListener('input',renderAvailableSpace);
  $('improvement-columns').addEventListener('click',event=>{
    const button=event.target.closest('button[data-record-index]');
    if(!button)return;
    openImprovementModal(propertyRows[Number(button.dataset.recordIndex)]);
  });
  $('improvement-modal-close').addEventListener('click',()=>closeImprovementModal());
  $('improvement-modal').addEventListener('click',event=>{
    if(event.target===$('improvement-modal'))closeImprovementModal();
  });
  $('improvement-modal').addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const dialog=$('improvement-modal');
    const focusable=[...dialog.querySelectorAll('button:not([disabled]),a[href],summary,[tabindex="0"]')]
      .filter(el=>el.getClientRects().length>0);
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  $('typology-zoom-out').addEventListener('click',()=>adjustTypologySize(-1));
  $('typology-zoom-in').addEventListener('click',()=>adjustTypologySize(1));
  window.addEventListener('resize',updateTypologySize);
  updateTypologySize();
  $('typology-search').addEventListener('input',renderPropertyTypology);
  $('typology-with').addEventListener('change',renderPropertyTypology);
  $('typology-without').addEventListener('change',renderPropertyTypology);
  $('lightbox-close').addEventListener('click',closeLightbox);
  $('lightbox').addEventListener('click',e=>{if(e.target===$('lightbox'))closeLightbox();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('lightbox').hidden)closeLightbox();else if(!$('tenant-guide-modal').open)closeImprovementModal();}});
  ensureMap();reloadData();
  setInterval(()=>{if(!document.hidden)reloadData();},CONFIG.refreshMilliseconds);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)reloadData();});
  window.addEventListener('focus',()=>reloadData());
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();


// ===== Q1 2026 Available Space =====
// In the source listing, a comma/"and" separates offerings, while a range
// (5,000–15,000 SF) describes ONE potentially configurable offering.
// Classify by INDIVIDUAL sizes; never label 4 small stores a big-box because
// their total happens to exceed 30,000 SF.
const AVAILABLE_GROUPS=[
  {key:'small',title:'Small Retail',description:'Individual retail offerings up to and including 10,000 SF.'},
  {key:'medium',title:'Medium Retail',description:'Individual retail offerings over 10,000 SF and up to 30,000 SF.'},
  {key:'large',title:'Large-Format Retail',description:'Individual retail offerings over 30,000 SF.'},
  {key:'pad',title:'Pad Sites',description:'Available pad sites, listed separately from the retail suite size. A property may also appear in another column.'},
  {key:'mixed',title:'Mixed Sizes',description:'Retail offerings spanning more than one size category, grouped below by their size combinations.'}
];
const AVAILABLE_SIZE_ORDER=['small','medium','large'];
const AVAILABLE_MIX_GROUPS=[
  {key:'small+medium',title:'Small + Medium'},
  {key:'small+large',title:'Small + Large'},
  {key:'medium+large',title:'Medium + Large'},
  {key:'small+medium+large',title:'Small + Medium + Large'}
];
function availableSizeForSf(sf){
  return sf<=10000?'small':sf<=30000?'medium':'large';
}
function availableHasPadSite(value){
  return /\bpad\s+sites?\b/i.test(str(value));
}
function availableGroupsForText(value){
  // Advertised pad acreage is LAND area, not a leasable building area.
  // Do not treat a pad site as a Small Retail space.
  let source=str(value).replace(/\b\d+(?:\.\d+)?\s*acres?\b/gi,'');
  if(!source)return [];
  const groups=new Set();
  for(const number of source.match(/\b\d[\d,]*\b/g)||[]){
    groups.add(availableSizeForSf(Number(number.replaceAll(',',''))));
  }
  // One configurable suite may span multiple size classes, e.g.
  // 10,000–34,084 SF spans Small, Medium AND Large at the chosen thresholds.
  // In contrast, 'up to 28,399 SF' has no stated minimum: classify by
  // its advertised maximum only, without inventing a smaller suite.
  const ranges=/(\d[\d,]*)\s*(?:SF\s*)?(?:-|–|—|\bto\b)\s*(\d[\d,]*)\s*SF\b/gi;
  let match;
  while((match=ranges.exec(source))!==null){
    const low=Number(match[1].replaceAll(',',''));
    const high=Number(match[2].replaceAll(',',''));
    const lowIndex=AVAILABLE_SIZE_ORDER.indexOf(availableSizeForSf(Math.min(low,high)));
    const highIndex=AVAILABLE_SIZE_ORDER.indexOf(availableSizeForSf(Math.max(low,high)));
    for(let i=lowIndex;i<=highIndex;i++)groups.add(AVAILABLE_SIZE_ORDER[i]);
  }
  return AVAILABLE_SIZE_ORDER.filter(type=>groups.has(type));
}
function availableGroupForRow(row){
  const groups=availableGroupsForText(row.Available);
  if(groups.length>1)return 'mixed';
  if(groups.length===1)return groups[0];
  if(availableHasPadSite(row.Available))return 'pad';
  return 'unclassified';
}
function availableMixGroupForRow(row){
  const groups=availableGroupsForText(row.Available);
  return groups.length>1?groups.join('+'):'';
}
function availabilityScopeSummary(row){
  const kind=scopeKind(row.Ownership_Scope);
  const labels={
    entire:'Entire Owned',partial:'Partial Owned',
    single:'Single Building / Parcel',undetermined:'Undetermined'
  };
  return {kind,label:labels[kind]};
}
function availableRateExplanation(row){
  const raw=str(row.Available);
  const hasPad=/pad\s+sites?/i.test(raw);
  const hasRange=/\d[\d,]*\s*(?:SF\s*to|[-–—])\s*\d[\d,]*\s*SF/i.test(raw);
  const hasUp=/\bup\s*(?:to)?\b/i.test(raw);
  if(!str(row.Vacant_Rate))return 'No SF area stated; a vacancy percentage cannot be calculated.';
  if(hasPad && (hasRange||hasUp))return 'Indicative maximum listed retail SF / GLA; pad-site area is excluded.';
  if(hasPad)return 'Listed SF / GLA; unsized pad-site area is excluded.';
  if(hasRange||hasUp)return 'Potential upper-bound: listed maximum sizes / GLA, not confirmed leased-vacant floor area.';
  return 'Sum of separately listed available SF / Total GLA.';
}
function availableSpaceCard(row,serial){
  const article=document.createElement('article');
  article.className='available-project-card';
  const loc=displayTitle(row),address=shortAddress(row);
  const ownershipScope=availabilityScopeSummary(row);
  const lat=Number(row.Latitude),lng=Number(row.Longitude);
  const valid=str(row.Latitude)&&str(row.Longitude)&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
  const mapMarkup=valid
    ? `<div class="card-satellite-map availability-satellite" data-lat="${lat}" data-lng="${lng}" data-zoom="15" role="region" aria-label="Satellite map of ${escapeHTML(loc)}"></div>`
    : '<div class="availability-satellite availability-no-map">Satellite coordinates unavailable</div>';
  const fields=[
    ['Property_Ownership_Type','Ownership type'],
    ['Ownership_Scope','Ownership scope'],
    ['Type_of_Space_Available','Space type'],
    ['Retail_Center_Type','Retail center layout'],
    ['Tenants','Tenants'],
    ['OSJL_Type','OSJL location'],
    ['OSJL_Area_SF','OSJL area','sf'],
    ['Land_Area_Acres','Land area','acres'],
    ['Acquisition_Year','Acquisition year'],
    ['Renovation','Renovation'],
    ['Previous_Retail_Use','Previous retail use'],
    ['Space_Availability_Reason','Availability reason'],
    ['Known_Property_Owner','Known owner'],
    ['Notes','Notes']
  ].filter(([key])=>str(row[key]));
  const body=fields.map(([key,label,kind])=>`<div class="classification-detail-field"><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(formatted(row[key],kind))}</dd></div>`).join('');
  const sources=[['Acquisition_Source_URL','Acquisition source'],['Secondary_Source_URL','Secondary source']]
    .filter(([key])=>/^https?:\/\//i.test(str(row[key])))
    .map(([key,label])=>`<a href="${escapeHTML(row[key])}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)} ↗</a>`).join('');
  article.innerHTML=`${mapMarkup}
    <div class="availability-card-body">
      <h4>${escapeHTML(loc)}</h4>
      <div class="availability-scope-row">
        <span>OWNERSHIP SCOPE</span>
        <strong class="availability-scope-badge availability-scope-${escapeHTML(ownershipScope.kind)}">${escapeHTML(ownershipScope.label)}</strong>
      </div>
      <div class="availability-metrics">
        <div><span>TOTAL GLA</span><strong>${escapeHTML(formatted(row.Total_GLA_SF,'sf'))}</strong></div>
        <div><span>VACANT RATE · Q1 2026</span><strong>${escapeHTML(str(row.Vacant_Rate)||'Not quantifiable')}</strong></div>
      </div>
      <div class="availability-listed"><span>AVAILABLE · Q1 2026</span><strong>${escapeHTML(row.Available)}</strong></div>
      <div class="availability-facts">
        <div><span>PROPERTY TYPOLOGY</span><strong>${escapeHTML(str(row.Property_Typology)||'Not classified')}</strong></div>
        <div><span>TENANT MIX TYPES</span><strong>${escapeHTML(str(row.Tenant_Mix_Type)||'Not classified')}</strong></div>
      </div>
    </div>
    <details class="classification-more availability-more">
      <summary>More info <span aria-hidden="true">⌄</span></summary>
      <div class="classification-more-body">
        <div class="classification-full-address"><strong>FULL ADDRESS</strong><span>${escapeHTML(address)}</span></div>
        <div class="availability-rate-note"><strong>VACANCY CALCULATION</strong><p>${escapeHTML(availableRateExplanation(row))}</p></div>
        <dl class="classification-detail-list">${body}</dl>
        <div class="card-media-slot"></div>
        <div class="classification-links"><a href="${escapeHTML(safeLink(address,row))}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a>${sources}</div>
      </div>
    </details>`;
  const details=article.querySelector('.availability-more');
  details.addEventListener('toggle',()=>{
    if(details.open && !details.dataset.mediaRequested){
      details.dataset.mediaRequested='true';
      addMediaToCard(article,row,serial).catch(e=>console.warn('Available-space media:',e));
    }
  });
  return article;
}
function renderAvailableSpace(){
  const all=propertyRows.filter(row=>str(row.Available));
  $('tab-available-count').textContent=labelLocationCount(all.length);
  $('available-total').textContent=labelLocationCount(all.length);
  const search=$('available-search').value.trim().toLowerCase();
  const filtered=all.filter(row=>!search||searchable(row).includes(search));
  $('available-visible').textContent=`${labelLocationCount(filtered.length)} unique properties shown`;
  const serial=++renderSerial;
  disposeCardMaps();
  const target=$('available-columns');target.replaceChildren();
  const frozen=$('available-frozen-columns');frozen.replaceChildren();
  for(const [index,group] of AVAILABLE_GROUPS.entries()){
    // Pad Sites is an independent, overlapping category. Coventry is shown
    // in BOTH Small Retail and Pad Sites, never Mixed just because of the pad.
    const groupRows=filtered.filter(row=>group.key==='pad'
      ? availableHasPadSite(row.Available)
      : availableGroupForRow(row)===group.key)
      .sort((a,b)=>displayTitle(a).localeCompare(displayTitle(b)));
    const column=document.createElement('section');
    column.className=`available-column available-column-${group.key}`;
    column.innerHTML=`<div class="available-column-head"><span class="available-column-kicker">${String(index+1).padStart(2,'0')} / ${group.key==='pad'?'SITE TYPE':group.key==='mixed'?'MIXED SIZES':'RETAIL SIZE'}</span><span class="available-column-count">${groupRows.length}</span><h3>${escapeHTML(group.title)}</h3><p>${escapeHTML(group.description)}</p></div><div class="available-column-content"></div>`;
    const content=column.querySelector('.available-column-content');
    if(group.key==='mixed' && groupRows.length){
      for(const mix of AVAILABLE_MIX_GROUPS){
        const matches=groupRows.filter(row=>availableMixGroupForRow(row)===mix.key);
        if(!matches.length)continue;
        const subsection=document.createElement('section');
        subsection.className='available-mix-subgroup';
        subsection.innerHTML=`<div class="available-mix-subhead"><h4>${escapeHTML(mix.title)}</h4><span>${matches.length}</span></div><div class="available-card-stack"></div>`;
        const stack=subsection.querySelector('.available-card-stack');
        for(const row of matches)stack.appendChild(availableSpaceCard(row,serial));
        content.appendChild(subsection);
      }
    }else{
      const stack=document.createElement('div');
      stack.className='available-card-stack';
      if(!groupRows.length)stack.innerHTML='<div class="empty-state">No matching projects.</div>';
      else for(const row of groupRows)stack.appendChild(availableSpaceCard(row,serial));
      content.appendChild(stack);
    }
    // Desktop uses the shared sticky row; mobile retains the original headers.
    const headerColumn=document.createElement('section');
    headerColumn.className=column.className+' available-frozen-column';
    headerColumn.appendChild(column.querySelector('.available-column-head').cloneNode(true));
    frozen.appendChild(headerColumn);
    target.appendChild(column);
  }
  observeCardSatellites('page-available');
  syncFrozenHeaderX();
}

// Brand assets live alongside DATA/ and DIAGRAM/ in the user's LOGO/ folder.
// If a logo is not yet copied, show a text fallback instead of a broken-image icon.
function initializeBrandLogos(){
  for(const [imageSelector,fallbackSelector] of [
    ['.brand-osjl-logo','.brand-logo-fallback'],
    ['.brand-arrowstreet-logo','.arrowstreet-logo-fallback']
  ]){
    const img=document.querySelector(imageSelector),fallback=document.querySelector(fallbackSelector);
    if(!img || !fallback)continue;
    const fail=()=>{img.hidden=true;fallback.hidden=false;};
    img.addEventListener('error',fail,{once:true});
    if(img.complete && img.naturalWidth===0)fail();
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initializeBrandLogos);else initializeBrandLogos();
