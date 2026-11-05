/* OSJL Property Atlas — DATA/ CSV files remain the single source of data. */
'use strict';
const CONFIG={
  storeCSV:'DATA/OSJL_183_Stores.csv',
  portfolioCSV:'DATA/OSJL_Property_Portfolio.csv',
  refreshMilliseconds:20000,
  defaultZoom:7
};
const OWNER_TYPES=[
  {key:'Owned + OSJL Store',label:'Owned + OSJL Store',color:'#287a50'},
  {key:'Owned + No OSJL Store',label:'Owned + No OSJL Store',color:'#287a50'},
  {key:'Leased OSJL Store',label:'Leased OSJL Store',color:'#4285b6'},
  {key:'Ground / Master Leased Property',label:'Ground / Master Leased',color:'#9259b0'},
  {key:'Unknown',label:'Unknown / Unverified',color:'#929b9e'}
];
// The center ownership scope has a separate visual encoding from tenure.
// Single Building / Parcel is deliberately NOT assumed to mean Entire or Partial Center.
const OWNED_SCOPE_COLORS={entire:'#146c3d',partial:'#8dd0aa',single:'#3c9b67',undetermined:'#c1d98b'};
const DISPLAY_FIELDS=[
  ['Property_Ownership_Type','Ownership type'],['Ownership_Scope','Owned scope'],
  ['Tenant_Mix_Type','Tenant mix'],['Retail_Center_Type','Retail center layout'],
  ['OSJL_Type','OSJL location'],['OSJL_Area_SF','OSJL area','sf'],
  ['Total_GLA_SF','Total GLA','sf'],['Land_Area_Acres','Land area','acres'],
  ['Acquisition_Year','Acquisition year'],['Lease_Start_or_Transfer_Year','Lease / transfer year'],
  ['Known_Property_Owner','Property owner'],['Previous_Retail_Use','Previous retail use'],
  ['Space_Availability_Reason','Space availability'],['Renovation','Renovation'],
  ['Tenants','Tenants'],['Type_of_Space_Available','Available space type'],
  ['Reported_Purchase_Price_USD','Purchase price','usd'],['Record_Type','Record type']
];
const PORTFOLIO_FIELDS=[
  ['Tenant_Mix_Type','Tenant mix'],['Retail_Center_Type','Retail center layout'],
  ['OSJL_Area_SF','OSJL area','sf'],['OSJL_Type','OSJL position'],
  ['Total_GLA_SF','Total GLA','sf'],['Land_Area_Acres','Land area','acres'],
  ['Acquisition_Year','Acquisition year'],['Lease_Start_or_Transfer_Year','Lease / transfer year'],
  ['Known_Property_Owner','Known property owner'],['Acquired_Asset_Type','Acquired asset type'],
  ['Previous_Retail_Use','Previous retail use'],['Space_Availability_Reason','Space availability reason'],
  ['Reported_Purchase_Price_USD','Reported purchase price','usd'],['Tenants','Tenants'],['Notes','Notes']
];
const SCHEDULE_FIELDS=[
  ['Property_Ownership_Type','Ownership type'],['Tenant_Mix_Type','Tenant mix type'],
  ['Retail_Center_Type','Retail center type'],['Ownership_Scope','Owned scope'],
  ['OSJL_Type','OSJL type'],['State','State'],['City','City'],
  ['Renovation_Status','Renovation status']
];
const MIX_ORDER=['OSJL Only','OSJL + Automotive','OSJL + Utility Retail','OSJL + Fitness','OSJL + Convenience','OSJL + Healthcare','OSJL + Mixed Services','Grocery-Anchored Retail','Retail, Services & Experiences','Other'];
let storeRows=[],portfolioRows=[],mapRows=[],previousStoreText=null,previousPortfolioText=null;
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
// Portfolio cells take precedence on matching rows, including intentionally cleared cells.
// Portfolio's N1/L2 identifiers match Property_Record_ID in the larger stores file.
function combineMapRows(){
  const portfolio=new Map(portfolioRows.map(row=>[str(row.Store_ID)||str(row.Property_Record_ID),row]));
  const consumed=new Set();
  const combined=storeRows.map(row=>{
    const id=str(row.Store_ID)||str(row.Property_Record_ID);
    const overlay=portfolio.get(id);
    if(!overlay)return row;
    consumed.add(id);
    return {...row,...overlay,Property_Record_ID:str(row.Property_Record_ID)||str(overlay.Property_Record_ID)};
  });
  for(const [id,row] of portfolio){if(!consumed.has(id))combined.push({...row});}
  return combined;
}

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
  if(!['map','renovation','taxonomy','tenant','schedule'].includes(tab))return;
  if(activeTab!==tab)disposeCardMaps();
  activeTab=tab;
  for(const name of ['map','renovation','taxonomy','tenant','schedule'])$('page-'+name).hidden=name!==tab;
  document.querySelectorAll('[data-tab]').forEach(btn=>{
    const active=btn.dataset.tab===tab;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-selected',String(active));
  });
  if(tab==='map'&&map)setTimeout(()=>map.invalidateSize(),50);
  if(tab==='renovation')renderRenovation();
  if(tab==='taxonomy')renderTaxonomy();
  if(tab==='tenant')renderTenantMix();
  if(tab==='schedule')renderSchedule();
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
function matchingMapRows(){return mapRows.filter(mapFilter());}

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
  mapRows.forEach(row=>{
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
  mapRows.forEach(row=>{const key=normOwner(row.Property_Ownership_Type);counts.set(key,counts.get(key)+1);});
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
function renderRenovation(){
  const classified=portfolioRows.filter(row=>renovationCategory(row.Renovation)!=='blank' && normOwner(row.Property_Ownership_Type)!=='Unknown');
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

// ===== Third tab: ownership → layout hierarchy, derived entirely from the portfolio CSV =====
const layoutName = row => str(row.Retail_Center_Type) || 'Unclassified Layout';
function fillLayoutFilter() {
  const select=$('tax-layout-filter'), old=select.value;
  const names=[...new Set(portfolioRows.map(layoutName))].sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'}));
  select.innerHTML='<option value="all">All layout types</option>'+names.map(name=>`<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');
  select.value=[...select.options].some(option=>option.value===old)?old:'all';
}
function fillMixFilter(){
  const types=[...new Set(portfolioRows.map(row=>str(row.Tenant_Mix_Type)||'Not documented'))]
    .sort((a,b)=>scheduleGroupSort(a,b,'Tenant_Mix_Type'));
  for(const id of ['tax-mix-filter','mix-type-filter']){
    const select=$(id),old=select.value;
    select.innerHTML='<option value="all">All tenant mix types</option>'+types.map(value=>`<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join('');
    select.value=[...select.options].some(o=>o.value===old)?old:'all';
  }
}
function fillTenantLayoutFilter(){
  const select=$('mix-layout-filter'),old=select.value;
  const layouts=[...new Set(portfolioRows.map(layoutName))].sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'}));
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
         (mix==='all'||str(row.Tenant_Mix_Type)===mix);
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
  const filtered=portfolioRows.filter(tenant?tenantTaxonomyFilter:taxonomyFilter);
  $(prefix+'-visible-count').textContent=`${labelLocationCount(filtered.length)} shown`;
  $(prefix+'-total').textContent=labelLocationCount(portfolioRows.length);
  $('tab-'+(tenant?'tenant':'tax')+'-count').textContent=labelLocationCount(portfolioRows.length);
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
// Fill the example satellite column from the authoritative portfolio CSV.
// Store_ID is used (not city alone) because some cities have multiple records.
function populateTenantGuideMaps(){
  const typeCounts=new Map();
  for(const row of portfolioRows){
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
    const row=portfolioRows.find(r=>str(r.Store_ID).toUpperCase()===id.toUpperCase());
    if(!row){
      slot.innerHTML='<span class="tenant-guide-map-missing">Example project not found in portfolio CSV.</span>';
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
// ===== Fourth tab: multi-level, Revit-style property schedule =====
function fillScheduleSelectors(){
  const options='<option value="">No grouping</option>'+SCHEDULE_FIELDS.map(([key,label])=>
    `<option value="${escapeHTML(key)}">${escapeHTML(label)}</option>`).join('');
  const defaults=['Property_Ownership_Type','Tenant_Mix_Type','Retail_Center_Type'];
  for(let i=1;i<=5;i++){
    const select=$('schedule-group-'+i),value=select.value||defaults[i-1];
    select.innerHTML=options;
    select.value=value;
  }
}
function effectiveScheduleFields(){
  const result=[];
  for(let i=1;i<=5;i++){
    const value=$('schedule-group-'+i).value;
    if(value&&!result.includes(value))result.push(value);
  }
  return result;
}
function scheduleGroupValue(row,key){
  if(key==='Renovation_Status'){
    return {'yes':'With improvement','no':'No improvement','blank':'Not documented'}[renovationCategory(row.Renovation)];
  }
  if(key==='Property_Ownership_Type')return str(row[key])||'Unknown / Unverified';
  return str(row[key])||'Not documented';
}
function scheduleFilter(row){
  const query=$('schedule-search').value.trim().toLocaleLowerCase();
  return !query||searchable(row).includes(query);
}
function scheduleGroupKey(path){return JSON.stringify(path);}
function scheduleGroupSort(a,b,key){
  if(key==='Property_Ownership_Type'){
    const ai=OWNER_TYPES.findIndex(x=>x.key===a);
    const bi=OWNER_TYPES.findIndex(x=>x.key===b);
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
const SCHEDULE_COLS=[
  ['Store_ID','Project'],['City','City'],['State','State'],['Street_Address','Street address'],
  ['Property_Ownership_Type','Ownership type'],['Ownership_Scope','Ownership scope'],
  ['Tenant_Mix_Type','Tenant mix'],['Retail_Center_Type','Retail center'],
  ['OSJL_Type','OSJL position'],['OSJL_Area_SF','OSJL area (SF)'],
  ['Total_GLA_SF','Total GLA (SF)'],['Acquisition_Year','Acquisition year'],
  ['Lease_Start_or_Transfer_Year','Lease year'],['Known_Property_Owner','Known owner'],
  ['Tenants','Tenants'],['Renovation','Renovation'],['Satellite','Satellite map']
];
function schedulePropertyRow(row){
  const addr=shortAddress(row),lat=Number(row.Latitude),lng=Number(row.Longitude);
  const valid=str(row.Latitude)&&str(row.Longitude)&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
  const project=`<strong>${escapeHTML(rowId(row))}</strong><span>${escapeHTML(displayTitle(row))}</span>`;
  const owner=isOwned(row.Property_Ownership_Type)
    ?`<span class="schedule-scope-chip" style="--scope-color:${rowColor(row)}">${escapeHTML(scopeShort(row.Ownership_Scope))}</span>`
    :escapeHTML(str(row.Ownership_Scope)||'—');
  const mapCell=valid?`<div class="card-satellite-map schedule-mini-map" data-lat="${lat}" data-lng="${lng}" data-zoom="16" role="img" aria-label="Satellite map of ${escapeHTML(displayTitle(row))}"></div>
    <a href="${escapeHTML(safeLink(addr,row))}" target="_blank" rel="noopener noreferrer" class="schedule-google-link">Google Maps ↗</a>`:'<span class="missing-value">No coordinates</span>';
  const values=[
    `<div class="schedule-project-cell">${project}</div>`,escapeHTML(str(row.City)||'—'),
    escapeHTML(str(row.State)||'—'),escapeHTML(addr),
    escapeHTML(str(row.Property_Ownership_Type)||'Unknown / Unverified'),owner,
    escapeHTML(str(row.Tenant_Mix_Type)||'—'),escapeHTML(str(row.Retail_Center_Type)||'—'),
    escapeHTML(str(row.OSJL_Type)||'—'),escapeHTML(formatted(row.OSJL_Area_SF,'sf')),
    escapeHTML(formatted(row.Total_GLA_SF,'sf')),escapeHTML(str(row.Acquisition_Year)||'—'),
    escapeHTML(str(row.Lease_Start_or_Transfer_Year)||'—'),
    escapeHTML(str(row.Known_Property_Owner)||'—'),
    `<span class="schedule-long-cell" title="${escapeHTML(str(row.Tenants))}">${escapeHTML(str(row.Tenants)||'—')}</span>`,
    `<span class="schedule-long-cell" title="${escapeHTML(str(row.Renovation))}">${escapeHTML(str(row.Renovation)||'—')}</span>`,mapCell
  ];
  return `<tr class="schedule-data-row">${values.map((v,i)=>`<td class="${i===0?'schedule-sticky-cell':''} ${i===16?'schedule-satellite-cell':''}">${v}</td>`).join('')}</tr>`;
}
function renderSchedule(){
  const filtered=portfolioRows.filter(scheduleFilter);
  const fields=effectiveScheduleFields();
  const scroll=$('schedule-table-scroll'),left=scroll.scrollLeft,top=scroll.scrollTop;
  const count=filtered.length;
  $('schedule-visible-count').textContent=`${labelLocationCount(count)} of ${labelLocationCount(portfolioRows.length)} properties · ${fields.length} grouping levels`;
  $('schedule-total').textContent=labelLocationCount(portfolioRows.length);
  $('tab-schedule-count').textContent=labelLocationCount(portfolioRows.length);
  disposeCardMaps();
  const groupTitle=key=>SCHEDULE_FIELDS.find(([name])=>name===key)?.[1]||key;
  function groupedRows(rows,level){
    if(level>=fields.length){
      return [...rows].sort((a,b)=>str(a.State).localeCompare(str(b.State))||str(a.City).localeCompare(str(b.City))||rowId(a).localeCompare(rowId(b)))
        .map(schedulePropertyRow).join('');
    }
    const key=fields[level],groups=new Map();
    for(const row of rows){
      const value=scheduleGroupValue(row,key);
      if(!groups.has(value))groups.set(value,[]);
      groups.get(value).push(row);
    }
    return [...groups.keys()].sort((a,b)=>scheduleGroupSort(a,b,key)).map(value=>{
      const group=groups.get(value);
      // Always visible, just like a Revit schedule grouping subtotal — no disclosure control.
      const summary=`<tr class="schedule-group-row schedule-level-${level+1}">
        <th scope="rowgroup" class="schedule-group-heading-cell schedule-sticky-cell" style="--schedule-indent:${level*11}px">
          <small>GROUP ${level+1} · ${escapeHTML(groupTitle(key))}</small><strong>${escapeHTML(value)}</strong></th>
        <td class="schedule-group-total-cell"><b>${group.length}</b><span>${group.length===1?'property':'properties'}</span></td>
        <td colspan="${SCHEDULE_COLS.length-2}" class="schedule-group-fill-cell"></td></tr>`;
      return summary+groupedRows(group,level+1);
    }).join('');
  }
  const header=`<thead><tr>${SCHEDULE_COLS.map(([key,label],i)=>`<th class="${i===0?'schedule-sticky-cell':''}">${escapeHTML(label)}</th>`).join('')}</tr></thead>`;
  const rows=count?(fields.length?groupedRows(filtered,0):[...filtered].sort((a,b)=>str(a.State).localeCompare(str(b.State))||str(a.City).localeCompare(str(b.City))).map(schedulePropertyRow).join(''))
    :`<tr><td colspan="${SCHEDULE_COLS.length}" class="schedule-empty-cell">No matching portfolio properties.</td></tr>`;
  $('schedule-results').innerHTML=`<table class="property-schedule">${header}<tbody>${rows}</tbody></table>`;
  scroll.scrollLeft=left;scroll.scrollTop=top;
  observeCardSatellites('page-schedule');
}
function exportScheduleCSV(){
  const rows=portfolioRows.filter(scheduleFilter);
  const fields=effectiveScheduleFields();
  rows.sort((a,b)=>{
    for(const key of fields){
      const compare=scheduleGroupSort(scheduleGroupValue(a,key),scheduleGroupValue(b,key),key);
      if(compare)return compare;
    }
    return str(a.State).localeCompare(str(b.State))||str(a.City).localeCompare(str(b.City));
  });
  const columns=['Store_ID','City','State','Street_Address','Property_Ownership_Type','Ownership_Scope',
    'Tenant_Mix_Type','Retail_Center_Type','OSJL_Type','OSJL_Area_SF','Total_GLA_SF','Acquisition_Year',
    'Lease_Start_or_Transfer_Year','Known_Property_Owner','Tenants','Renovation','Latitude','Longitude'];
  const csvCell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  const content='\uFEFF'+[columns.join(','),...rows.map(row=>columns.map(key=>csvCell(row[key])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='OSJL_Property_Schedule.csv';
  document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function paintHeader(){
  $('map-total').textContent=labelLocationCount(mapRows.length);
  $('tab-map-count').textContent=labelLocationCount(mapRows.length);
  const n=portfolioRows.filter(row=>renovationCategory(row.Renovation)!=='blank'&&normOwner(row.Property_Ownership_Type)!=='Unknown').length;
  $('tab-reno-count').textContent=labelLocationCount(n);
  $('reno-total').textContent=labelLocationCount(n);
  $('tab-tax-count').textContent=labelLocationCount(portfolioRows.length);
  $('tax-total').textContent=labelLocationCount(portfolioRows.length);
  $('tab-tenant-count').textContent=labelLocationCount(portfolioRows.length);
  $('mix-total').textContent=labelLocationCount(portfolioRows.length);
  $('tab-schedule-count').textContent=labelLocationCount(portfolioRows.length);
  $('schedule-total').textContent=labelLocationCount(portfolioRows.length);
}

function fetchText(path) {
  const url=path+(path.includes('?')?'&':'?')+'_='+Date.now();
  return fetch(url,{cache:'no-store'}).then(res=>{
    if(!res.ok)throw new Error(`${path}: HTTP ${res.status}`);return res.text();
  });
}
async function reloadData(force=false){
  if(updating)return;
  updating=true;
  try{
    const [storeText,portfolioText]=await Promise.all([fetchText(CONFIG.storeCSV),fetchText(CONFIG.portfolioCSV)]);
    const storeChanged=force||storeText!==previousStoreText;
    const portfolioChanged=force||portfolioText!==previousPortfolioText;
    if(storeChanged){
      const rows=csvRows(storeText);
      if(!rows.length||!Object.hasOwn(rows[0],'Latitude'))throw Error('OSJL_183_Stores.csv is empty or missing Latitude.');
      storeRows=rows;previousStoreText=storeText;
    }
    if(portfolioChanged){
      const rows=csvRows(portfolioText);
      if(!rows.length||!Object.hasOwn(rows[0],'Property_Ownership_Type'))throw Error('OSJL_Property_Portfolio.csv is empty or missing Property_Ownership_Type.');
      portfolioRows=rows;previousPortfolioText=portfolioText;
      fillLayoutFilter();fillMixFilter();fillTenantLayoutFilter();
    }
    if(storeChanged||portfolioChanged){
      mapRows=combineMapRows();
      makeMarkers();
      if(activeTab==='renovation')renderRenovation();
      if(activeTab==='taxonomy')renderTaxonomy();
      if(activeTab==='tenant')renderTenantMix();
      if(activeTab==='schedule')renderSchedule();
    }
    paintHeader();
    $('updated-label').textContent=(storeChanged||portfolioChanged?'Loaded ':'Checked ')+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    $('error-notice').hidden=true;
  }catch(e){
    console.error(e);
    $('error-notice').innerHTML=`<strong>Unable to read CSV files.</strong> ${escapeHTML(e.message)}<br>Make sure the website is served locally (not opened as file://) and that DATA/ contains both CSV files with their exact names.`;
    $('error-notice').hidden=false;$('updated-label').textContent='CSV read error';
  }finally{updating=false;}
}
function init(){
  fillOwnerFilters();fillScheduleSelectors();
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
  $('mix-search').addEventListener('input',renderTenantMix);
  $('mix-owner-filter').addEventListener('change',renderTenantMix);
  $('mix-type-filter').addEventListener('change',renderTenantMix);
  $('mix-layout-filter').addEventListener('change',renderTenantMix);
  $('mix-tree').addEventListener('click',jumpToTaxonomyBranch);
  $('mix-expand').addEventListener('click',()=>document.querySelectorAll('#mix-results details').forEach(d=>d.open=true));
  $('mix-collapse').addEventListener('click',()=>document.querySelectorAll('#mix-results details').forEach(d=>d.open=false));
  for(let i=1;i<=5;i++)$('schedule-group-'+i).addEventListener('change',renderSchedule);
  $('schedule-search').addEventListener('input',renderSchedule);
  $('schedule-export').addEventListener('click',exportScheduleCSV);
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
