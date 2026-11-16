(function(){
"use strict";
const G=window.GEO, CITIES=window.CITIES, RECIPES=window.RECIPES, FUEL=window.FUEL;
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=(n,d=0)=>Number(n).toLocaleString("en-GB",{minimumFractionDigits:d,maximumFractionDigits:d});
const mi=n=>fmt(n,n<100&&n%1?1:0);

/* ---------- Route geometry ---------- */
const RAD=Math.PI/180, EARTH=3958.7613;
function hav(a,b){const dl=(b[1]-a[1])*RAD,dn=(b[0]-a[0])*RAD;const h=Math.sin(dl/2)**2+Math.cos(a[1]*RAD)*Math.cos(b[1]*RAD)*Math.sin(dn/2)**2;return 2*EARTH*Math.asin(Math.sqrt(h));}
const STANDALONE=!(window.claude&&window.claude.use);
const PENANG={id:"penang",from:"Coventry",to:"Penang",legs:G.legs,stops:G.stops,runs:G.runs,entries:G.entries};
let RT,PTS,stopMi,TOTAL,STOPS,MILESTONES,ferryInto;
function setRoute(rt){
  RT=rt;PTS=[];stopMi={};ferryInto={};let cum=0;
  stopMi[rt.legs[0].a]=0;
  rt.legs.forEach((l,li)=>{
    if(l.k==="road"){l.c.forEach((p,i)=>{if(i)cum+=hav(l.c[i-1],p);PTS.push([p[0],p[1],cum,li]);});}
    else ferryInto[l.b]=l;
    stopMi[l.b]=cum;
  });
  TOTAL=cum;
  STOPS=rt.stops.map(s=>({...s,mi:s.mi!=null?Math.min(s.mi,TOTAL):stopMi[s.n]})).sort((a,b)=>a.mi-b.mi);
  MILESTONES=STOPS.filter(s=>!s.via);
}
setRoute(PENANG);
const PEN={stopMi:Object.assign({},stopMi),total:TOTAL};
const RBY={};RECIPES.forEach(r=>RBY[r.city]=r);
const isPen=()=>RT.id==="penang";
const info=n=>isPen()?CITIES[n]:null;
const ctry=s=>s.c||(CITIES[s.n]&&isPen()?CITIES[s.n].c:"")||"";
const hasDish=s=>!/(^Ferry terminal|^Landing| coast$| ferry port$)/.test(s.n);
const jdish=(id,n)=>{const r=ROUTES[id];return (r&&r.recipes&&r.recipes[n]&&r.recipes[n].dish)||(r&&r.dishes&&r.dishes[n])||"A local dish";};
const rec=n=>{if(isPen())return RBY[n];const s=MILESTONES.find(x=>x.n===n);return s&&hasDish(s)?{dish:jdish(RT.id,n)}:null;};
const recId=n=>isPen()?"r:"+n:"c:"+RT.id+"|"+n;
const crossing=l=>l.k==="sea"?"sea crossing":"ferry";

function posAt(m){
  m=Math.max(0,Math.min(TOTAL,m));
  let lo=0,hi=PTS.length-1;
  while(lo<hi){const mid=(lo+hi+1)>>1;if(PTS[mid][2]<=m)lo=mid;else hi=mid-1;}
  const a=PTS[lo],b=PTS[Math.min(lo+1,PTS.length-1)];
  const span=b[2]-a[2],t=span>0?(m-a[2])/span:0;
  return {lat:a[1]+(b[1]-a[1])*t,lon:a[0]+(b[0]-a[0])*t,idx:lo};
}
function countryAt(m){let c=RT.runs.length?RT.runs[0][1]:"";for(const r of RT.runs){if(r[0]<=m)c=r[1];else break;}return c;}
function around(m){
  let prev=MILESTONES[0],next=null;
  for(const s of MILESTONES){if(s.mi<=m)prev=s;else{next=s;break;}}
  return {prev,next};
}

/* ---------- Dates ---------- */
const iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10);
const parse=s=>new Date(s+"T12:00:00");
const today=()=>iso(new Date());
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return iso(d);};
const monday=s=>{const d=parse(s);d.setDate(d.getDate()-((d.getDay()+6)%7));return iso(d);};
const days=(a,b)=>Math.round((parse(b)-parse(a))/864e5);
const nice=s=>parse(s).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const niceShort=s=>parse(s).toLocaleDateString("en-GB",{day:"numeric",month:"short"});

/* ---------- State and storage ---------- */
const LS="longwayhome.v1";
const blank=()=>({rides:[],settings:{goal:"2y",goalDate:"",speed:16.3,days:4,start:today()},unlocked:{},awards:{},favs:[],journeys:[],jstate:{},active:"penang"});
let S=blank(),ROUTES={};
let undoSnap=null, store={mode:"loading",col:null,dirty:false}, writeChain=Promise.resolve();
function normalise(o){
  const d=blank();
  if(!o||typeof o!=="object")return d;
  if(Array.isArray(o.rides))d.rides=o.rides.filter(r=>r&&isFinite(+r.miles)&&+r.miles>0&&/^\d{4}-\d\d-\d\d$/.test(r.date||""))
    .map(r=>({id:String(r.id||Math.random().toString(36).slice(2)),date:r.date,miles:+r.miles,mins:r.mins?+r.mins:null,title:String(r.title||""),notes:String(r.notes||""),j:String(r.j||"penang")}));
  Object.assign(d.settings,o.settings||{});
  d.unlocked=Object.assign({},o.unlocked);d.awards=Object.assign({},o.awards);
  d.favs=Array.isArray(o.favs)?o.favs.slice():[];
  if(Array.isArray(o.journeys))d.journeys=o.journeys.filter(j=>j&&j.id&&j.from&&j.to).map(j=>JSON.parse(JSON.stringify(j)));
  d.jstate=o.jstate&&typeof o.jstate==="object"?JSON.parse(JSON.stringify(o.jstate)):{};
  d.active=o.active&&(o.active==="penang"||d.journeys.some(j=>j.id===o.active))?o.active:"penang";
  return d;
}
function loadLocal(){
  try{const r=JSON.parse(localStorage.getItem(LS+".routes")||"null");if(r)ROUTES=r;}catch(e){}
  try{const j=JSON.parse(localStorage.getItem(LS)||"null");if(j){S=normalise(j.state);store.dirty=!!j.dirty;return true;}}catch(e){}return false;
}
function saveLocal(){
  try{localStorage.setItem(LS,JSON.stringify({state:S,dirty:store.dirty}));}catch(e){}
  try{localStorage.setItem(LS+".routes",JSON.stringify(ROUTES));}catch(e){}
}
function setStatus(){
  const el=$("#status");if(!el)return;
  const m=store.mode;
  el.className="status "+(m==="cloud"?"ok":m==="error"?"bad":"");
  el.lastElementChild.textContent=m==="cloud"?"Saved":m==="saving"?"Saving":m==="loading"?"Loading":m==="error"?"Not saved online":STANDALONE?"Saved on this device":"This device only";
  const p=$("#p-store");if(p)p.textContent=storeText();
}
function storeText(){
  return store.mode==="cloud"||store.mode==="saving"?"Your rides are saved privately to your Claude account and follow you across devices."
    :store.mode==="error"?"The last change could not be saved online. It is kept on this device and will be sent again when you next save."
    :store.mode==="loading"?"Connecting to your saved data."
    :STANDALONE?"Your rides are saved on this device. Use Export now and then to keep a backup, or to move them to another device with Restore.":"Online saving is not available in this view, so rides are kept in this browser only. Use Export to keep a backup.";
}
function persist(){
  store.dirty=true;saveLocal();
  if(!store.col){setStatus();return;}
  store.mode="saving";setStatus();
  const rides=JSON.parse(JSON.stringify({rides:S.rides}));
  const journey=JSON.parse(JSON.stringify({settings:S.settings,unlocked:S.unlocked,awards:S.awards,favs:S.favs,journeys:S.journeys,jstate:S.jstate,active:S.active,updated:new Date().toISOString()}));
  writeChain=writeChain.then(async()=>{
    try{await store.col.doc("rides").set(rides);await store.col.doc("journey").set(journey);store.dirty=false;store.mode="cloud";}
    catch(e){store.mode="error";console.error(e);}
    saveLocal();setStatus();
  });
}
function persistRoute(id,remove){
  saveLocal();if(!store.col)return;
  const data=remove?null:JSON.parse(JSON.stringify(ROUTES[id]));
  writeChain=writeChain.then(async()=>{try{const d=store.col.doc("route-"+id);if(remove)await d.delete();else await d.set(data);}catch(e){console.error(e);}});
}
async function initStore(){
  const had=loadLocal();
  await activate(S.active,true);
  checkMilestones(true);renderAll();
  try{
    if(!(window.claude&&window.claude.use))throw new Error("no runtime");
    const [db,user]=await Promise.all([window.claude.use("db"),window.claude.use("user")]);
    const id=user?await user.id():null;
    if(!db||!id){store.mode="local";setStatus();return;}
    const col=db.collection("data/users/"+id);
    const [r,j]=await Promise.all([col.doc("rides").get(),col.doc("journey").get()]);
    store.col=col;
    if((r.exists||j.exists)&&!store.dirty){
      S=normalise(Object.assign({},j.exists?JSON.parse(JSON.stringify(j.data())):{},{rides:r.exists?JSON.parse(JSON.stringify(r.data())).rides:[]}));
      const need=S.journeys.filter(x=>!ROUTES[x.id]);
      const docs=await Promise.all(need.map(x=>col.doc("route-"+x.id).get().catch(()=>null)));
      docs.forEach((d,i)=>{if(d&&d.exists)ROUTES[need[i].id]=JSON.parse(JSON.stringify(d.data()));});
      store.mode="cloud";saveLocal();
      await activate(S.active,true);checkMilestones(true);renderAll();
    }else if(had&&(S.rides.length||S.journeys.length||store.dirty)){persist();S.journeys.forEach(x=>{if(ROUTES[x.id])persistRoute(x.id);});}
    else{store.mode="cloud";}
    setStatus();
  }catch(e){store.mode="local";setStatus();}
}
/* per-journey progress records */
function U(){if(isPen())return S.unlocked;const s=S.jstate[RT.id]||(S.jstate[RT.id]={unlocked:{},awards:{}});return s.unlocked;}
function AW(){if(isPen())return S.awards;const s=S.jstate[RT.id]||(S.jstate[RT.id]={unlocked:{},awards:{}});return s.awards;}
const jmeta=id=>S.journeys.find(j=>j.id===id);
const ridesOf=id=>S.rides.filter(r=>(r.j||"penang")===id);
const sum=a=>a.reduce((s,r)=>s+r.miles,0);

/* ---------- Derived figures ---------- */
function stats(){
  const rides=ridesOf(RT.id).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
  const total=sum(rides);
  const t=today(),wk=monday(t);
  const weeks={};rides.forEach(r=>{const k=monday(r.date);weeks[k]=(weeks[k]||0)+r.miles;});
  const thisWeek=weeks[wk]||0;
  let streak=0,k=weeks[wk]?wk:addDays(wk,-7);
  while(weeks[k]){streak++;k=addDays(k,-7);}
  const first=rides.length?rides[0].date:null;
  let rate=0;
  if(first){const span=Math.max(7,Math.min(28,days(first,t)+1));const from=addDays(t,-span+1);
    rate=sum(rides.filter(r=>r.date>=from&&r.date<=t))/(span/7);}
  const remaining=Math.max(0,TOTAL-total);
  const eta=remaining===0?null:rate>0?addDays(t,Math.ceil(remaining/rate*7)):null;
  const st=S.settings,jm=jmeta(RT.id),start=(jm&&jm.created)||st.start||first||t;
  const goalDate=st.goal==="custom"&&st.goalDate?st.goalDate:addDays(start,Math.round(365.25*({"1y":1,"2y":2,"3y":3}[st.goal]||2)));
  const weeksLeft=Math.max(1,days(t,goalDate)/7);
  const need=remaining/weeksLeft;
  const planned=TOTAL*Math.max(0,Math.min(1,days(start,t)/Math.max(1,days(start,goalDate))));
  const pos=posAt(total),ar=around(Math.min(total,TOTAL));
  return {rides,total,remaining,pct:TOTAL>0?Math.min(100,total/TOTAL*100):0,thisWeek,streak,weeks,rate,eta,goalDate,need,planned,pos,prev:ar.prev,next:ar.next,country:countryAt(Math.min(total,TOTAL)),first};
}
const entryMi=n=>{const e=RT.entries.find(x=>x.n===n);return e?e.mi:Infinity;};
function awardDefs(st){
  const wk=Object.keys(st.weeks).sort();
  let run=0,best4=false,prevK=null;wk.forEach(k=>{run=prevK&&addDays(prevK,7)===k?run+1:1;if(run>=4)best4=true;prevK=k;});
  let pb=false,max=0;wk.forEach((k,i)=>{if(i>0&&st.weeks[k]>max)pb=true;max=Math.max(max,st.weeks[k]);});
  const T=st.total,any=st.rides.length>0;
  const common=[
    {id:"m100",name:"First 100 miles",mark:"100",ok:T>=100},
    {id:"m500",name:"500 miles",mark:"500",ok:T>=500},
    {id:"m1000",name:"1,000 miles",mark:"1k",ok:T>=1000},
    {id:"m5000",name:"5,000 miles",mark:"5k",ok:T>=5000},
    {id:"r100",name:"100 rides",mark:"×100",ok:st.rides.length>=100},
    {id:"steady",name:"Four weeks running",mark:"4 wk",ok:best4},
    {id:"pb",name:"Best week yet",mark:"PB",ok:pb}];
  if(!isPen()){
    const first=MILESTONES[0],last=MILESTONES[MILESTONES.length-1];
    return [
      {id:"first",name:"First Pedal Stroke",desc:"Complete the first ride.",at:first.n,ok:any},
      {id:"arrive",name:"Welcome to "+last.n,desc:"Complete the entire journey.",at:last.n,ok:any&&T>=TOTAL},
      {id:"q25",name:"A quarter of the way",mark:"25%",ok:any&&T>=TOTAL*.25},
      {id:"q50",name:"Halfway",mark:"50%",ok:any&&T>=TOTAL*.5},
      {id:"q75",name:"Three quarters",mark:"75%",ok:any&&T>=TOTAL*.75}].concat(common);
  }
  return [
    {id:"first",name:"First Pedal Stroke",desc:"Complete the first ride.",at:"Coventry",ok:any},
    {id:"channel",name:"The Channel Crossing",desc:"Reach mainland Europe.",at:"Calais",ok:T>=stopMi.Calais&&any},
    {id:"continental",name:"Continental Explorer",desc:"Reach Istanbul.",at:"Istanbul",ok:T>=stopMi.Istanbul},
    {id:"asia",name:"Into Asia",desc:"Cross Anatolia to Ankara.",at:"Ankara",ok:T>=stopMi.Ankara},
    {id:"persia",name:"Persian Adventure",desc:"Reach Tehran.",at:"Tehran",ok:T>=stopMi.Tehran},
    {id:"subcontinent",name:"Across the Subcontinent",desc:"Reach Delhi.",at:"Delhi",ok:T>=stopMi.Delhi},
    {id:"seasia",name:"Into Southeast Asia",desc:"Reach Thailand.",at:"Mae Sot",ok:T>=stopMi["Mae Sot"]},
    {id:"final",name:"The Final Stretch",desc:"Reach Malaysia.",at:"Hat Yai",ok:T>=entryMi("Malaysia")},
    {id:"penang",name:"Welcome to Penang",desc:"Complete the entire expedition.",at:"George Town",ok:T>=TOTAL}].concat(common);
}
function checkMilestones(silent){
  const st=stats(),t=today(),newStops=[],newAwards=[],u=U(),aw=AW();
  MILESTONES.forEach(s=>{if(st.total>=s.mi&&!u[s.n]){u[s.n]=t;if(s.mi>0)newStops.push(s);}});
  awardDefs(st).forEach(a=>{if(a.ok&&!aw[a.id]){aw[a.id]=t;newAwards.push(a);}});
  if(!silent&&(newStops.length||newAwards.length))celebrate(newStops,newAwards);
  return newStops.length+newAwards.length;
}

/* ---------- Map ---------- */
let map,layers={},mapMode="stage",routeLayers=[];
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const ll=p=>[p[1],p[0]];
function label(lat,lon,text,cls){return window.L.marker([lat,lon],{interactive:false,keyboard:false,icon:window.L.divIcon({className:"",iconSize:[0,0],html:'<div class="lbl '+cls+'">'+esc(text)+"</div>"})});}
function initMap(){
  if(!window.L){$("#map").innerHTML='<p class="note" style="padding:20px">The map library did not load. Check your connection and reopen the page.</p>';return;}
  const L=window.L;
  map=L.map("map",{zoomControl:false,attributionControl:false,minZoom:1.5,maxZoom:11,zoomSnap:.25,preferCanvas:true,
    maxBounds:[[-70,-200],[84,200]],maxBoundsViscosity:.8,worldCopyJump:false});
  map.createPane("landbase").style.zIndex=300;map.createPane("relief").style.zIndex=350;
  map.getPane("relief").style.pointerEvents=map.getPane("landbase").style.pointerEvents="none";
  layers.cv=L.canvas({padding:.4});
  const rings=G.countries.flatMap(c=>c.p.map(r=>r.map(ll)));
  layers.land=L.polygon(rings,{renderer:L.canvas({padding:.4,pane:"landbase"}),interactive:false,stroke:false,fillOpacity:1}).addTo(map);
  layers.borders=L.polygon(rings,{renderer:layers.cv,interactive:false,weight:.9,fill:false}).addTo(map);
  loadElev().then(()=>paintRelief()).catch(()=>{});
  layers.lakes=L.polygon(G.lakes.map(r=>r.map(ll)),{renderer:layers.cv,interactive:false,stroke:false,fillOpacity:1}).addTo(map);
  layers.roads=L.polyline(G.roads.map(r=>r.map(ll)),{renderer:layers.cv,interactive:false,weight:1}).addTo(map);
  G.countries.forEach(c=>{if(c.l[0]||c.l[1])label(c.l[1],c.l[0],c.n,"country").addTo(map);});
  const zc=()=>{const z=map.getZoom(),c=map.getContainer().classList;c.toggle("z-mid",z>=4.5&&z<6.5);c.toggle("z-hi",z>=6.5);roadVis();};
  map.on("zoomend",zc);
  drawRoute();zc();
  $("#m-stage").onclick=()=>{mapMode="stage";frame(true);};
  $("#m-all").onclick=()=>{mapMode="all";frame(true);};
  const mq=window.matchMedia("(prefers-color-scheme: dark)");
  if(mq.addEventListener)mq.addEventListener("change",paintMap);
  new MutationObserver(paintMap).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme","data-app-theme"]});
}
function drawRoute(){
  if(!map)return;
  const L=window.L,cv=layers.cv;
  routeLayers.forEach(l=>map.removeLayer(l));routeLayers=[];
  const add=l=>{l.addTo(map);routeLayers.push(l);return l;};
  layers.todo=add(L.polyline(RT.legs.filter(l=>l.k==="road").map(l=>l.c.map(ll)),{renderer:cv,interactive:false,weight:3,lineCap:"round",lineJoin:"round"}));
  layers.ferry=add(L.polyline(RT.legs.filter(l=>l.k!=="road").map(l=>l.c.map(ll)),{renderer:cv,interactive:false,weight:2,dashArray:"4 6"}));
  layers.done=add(L.polyline([],{renderer:cv,interactive:false,weight:4.5,lineCap:"round",lineJoin:"round"}));
  layers.dots=MILESTONES.map(s=>add(L.circleMarker([s.lat,s.lon],{renderer:cv,radius:4,weight:2,fillOpacity:1,interactive:false})));
  const major=isPen()?new Set(["Coventry","Istanbul","Tehran","Delhi","Bangkok","George Town"]):new Set([MILESTONES[0].n,MILESTONES[MILESTONES.length-1].n]);
  if(isPen())G.places.forEach(p=>add(label(p[2],p[1],p[0],"place")));
  STOPS.forEach(s=>add(label(s.lat,s.lon,s.n,major.has(s.n)?"":"minor")));
  layers.me=add(L.marker([STOPS[0].lat,STOPS[0].lon],{interactive:false,keyboard:false,zIndexOffset:1000,icon:L.divIcon({className:"",iconSize:[18,18],iconAnchor:[9,9],html:'<div class="me"></div>'})}));
  roadVis();
  paintMap();updateMap(true);
}
function roadVis(){if(map&&layers.roads)layers.roads.setStyle({opacity:isPen()&&map.getZoom()>=5?.85:0});}
function paintMap(){
  if(!map)return;
  layers.land.setStyle({fillColor:css("--land")});
  layers.borders.setStyle({color:css("--border"),opacity:.8});
  paintRelief();
  layers.lakes.setStyle({fillColor:css("--sea")});
  layers.roads.setStyle({color:css("--road")});
  layers.todo.setStyle({color:css("--todo")});
  layers.ferry.setStyle({color:css("--todo")});
  layers.done.setStyle({color:css("--route")});
  paintDots();
}
/* colour-by-height land, drawn in the map's own projection */
const isDark=()=>{const a=document.documentElement.getAttribute("data-app-theme");if(a)return a==="dark";const t=document.documentElement.getAttribute("data-theme");return t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;};
const RAMP=[[0,[134,190,110]],[150,[170,208,124]],[400,[214,224,140]],[800,[230,208,140]],[1300,[214,174,112]],[2000,[188,140,96]],[3000,[160,120,100]],[4000,[200,190,182]],[5200,[248,248,248]]];
function ramp(e){if(e<=RAMP[0][0])return RAMP[0][1];for(let i=1;i<RAMP.length;i++){const a=RAMP[i-1],b=RAMP[i];if(e<=b[0]){const t=(e-a[0])/(b[0]-a[0]);return [0,1,2].map(k=>a[1][k]+(b[1][k]-a[1][k])*t);}}return RAMP[RAMP.length-1][1];}
let reliefKey=null;
function paintRelief(){
  if(!map||!ELEVG)return;
  const dark=isDark();if(reliefKey===dark)return;reliefKey=dark;
  const E=ELEVG,N=80,S=-62,my=l=>Math.log(Math.tan(Math.PI/4+l*RAD/2)),W=2048,top=my(N),bot=my(S),H=Math.round(W*(top-bot)/(2*Math.PI));
  const cv=document.createElement("canvas");cv.width=W;cv.height=H;const cx=cv.getContext("2d"),img=cx.createImageData(W,H),d=img.data;
  const at=(x,y)=>E.g[Math.max(0,Math.min(E.h-1,y))*E.w+Math.max(0,Math.min(E.w-1,x))]*E.step+E.base;
  const base=-E.base/E.step;
  for(let py=0;py<H;py++){
    const m=top-(py+.5)/H*(top-bot),lat=(2*Math.atan(Math.exp(m))-Math.PI/2)/RAD,gy=Math.round((90-lat)*6);
    for(let px=0;px<W;px++){
      const gx=Math.round(px/W*(E.w-1)),code=E.g[Math.max(0,Math.min(E.h-1,gy))*E.w+gx],o=(py*W+px)*4;
      if(code===Math.round(base)){d[o+3]=0;continue;}
      const e=code*E.step+E.base,dx=at(gx+1,gy)-at(gx-1,gy),dy=at(gx,gy+1)-at(gx,gy-1);
      let sh=1+(dy-dx)/1400;sh=Math.max(.72,Math.min(1.18,sh));
      const c=ramp(e),k=dark?.5*sh:sh;
      d[o]=Math.min(255,c[0]*k);d[o+1]=Math.min(255,c[1]*k);d[o+2]=Math.min(255,c[2]*k);d[o+3]=dark?235:255;
    }
  }
  cx.putImageData(img,0,0);
  const url=cv.toDataURL("image/png");
  if(layers.relief)layers.relief.setUrl(url);
  else layers.relief=window.L.imageOverlay(url,[[S,-180],[N,180]],{pane:"relief",interactive:false,className:"relief"}).addTo(map);
}
function paintDots(){
  const T=stats().total;
  layers.dots.forEach((d,i)=>{const done=T>=MILESTONES[i].mi;d.setStyle({color:done?css("--route"):css("--todo"),fillColor:done?css("--route"):"#FFFFFF"});});
}
function updateMap(first){
  if(!map||!layers.done)return;
  const st=stats(),m=Math.min(st.total,TOTAL),done=[];let cur=null,curLeg=-1;
  for(const p of PTS){if(p[2]>m)break;if(p[3]!==curLeg){cur=[];done.push(cur);curLeg=p[3];}cur.push([p[1],p[0]]);}
  if(cur&&m<TOTAL&&PTS[Math.min(st.pos.idx+1,PTS.length-1)][3]===curLeg)cur.push([st.pos.lat,st.pos.lon]);
  layers.done.setLatLngs(done);
  const end=m>=TOTAL?STOPS[STOPS.length-1]:null;
  layers.me.setLatLng(end?[end.lat,end.lon]:[st.pos.lat,st.pos.lon]);
  paintDots();frame(!first);
}
function frame(animate){
  if(!map)return;
  $("#m-stage").classList.toggle("on",mapMode==="stage");$("#m-all").classList.toggle("on",mapMode==="all");
  const st=stats();let b;
  if(mapMode==="all"){b=window.L.latLngBounds(STOPS.map(s=>[s.lat,s.lon]));PTS.forEach((p,i)=>{if(i%8===0)b.extend([p[1],p[0]]);});}
  else{const a=st.prev,n=st.next||st.prev;b=window.L.latLngBounds([[a.lat,a.lon],[n.lat,n.lon],[st.pos.lat,st.pos.lon]]);
    PTS.forEach(p=>{if(p[2]>=a.mi&&p[2]<=n.mi)b.extend([p[1],p[0]]);});}
  map.invalidateSize();
  map.fitBounds(b,{padding:[34,34],maxZoom:8.5,animate:!!animate,duration:.9});
}

/* ---------- Links out ---------- */
const c6=n=>n.toFixed(6);
const links=(lat,lon)=>({
  sv:"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint="+c6(lat)+","+c6(lon),
  maps:"https://www.google.com/maps/search/?api=1&query="+c6(lat)+","+c6(lon),
  earth:"https://earth.google.com/web/@"+c6(lat)+","+c6(lon)+",0a,4000d,35y,0h,50t,0r",
  sat:"https://www.google.com/maps/@?api=1&map_action=map&center="+c6(lat)+","+c6(lon)+"&zoom=14&basemap=satellite"
});
const SPARSE={Iran:1,Pakistan:1,Myanmar:1};
const coord=(lat,lon)=>Math.abs(lat).toFixed(4)+"° "+(lat>=0?"N":"S")+", "+Math.abs(lon).toFixed(4)+"° "+(lon>=0?"E":"W");

/* ---------- Terrain and Peloton resistance ---------- */
let ELEVG=null,elevLoading=null;
function loadElev(){
  if(ELEVG)return Promise.resolve(ELEVG);
  if(elevLoading)return elevLoading;
  elevLoading=new Promise((res,rej)=>{
    if(window.ELEV)return res();
    const s=document.createElement("script");s.src="elev.js";s.onload=()=>res();s.onerror=()=>rej(new Error("load"));document.body.appendChild(s);
  }).then(async()=>{
    const E=window.ELEV,bin=atob(E.z),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
    let g=null;
    try{if(window.DecompressionStream)g=new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());}catch(e){g=null;}
    if(!g||g.length!==E.w*E.h){
      if(!window.pako)await new Promise((ok,no)=>{const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js";s.onload=ok;s.onerror=no;document.body.appendChild(s);});
      g=window.pako.inflate(u);
    }
    for(let r=0;r<E.h;r++){const o=r*E.w;for(let c=1;c<E.w;c++)g[o+c]=(g[o+c]+g[o+c-1])&255;}
    ELEVG={g,w:E.w,h:E.h,step:E.step,base:E.base};return ELEVG;
  });
  elevLoading.catch(()=>{elevLoading=null;});
  return elevLoading;
}
function elevAt(lon,lat){
  const E=ELEVG,fx=(lon+180)*6,fy=(90-lat)*6,x0=Math.max(0,Math.min(E.w-2,Math.floor(fx))),y0=Math.max(0,Math.min(E.h-2,Math.floor(fy))),tx=fx-x0,ty=fy-y0;
  const v=(x,y)=>E.g[y*E.w+x]*E.step+E.base;
  return v(x0,y0)*(1-tx)*(1-ty)+v(x0+1,y0)*tx*(1-ty)+v(x0,y0+1)*(1-tx)*ty+v(x0+1,y0+1)*tx*ty;
}
/* elevation every half mile along the ridden road, smoothed over about two miles */
const PSTEP=.5;
function profileOf(pts,total){
  const n=Math.max(2,Math.floor(total/PSTEP)+1),raw=new Float32Array(n);let k=0;
  for(let i=0;i<n;i++){const m=Math.min(total,i*PSTEP);
    while(k<pts.length-2&&pts[k+1][2]<=m)k++;
    const a=pts[k],b=pts[Math.min(k+1,pts.length-1)],sp=b[2]-a[2],t=sp>0?(m-a[2])/sp:0;
    raw[i]=elevAt(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);}
  const e=new Float32Array(n),W=2;let up=0,hi=-1e9,lo=1e9;
  for(let i=0;i<n;i++){let s=0,c=0;for(let j=Math.max(0,i-W);j<=Math.min(n-1,i+W);j++){s+=raw[j];c++;}e[i]=s/c;if(e[i]>hi)hi=e[i];if(e[i]<lo)lo=e[i];if(i&&e[i]>e[i-1])up+=e[i]-e[i-1];}
  return {e,up,hi,lo,total};
}
const PROF={};
function profile(){return PROF[RT.id]||null;}
async function ensureProfile(){
  if(PROF[RT.id])return PROF[RT.id];
  const id=RT.id;await loadElev();
  if(RT.id!==id)return null;
  PROF[id]=profileOf(PTS,TOTAL);return PROF[id];
}
const eAt=(p,m)=>{const i=Math.max(0,Math.min(p.e.length-1,m/PSTEP)),a=Math.floor(i),b=Math.min(p.e.length-1,a+1);return p.e[a]+(p.e[b]-p.e[a])*(i-a);};
/* rule-of-thumb mapping from road gradient to Peloton resistance and cadence */
function effort(g){
  if(g<=-2)return {res:"20–25",cad:"90–100",word:"Downhill"};
  if(g<1)return {res:"30–35",cad:"85–95",word:g<-.5?"Gently down":"Flat"};
  if(g<3)return {res:"35–45",cad:"80–90",word:"Gentle climb"};
  if(g<5)return {res:"45–55",cad:"70–80",word:"Climbing"};
  if(g<7)return {res:"55–65",cad:"60–75",word:"Steep climb"};
  return {res:"65–75",cad:"55–65",word:"Very steep"};
}
const ft=m=>Math.round(m*3.28084);
function aheadHTML(st){
  const p=profile();
  if(!p)return '<div class="sect"><h3>The road ahead</h3><p class="note" id="ahead-msg">'+"Loading the terrain."+'</p></div>';
  const m0=Math.min(st.total,TOTAL),span=Math.min(50,TOTAL-m0);
  if(span<.5)return "";
  const here=eAt(p,m0);
  let h='<div class="sect"><h3>The road ahead</h3><p class="sub" style="margin:0 0 10px">You are about '+fmt(Math.max(0,here))+' m ('+fmt(Math.max(0,ft(here)))+' ft) above sea level.</p>';
  /* profile chart */
  const W=340,H=96,N=Math.max(2,Math.round(span/PSTEP)),ys=[];let lo=1e9,hi=-1e9;
  for(let i=0;i<=N;i++){const v=eAt(p,m0+span*i/N);ys.push(v);if(v<lo)lo=v;if(v>hi)hi=v;}
  const pad=Math.max(40,(hi-lo)*.15),y0=Math.max(0,lo-pad),y1=hi+pad,X=i=>i/N*W,Y=v=>H-6-(v-y0)/(y1-y0)*(H-14);
  const line=ys.map((v,i)=>(i?"L":"M")+X(i).toFixed(1)+" "+Y(v).toFixed(1)).join(" ");
  h+='<svg class="prof" viewBox="0 0 '+W+' '+(H+18)+'" role="img" aria-label="Elevation over the next '+mi(span)+' miles, from '+fmt(lo)+' to '+fmt(hi)+' metres">'+
     '<line x1="0" x2="'+W+'" y1="'+Y(hi)+'" y2="'+Y(hi)+'" class="grid"/><line x1="0" x2="'+W+'" y1="'+Y(lo)+'" y2="'+Y(lo)+'" class="grid"/>'+
     '<path d="'+line+' L'+W+' '+H+' L0 '+H+' Z" class="area"/><path d="'+line+'" class="ln"/>'+
     '<circle cx="'+X(0)+'" cy="'+Y(ys[0])+'" r="4.5" class="dot"/>'+
     '<text x="'+(W-2)+'" y="'+(Y(hi)-4)+'" text-anchor="end">'+fmt(hi)+' m</text><text x="'+(W-2)+'" y="'+(Y(lo)+12)+'" text-anchor="end">'+fmt(lo)+' m</text>'+
     '<text x="0" y="'+(H+15)+'">Now</text><text x="'+W+'" y="'+(H+15)+'" text-anchor="end">+'+mi(span)+' mi</text></svg>';
  /* resistance guide in five-mile blocks */
  h+='<p class="eyebrow" style="margin-top:16px">Ride it on your Peloton</p><div class="list" style="margin-top:6px">';
  const blk=5;
  for(let a=0;a<Math.min(25,span);a+=blk){
    const b=Math.min(span,a+blk),ea=eAt(p,m0+a),eb=eAt(p,m0+b),g=(eb-ea)/((b-a)*1609.34)*100;
    let mx=0;for(let m=a;m<b;m+=PSTEP){const s=(eAt(p,m0+Math.min(b,m+PSTEP))-eAt(p,m0+m))/(PSTEP*1609.34)*100;if(Math.abs(s)>Math.abs(mx))mx=s;}
    const f=effort(g);
    h+='<div class="item blk"><span class="t"><b>Miles '+mi(a)+'–'+mi(b)+' · '+f.word+'</b><span>'+(Math.abs(g)<.05?"0.0":(g>0?"+":"")+g.toFixed(1))+'% average, '+(eb>=ea?"up ":"down ")+fmt(Math.abs(eb-ea))+' m'+(Math.abs(mx-g)>1?", steepest stretch about "+mx.toFixed(1)+"%":"")+'</span></span><span class="r"><b class="res">'+f.res+'</b><span>resistance</span><span>'+f.cad+' rpm</span></span></div>';
  }
  h+='</div><p class="note">A guide, not a match: Peloton publishes no gradient-to-resistance scale, and the terrain data has points about 11 miles apart, so short steep climbs are smoothed out.</p></div>';
  return h;
}

/* ---------- Views ---------- */
const lastStop=()=>MILESTONES[MILESTONES.length-1];
function whereText(st){
  if(st.total>=TOTAL&&TOTAL>0)return isPen()?"George Town, Penang":lastStop().n;
  const past=st.total-st.prev.mi;
  if(past<1)return st.prev.n;
  return mi(past)+" miles past "+st.prev.n;
}
function renderJourney(){
  const st=stats(),done=st.total>=TOTAL;
  $("#j-title").textContent=RT.from+" → "+RT.to;
  $("#j-hero").innerHTML=
    '<div class="hero"><div class="big num">'+fmt(st.total,st.total%1?1:0)+'<span class="unit">miles cycled</span></div><div class="pct num">'+fmt(st.pct,st.pct<10?1:0)+'%</div></div>'+
    '<div class="bar" role="progressbar" aria-valuenow="'+Math.round(st.pct)+'" aria-valuemin="0" aria-valuemax="100"><i style="width:'+st.pct+'%"></i></div>';
  const lastRide=st.rides.length?st.rides[st.rides.length-1]:null;
  let h='<div class="now"><p class="eyebrow">'+(done?"Journey complete":esc(st.country))+'</p><h3>'+esc(whereText(st))+'</h3>';
  if(!st.rides.length)h+='<p class="sub">Log your first Peloton ride to set off from '+esc(MILESTONES[0].n)+'.</p>';
  else if(lastRide.date===today())h+='<p class="sub">Your journey continues. '+mi(sum(st.rides.filter(r=>r.date===today())))+' miles ridden today.</p>';
  h+='</div><div class="rows">';
  if(st.next){
    const f=ferryInto[st.next.n];
    h+='<div class="row"><span class="k">Next destination</span><span class="v">'+esc(st.next.n)+'<small>'+esc(ctry(st.next))+'</small></span></div>'+
       '<div class="row"><span class="k">Distance to go</span><span class="v">'+mi(st.next.mi-st.total)+' mi'+(f?'<small>then the '+crossing(f)+' from '+esc(f.a)+'</small>':'')+'</span></div>';
  }
  h+='<div class="row"><span class="k">Miles remaining</span><span class="v">'+fmt(st.remaining)+' mi<small>of '+fmt(TOTAL)+'</small></span></div>'+
     '<div class="row"><span class="k">Estimated arrival</span><span class="v">'+(done?"Arrived":st.eta?nice(st.eta):"After your first rides")+(st.eta?'<small>at '+mi(st.rate)+' mi a week lately</small>':'')+'</span></div></div>'+
     '<div class="trio"><div><b>'+mi(st.thisWeek)+'</b><span>miles this week</span></div><div><b>'+st.streak+'</b><span>week streak</span></div><div><b>'+st.rides.length+'</b><span>rides</span></div></div>';
  if(!done&&st.rides.length)h+='<p class="note">To arrive by '+nice(st.goalDate)+' you need about '+mi(st.need)+' miles a week from here. Change the target in Profile.</p>';
  if(!done)h+=aheadHTML(st);
  $("#j-body").innerHTML=h;
  if(!profile()&&!done)ensureProfile().then(p=>{if(p)renderJourney();}).catch(()=>{const m=$("#ahead-msg");if(m)m.textContent="The terrain could not be loaded. Check your connection and reopen the page.";});
}
function renderExplore(){
  const st=stats(),done=st.total>=TOTAL,end=STOPS[STOPS.length-1];
  const lat=done?end.lat:st.pos.lat,lon=done?end.lon:st.pos.lon,k=links(lat,lon);
  let h='<p class="eyebrow">Explore</p><h2 class="serif" style="margin-top:6px">'+esc(whereText(st))+'</h2>'+
    '<p class="sub">'+esc(st.country)+' · <span class="num">'+coord(lat,lon)+'</span></p>'+
    '<div class="stack" style="margin-top:20px"><a class="btn pri" href="'+k.sv+'" target="_blank" rel="noopener">Explore Where I Am</a>'+
    '<div class="two"><a class="btn" href="'+k.earth+'" target="_blank" rel="noopener">Google Earth</a><a class="btn" href="'+k.sat+'" target="_blank" rel="noopener">Satellite</a></div>'+
    '<a class="btn ghost" href="'+k.maps+'" target="_blank" rel="noopener">Open in Google Maps</a></div>'+
    '<p class="note">Explore Where I Am asks Google for official Street View at this exact route coordinate. Google shows its nearest panorama, or the plain map if none is close. This page cannot check coverage in advance or measure how far that panorama is from you.'+
    (SPARSE[st.country]?' Official Street View is sparse or absent in much of '+esc(st.country)+', so Google Earth and Satellite are the better view here.':'')+'</p>';
  h+='<div class="sect"><h3>Destinations</h3><div class="list">';
  MILESTONES.forEach(s=>{
    const reached=st.total>=s.mi;
    h+='<button class="item" data-act="city" data-n="'+esc(s.n)+'"><span class="glyph '+(reached?"done":"")+'">'+(reached?ICON.check:ICON.pin)+'</span><span class="t"><b>'+esc(s.n)+'</b><span>'+esc(ctry(s))+'</span></span><span class="r">'+(reached?"Reached":mi(s.mi-st.total)+" mi")+'</span></button>';
  });
  $("#v-explore").innerHTML=h+'</div></div>';
}
const ICON={
  check:'<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  pin:'<svg viewBox="0 0 24 24"><path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 10-13 0c0 5 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
  lock:'<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  star:'<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.900 6.800 19.700l1-5.900L3.500 9.700l5.900-.8z"/></svg>'
};
function renderRewards(){
  const st=stats(),defs=awardDefs(st),byStop={},aw=AW(),u=U();
  defs.filter(a=>a.at).forEach(a=>byStop[a.at]=a);
  const earned=defs.filter(a=>aw[a.id]).length;
  let h='<p class="eyebrow">Rewards</p><h2 class="serif" style="margin-top:6px">'+earned+' of '+defs.length+' earned</h2><p class="sub">'+MILESTONES.filter(s=>u[s.n]).length+' of '+MILESTONES.length+' destinations reached.</p>';
  h+='<div class="sect"><h3>Milestones</h3><div class="medals">';
  defs.filter(a=>a.mark).forEach(a=>{h+='<div class="medal '+(aw[a.id]?"done":"")+'"><i>'+esc(a.mark)+'</i>'+esc(a.name)+(aw[a.id]?'<br><span style="color:var(--muted);font-size:12px">'+niceShort(aw[a.id])+'</span>':'')+'</div>';});
  h+='</div></div><div class="sect"><h3>The road to '+esc(RT.to)+'</h3><div class="tl" id="tl"><div class="fill" id="tlfill"></div>';
  MILESTONES.forEach(s=>{
    const d=!!u[s.n],a=byStop[s.n],r=rec(s.n),f=ferryInto[s.n];
    h+='<div class="stop '+(d?"done":"")+'"><span class="mi">'+fmt(s.mi)+' mi</span><b>'+esc(s.n)+'</b><p>'+esc(ctry(s))+(r?" · "+esc(r.dish):"")+(f?" · by "+crossing(f)+" from "+esc(f.a):"")+'</p>'+
      (a?'<span class="award" style="'+(aw[a.id]?"":"border-color:var(--line);color:var(--muted)")+'">'+esc(a.name)+'</span>':'')+'</div>';
  });
  $("#v-rewards").innerHTML=h+'</div></div>';
  requestAnimationFrame(()=>{const tl=$("#tl");if(!tl)return;const ds=tl.querySelectorAll(".stop.done");const last=ds[ds.length-1];if(last)$("#tlfill").style.height=Math.max(0,last.offsetTop)+"px";});
}
let recTab="route";
function renderRecipes(){
  const penTotal=sum(ridesOf("penang"));
  let h='<p class="eyebrow">Recipes</p><h2 class="serif" style="margin-top:6px">'+(recTab==="fuel"?"Fuel the Journey":recTab==="favs"?"Favourites":"A dish for every city")+'</h2>'+
    '<div class="seg wide" style="margin-top:16px"><button data-act="rectab" data-t="route" class="'+(recTab==="route"?"on":"")+'">The route</button><button data-act="rectab" data-t="fuel" class="'+(recTab==="fuel"?"on":"")+'">Fuel</button><button data-act="rectab" data-t="favs" class="'+(recTab==="favs"?"on":"")+'">Favourites</button></div>';
  if(recTab==="route"&&!isPen()){
    const st=stats(),u=U(),ms=MILESTONES.filter(hasDish);
    h+='<p class="note">'+ms.filter(s=>u[s.n]).length+' of '+ms.length+' unlocked on this journey. '+(SAMPLE?"Each stop has a local dish. Claude writes the recipe when you open it after arriving, and it is then kept for good.":(STANDALONE?"Recipes for planned journeys are written by Claude, so they are only available in the Claude version of the app.":"Recipes for planned journeys are written by Claude, which is not available in this view."))+'</p><div class="list" style="margin-top:14px">';
    ms.forEach(s=>{const un=!!u[s.n],id=recId(s.n);
      h+='<button class="item '+(un?"":"locked")+'" data-act="recipe" data-id="'+esc(id)+'"><span class="glyph '+(un?"done":"")+'">'+(un?ICON.check:ICON.lock)+'</span><span class="t"><b class="dish">'+esc(jdish(RT.id,s.n))+'</b><span>'+esc(s.n)+(ctry(s)?", "+esc(ctry(s)):"")+'</span></span><span class="r">'+(un?(S.favs.includes(id)?"Favourite":""):mi(s.mi-st.total)+" mi")+'</span></button>';});
    h+='</div><div class="sect"><h3>Coventry to Penang</h3>';
  }
  if(recTab==="route"){
    const n=RECIPES.filter(r=>S.unlocked[r.city]).length;
    h+='<p class="note">'+n+' of '+RECIPES.length+' unlocked. '+(isPen()?"Each one opens when you reach its city and stays yours.":"These dishes belong to the Coventry to Penang journey and unlock as you ride that route.")+'</p><div class="list" style="margin-top:14px">';
    RECIPES.forEach(r=>{const u=!!S.unlocked[r.city];
      h+='<button class="item '+(u?"":"locked")+'" data-act="recipe" data-id="r:'+esc(r.city)+'"><span class="glyph '+(u?"done":"")+'">'+(u?ICON.check:ICON.lock)+'</span><span class="t"><b class="dish">'+esc(r.dish)+'</b><span>'+esc(r.city)+", "+esc(CITIES[r.city].c)+'</span></span><span class="r">'+(u?(S.favs.includes("r:"+r.city)?"Favourite":""):mi(Math.max(0,PEN.stopMi[r.city]-penTotal))+" mi")+'</span></button>';});
    h+='</div>'+(isPen()?"":"</div>");
  }else if(recTab==="fuel"){
    h+='<p class="note">Practical food for riding and recovery, from ordinary UK supermarket ingredients.</p>';
    [...new Set(FUEL.map(f=>f.cat))].forEach(cat=>{
      h+='<div class="sect" style="margin-top:22px"><h3>'+esc(cat)+'</h3><div class="list">';
      FUEL.filter(f=>f.cat===cat).forEach(f=>{h+='<button class="item" data-act="recipe" data-id="f:'+esc(f.dish)+'"><span class="t"><b class="dish">'+esc(f.dish)+'</b><span>'+esc(f.time)+" · "+esc(f.serves)+'</span></span><span class="r">'+(S.favs.includes("f:"+f.dish)?"Favourite":"")+'</span></button>';});
      h+='</div></div>';});
  }else{
    const items=S.favs.map(id=>{if(id[0]==="c"){const k=id.slice(2).split("|"),r=ROUTES[k[0]]&&ROUTES[k[0]].recipes&&ROUTES[k[0]].recipes[k[1]];return {id,r:r&&{dish:r.dish,city:k[1]}};}
      return {id,r:id[0]==="r"?RBY[id.slice(2)]:FUEL.find(f=>f.dish===id.slice(2))};}).filter(x=>x.r);
    if(!items.length)h+='<p class="note" style="margin-top:20px">No favourites yet. Open any unlocked recipe and tap Save as favourite.</p>';
    else{h+='<div class="list" style="margin-top:14px">';items.forEach(x=>{h+='<button class="item" data-act="recipe" data-id="'+esc(x.id)+'"><span class="t"><b class="dish">'+esc(x.r.dish)+'</b><span>'+esc(x.r.city||x.r.cat)+'</span></span></button>';});h+='</div>';}
  }
  $("#v-recipes").innerHTML=h;
}
function journeyRow(id,name,total){
  const done=sum(ridesOf(id)),on=RT.id===id;
  return '<button class="item" data-act="journey" data-id="'+esc(id)+'"><span class="glyph '+(on?"done":"")+'">'+(on?ICON.check:ICON.pin)+'</span><span class="t"><b>'+esc(name)+'</b><span>'+(on?"Current journey":"Tap to switch")+'</span></span><span class="r">'+fmt(done)+(total?" of "+fmt(total):"")+' mi</span></button>';
}
function renderProfile(){
  const st=stats(),s=S.settings,diff=st.total-st.planned;
  const hrs=st.need/(+s.speed||16.3),perRide=st.need/Math.max(1,+s.days||4);
  let h='<p class="eyebrow">Profile</p><h2 class="serif" style="margin-top:6px">Your journeys</h2>';
  h+='<div class="list" style="margin-top:14px">'+journeyRow("penang","Coventry → Penang",PEN.total)+S.journeys.map(j=>journeyRow(j.id,j.from.n+" → "+j.to.n,j.miles)).join("")+'</div>'+
     '<button class="btn" style="margin-top:14px" data-act="plan">Plan a new journey</button>'+
     '<p class="note">Choose any start and end. Each journey keeps its own rides and progress.</p>';
  h+='<div class="sect"><h3>Your plan</h3><div class="seg wide">'+["1y","2y","3y","custom"].map(g=>'<button data-act="goal" data-g="'+g+'" class="'+(s.goal===g?"on":"")+'">'+({"1y":"1 year","2y":"2 years","3y":"3 years",custom:"Custom"}[g])+'</button>').join("")+'</div>';
  if(s.goal==="custom")h+='<label class="f" for="g-date">Arrive in '+esc(RT.to)+' by<input type="date" id="g-date" value="'+esc(s.goalDate||st.goalDate)+'" min="'+addDays(today(),7)+'"></label>';
  h+='<div class="two"><label class="f" for="g-speed">Average speed (mph)<input type="number" id="g-speed" inputmode="decimal" step="0.1" min="5" max="40" value="'+esc(s.speed)+'"></label>'+
     '<label class="f" for="g-days">Riding days a week<input type="number" id="g-days" inputmode="numeric" step="1" min="1" max="7" value="'+esc(s.days)+'"></label></div></div>';
  h+='<div class="rows" style="margin-top:20px"><div class="row"><span class="k">Target arrival</span><span class="v">'+nice(st.goalDate)+'</span></div>'+
    '<div class="row"><span class="k">Needed each week from today</span><span class="v">'+mi(st.need)+' mi<small>about '+fmt(hrs,1)+' hours at '+esc(s.speed)+' mph</small></span></div>'+
    '<div class="row"><span class="k">Per ride</span><span class="v">'+mi(perRide)+' mi<small>'+esc(s.days)+' rides, '+(7-Math.min(7,+s.days||4))+' recovery days</small></span></div>'+
    '<div class="row"><span class="k">This week</span><span class="v">'+mi(st.thisWeek)+' mi</span></div>'+
    '<div class="row"><span class="k">Against the plan</span><span class="v">'+(st.rides.length?(diff>=0?mi(diff)+" mi ahead":mi(-diff)+" mi to make up"):"Starts with your first ride")+(st.rides.length&&diff<0?'<small>about '+fmt(-diff/(+s.speed||16.3),1)+' hours of riding</small>':'')+'</span></div>'+
    '<div class="row"><span class="k">Estimated arrival at recent pace</span><span class="v">'+(st.eta?nice(st.eta):"—")+'</span></div></div>';
  const wk=monday(today()),bars=[];for(let i=7;i>=0;i--){const k=addDays(wk,-7*i);bars.push([k,st.weeks[k]||0]);}
  const mx=Math.max(st.need,...bars.map(b=>b[1]),1);
  h+='<div class="sect"><h3>Last eight weeks</h3><div class="weeks" role="img" aria-label="Weekly miles for the last eight weeks">'+
     '<div class="target" style="bottom:'+(st.need/mx*100)+'%"><span>'+mi(st.need)+' mi target</span></div>'+
     bars.map(b=>'<div class="w '+(b[1]>=st.need&&b[1]>0?"hit":"")+'" style="height:'+(b[1]/mx*100)+'%" title="'+niceShort(b[0])+": "+mi(b[1])+' mi"></div>').join("")+'</div>'+
     '<p class="note">'+bars.filter(b=>b[1]>0).length+' of the last 8 weeks had a ride.</p></div>';
  h+='<div class="sect"><div class="head"><h3 style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600">Ride history</h3>'+(undoSnap?'<button class="btn sm ghost" data-act="undo">Undo last change</button>':'')+'</div><div class="list" style="margin-top:10px">';
  if(!st.rides.length)h+='<p class="note" style="padding:14px 0">No rides on this journey yet.</p>';
  st.rides.slice().reverse().forEach(r=>{const est=r.mins?r.mins+" min":"≈ "+Math.round(r.miles/(+s.speed||16.3)*60)+" min";
    h+='<button class="item" data-act="edit" data-id="'+esc(r.id)+'"><span class="t"><b>'+esc(r.title||"Peloton ride")+'</b><span>'+nice(r.date)+" · "+est+(r.notes?" · "+esc(r.notes):"")+'</span></span><span class="r" style="color:var(--ink);font-weight:600">'+mi(r.miles)+' mi</span></button>';});
  h+='</div></div>';
  const th=s.theme==="light"||s.theme==="dark"?s.theme:"auto";
  h+='<div class="sect"><h3>Appearance</h3><div class="seg wide" role="group" aria-label="Appearance">'+[["light","Light"],["dark","Dark"],["auto","Automatic"]].map(o=>'<button data-act="theme" data-t="'+o[0]+'" class="'+(th===o[0]?"on":"")+'">'+o[1]+'</button>').join("")+'</div><p class="note">Automatic follows your device or the Claude app.</p></div>';
  h+='<div class="sect"><h3>Your data</h3><p class="note" id="p-store" style="margin-top:0">'+storeText()+'</p><div class="stack" style="margin-top:12px"><div class="two"><button class="btn" data-act="csv">Export rides (CSV)</button><button class="btn" data-act="json">Export all (JSON)</button></div><button class="btn ghost" data-act="restore">Restore from a JSON export</button><input type="file" id="restore-file" accept="application/json,.json" hidden></div></div>';
  const cross=RT.legs.filter(l=>l.k!=="road");
  h+='<div class="sect"><h3>About this route</h3><div class="prose" style="font-size:15px;color:var(--muted)"><p>'+esc(RT.from)+' to '+esc(RT.to)+' is '+fmt(TOTAL)+' miles of road across '+RT.entries.length+(RT.entries.length===1?' country':' countries')+
    (cross.length?', plus '+cross.length+(cross.length===1?' crossing':' crossings')+' by sea that '+(cross.length===1?'does':'do')+' not count: '+cross.map(l=>esc(l.a)+' to '+esc(l.b)).join(', ')+'.':'.')+'</p>'+
    '<p>Routes follow real roads from the Natural Earth 1:10m road dataset, which covers major roads worldwide. It is generalised, so it smooths out small bends and the true road distance is likely a few per cent longer. Treat totals as sound estimates, not surveyed figures.</p>'+
    (profile()?'<p>Along the way you climb about '+fmt(profile().up)+' m in total, with a highest point of about '+fmt(profile().hi)+' m. Elevation comes from NOAA\'s ETOPO1 model at 10 arc-minute resolution, so real climbing will be higher.</p>':'')+
    (isPen()?'':'<p>Where two places are not joined by road, the route rides to the coast, crosses by sea and carries on. Stops along the way are the larger towns the route passes.</p>')+
    '<p>Your mileage is stored separately from the route, so a route can be refined later without losing a single mile.</p></div></div>';
  $("#v-profile").innerHTML=h;
}
/* ---------- Landing screen ---------- */
let landingOpen=true;
function landingText(){}
function drawLanding(){
  const cv=$("#land-cv");if(!cv||!landingOpen)return;
  const dpr=Math.min(2,window.devicePixelRatio||1),W=Math.round(cv.clientWidth*dpr),H=Math.round(cv.clientHeight*dpr);
  if(!W||!H)return;
  cv.width=W;cv.height=H;const cx=cv.getContext("2d");
  const my=l=>Math.log(Math.tan(Math.PI/4+l*RAD/2)),top=my(76),bot=my(-56);
  /* the whole world fills the upper part of the screen; on narrow screens it is centred on Europe, Africa and Asia */
  const sc=Math.max(W/(2*Math.PI),H*.72/(top-bot)),mx=25*RAD,mY=(top+bot)/2,ccx=W/2,ccy=H*.36;
  const sea=[16,74,110];
  if(!ELEVG){cx.fillStyle="rgb("+sea.join(",")+")";cx.fillRect(0,0,W,H);return;}
  const E=ELEVG,img=cx.createImageData(W,H),d=img.data,base=Math.round(-E.base/E.step);
  const at=(x,y)=>E.g[Math.max(0,Math.min(E.h-1,y))*E.w+((x%E.w)+E.w)%E.w]*E.step+E.base;
  for(let y=0;y<H;y++){
    const m=mY+(ccy-y-.5)/sc,lat=(2*Math.atan(Math.exp(m))-Math.PI/2)/RAD,gy=Math.round((90-lat)*6);
    for(let x=0;x<W;x++){
      const lon=(mx+(x+.5-ccx)/sc)/RAD,gx=((Math.round((lon+180)*6)%E.w)+E.w)%E.w,o=(y*W+x)*4;
      const code=E.g[Math.max(0,Math.min(E.h-1,gy))*E.w+gx];
      if(code===base||lat<-58||lat>82||gy<0||gy>=E.h){d[o]=sea[0];d[o+1]=sea[1];d[o+2]=sea[2];d[o+3]=255;continue;}
      const e=code*E.step+E.base,dx=at(gx+1,gy)-at(gx-1,gy),dy=at(gx,gy+1)-at(gx,gy-1);
      const sh=Math.max(.72,Math.min(1.2,1+(dy-dx)/1400)),c=ramp(e);
      d[o]=Math.min(255,c[0]*sh);d[o+1]=Math.min(255,c[1]*sh);d[o+2]=Math.min(255,c[2]*sh);d[o+3]=255;
    }
  }
  cx.putImageData(img,0,0);
  cv.classList.add("on");
}
function closeLanding(){
  if(!landingOpen)return;landingOpen=false;
  const l=$("#landing");l.classList.add("out");setTimeout(()=>{l.hidden=true;},460);
  if(map)setTimeout(()=>{map.invalidateSize();frame(false);},60);
}
function applyTheme(){const t=S.settings.theme;const r=document.documentElement;if(t==="light"||t==="dark")r.setAttribute("data-app-theme",t);else r.removeAttribute("data-app-theme");}
function renderAll(){applyTheme();landingText();renderJourney();renderExplore();renderRewards();renderRecipes();renderProfile();setStatus();updateMap(!map||!map._loaded);}

/* ---------- Sheets ---------- */
function sheet(html){$("#toast").hidden=true;$("#sheet").innerHTML=html;$("#scrim").hidden=false;$("#sheet").scrollTop=0;const f=$("#sheet [autofocus]");if(f)setTimeout(()=>f.focus(),60);}
function closeSheet(){$("#scrim").hidden=true;$("#sheet").innerHTML="";}
const head=(eyebrow,title)=>'<div class="sheethead"><div><p class="eyebrow">'+esc(eyebrow)+'</p><h2 class="serif" style="margin-top:4px">'+esc(title)+'</h2></div><button class="x" data-act="close" aria-label="Close">×</button></div>';
function rideSheet(r){
  const e=r||{date:today(),miles:"",mins:"",title:"",notes:""};
  sheet(head(r?"Edit ride":"Log a ride",r?nice(r.date):"How far today?")+
    '<form id="ride-form" novalidate><input type="hidden" id="r-id" value="'+esc(r?r.id:"")+'">'+
    '<label class="f" for="r-miles">Distance (miles)<input id="r-miles" type="number" inputmode="decimal" step="0.01" min="0.1" max="300" required value="'+esc(e.miles)+'" '+(r?"":"autofocus")+'></label>'+
    '<div class="two"><label class="f" for="r-date">Date<input id="r-date" type="date" value="'+esc(e.date)+'" max="'+today()+'"></label>'+
    '<label class="f" for="r-mins">Duration (min)<input id="r-mins" type="number" inputmode="numeric" step="1" min="1" max="1000" value="'+esc(e.mins||"")+'" placeholder="Optional"></label></div>'+
    '<label class="f" for="r-title">Ride title<input id="r-title" type="text" maxlength="80" value="'+esc(e.title)+'" placeholder="Optional"></label>'+
    '<label class="f" for="r-notes">Notes<textarea id="r-notes" maxlength="400" placeholder="Optional">'+esc(e.notes)+'</textarea></label>'+
    '<p class="err" id="r-err" hidden></p><div class="stack" style="margin-top:20px"><button class="btn pri" type="submit">'+(r?"Save changes":"Save ride")+'</button>'+
    (r?'<button class="btn danger" type="button" data-act="del" data-id="'+esc(r.id)+'">Delete this ride</button>':'')+'</div></form>');
}
function submitRide(){
  const miles=parseFloat($("#r-miles").value),date=$("#r-date").value||today(),err=$("#r-err");
  if(!(miles>0)||miles>300){err.textContent="Enter the distance in miles, between 0.1 and 300.";err.hidden=false;$("#r-miles").focus();return;}
  if(date>today()){err.textContent="That date is in the future. Choose today or earlier.";err.hidden=false;return;}
  const mins=parseInt($("#r-mins").value,10),id=$("#r-id").value;
  const ride={id:id||Date.now().toString(36)+Math.random().toString(36).slice(2,6),date,miles:Math.round(miles*100)/100,mins:mins>0?mins:null,title:$("#r-title").value.trim(),notes:$("#r-notes").value.trim(),j:RT.id};
  change(()=>{if(id)S.rides=S.rides.map(r=>r.id===id?ride:r);else S.rides.push(ride);},id?"Ride updated":mi(ride.miles)+(ride.miles===1?" mile":" miles")+" added");
}
function change(fn,msg){
  undoSnap=JSON.stringify(S.rides);
  fn();closeSheet();
  checkMilestones(false);
  persist();renderAll();
  toast(msg,true);
}
let toastT;
function toast(msg,undo){const t=$("#toast");t.firstElementChild.textContent=msg;t.lastElementChild.hidden=!undo;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,7000);}
function celebrate(stops,awards){
  const s=stops[stops.length-1],ci=s&&info(s.n);
  let h='<div class="arrive"><div class="ring">'+ICON.star+'</div>';
  if(s){h+='<p class="eyebrow">'+esc(ctry(s))+" · "+fmt(s.mi)+' miles from '+esc(MILESTONES[0].n)+'</p><h2 style="margin-top:8px">You have reached '+esc(s.n)+'</h2>'+(ci?'<p class="sub" style="margin-top:10px">'+esc(ci.intro)+'</p>':'');
    if(stops.length>1)h+='<p class="note">Also passed on this ride: '+stops.slice(0,-1).map(x=>esc(x.n)).join(", ")+'.</p>';}
  else h+='<p class="eyebrow">Achievement</p><h2 style="margin-top:8px">'+esc(awards[0].name)+'</h2>';
  h+='</div>';
  const list=s?awards:awards.slice(1);
  if(list.length){h+='<div class="sect" style="margin-top:22px"><h3>'+(list.length>1?"Achievements":"Achievement")+' earned</h3><div class="list">'+list.map(a=>'<div class="item"><span class="glyph done" style="border-color:var(--award);color:var(--award)">'+ICON.star+'</span><span class="t"><b>'+esc(a.name)+'</b><span>'+esc(a.desc||"")+'</span></span></div>').join("")+'</div></div>';}
  const rs=stops.filter(x=>rec(x.n));
  if(rs.length){h+='<div class="sect" style="margin-top:22px"><h3>'+(rs.length>1?"Recipes":"Recipe")+' unlocked</h3><div class="list">'+rs.map(x=>'<button class="item" data-act="recipe" data-id="'+esc(recId(x.n))+'"><span class="glyph done">'+ICON.check+'</span><span class="t"><b class="dish">'+esc(rec(x.n).dish)+'</b><span>'+esc(x.n)+'</span></span><span class="r">Open</span></button>').join("")+'</div></div>';}
  h+='<div class="stack" style="margin-top:22px">'+(s?'<a class="btn" href="'+links(s.lat,s.lon).sv+'" target="_blank" rel="noopener">Explore the streets of '+esc(s.n)+'</a>':'')+'<button class="btn pri" data-act="close">Keep riding</button></div>';
  sheet(h);
}
function citySheet(n){
  const s=MILESTONES.find(x=>x.n===n);if(!s)return;
  const c=info(n),st=stats(),reached=st.total>=s.mi,k=links(s.lat,s.lon),r=rec(n),f=ferryInto[n],u=U();
  let h=head(ctry(s)+" · "+fmt(s.mi)+" miles from "+MILESTONES[0].n,n)+'<div class="prose">'+(c?'<p style="font-size:18px;line-height:1.45">'+esc(c.intro)+'</p>':'')+
    '<p class="note" style="margin:0 0 6px">'+(reached?"Reached "+(u[n]?nice(u[n]):""):mi(s.mi-st.total)+" miles to go")+(f?" · arrive by "+crossing(f)+" from "+esc(f.a):"")+'</p>';
  if(c)h+='<h4>Good to know</h4><ul>'+c.facts.map(x=>"<li>"+esc(x)+"</li>").join("")+'</ul><h4>Notable sights</h4><ul>'+c.sights.map(x=>"<li>"+esc(x)+"</li>").join("")+'</ul><h4>Culture and history</h4><p>'+esc(c.highlight)+'</p>';
  else h+='<p class="note">Written guides are only available on the Coventry to Penang journey. Use the links below to look around.</p>';
  if(r)h+='<h4>Local recipe</h4><button class="item" style="border-top:1px solid var(--line)" data-act="recipe" data-id="'+esc(recId(n))+'"><span class="glyph '+(u[n]?"done":"")+'">'+(u[n]?ICON.check:ICON.lock)+'</span><span class="t"><b class="dish">'+esc(r.dish)+'</b><span>'+(u[n]?"Unlocked":"Unlocks when you arrive")+'</span></span></button>';
  h+='</div><div class="stack" style="margin-top:22px"><a class="btn pri" href="'+k.sv+'" target="_blank" rel="noopener">Street View in '+esc(n)+'</a><div class="two"><a class="btn" href="'+k.earth+'" target="_blank" rel="noopener">Google Earth</a><a class="btn" href="'+k.sat+'" target="_blank" rel="noopener">Satellite</a></div></div>'+
    (SPARSE[ctry(s)]?'<p class="note">Official Street View is sparse or absent in much of '+esc(ctry(s))+'. If Google opens the plain map, try Google Earth.</p>':'');
  sheet(h);
}
function recipeBody(id,r,eyebrow,kind){
  const fav=S.favs.includes(id);
  let h=head(eyebrow,r.dish)+'<div class="prose">';
  if(r.blurb)h+='<p style="font-size:18px;line-height:1.45">'+esc(r.blurb)+'</p>';
  h+='<div class="meta">'+(kind==="fuel"?'<span>'+esc(r.serves)+'</span><span>'+esc(r.time)+'</span>':'<span>'+esc(r.serves)+'</span><span>Prep '+esc(r.prep)+'</span><span>Cook '+esc(r.cook)+'</span>'+(r.veg?"<span>Vegetarian</span>":""))+'</div>';
  if(r.n)h+='<p class="note" style="margin-top:4px">'+esc(r.n)+'. Approximate.</p>';
  h+='<h4>Ingredients</h4><ul>'+r.ing.map(x=>"<li>"+esc(x)+"</li>").join("")+'</ul><h4>Method</h4><ol>'+r.steps.map(x=>"<li>"+esc(x)+"</li>").join("")+'</ol>';
  if(r.adapt)h+='<h4>Adaptations</h4><p>'+esc(r.adapt)+'</p>';
  if(kind==="route")h+='<p class="note">Nutrition is not shown for destination dishes because it varies too much with cut, portion and brand to state reliably.</p>';
  if(kind==="made")h+='<p class="note">Written by Claude for this stop and not kitchen-tested. Read it through before you cook.</p>';
  h+='</div><div class="stack" style="margin-top:22px"><button class="btn '+(fav?"":"pri")+'" data-act="fav" data-id="'+esc(id)+'">'+(fav?"Remove from favourites":"Save as favourite")+'</button></div>';
  sheet(h);
}
const lockedSheet=(eyebrow,title,msg,left)=>sheet(head(eyebrow,title)+'<div class="arrive" style="padding:26px 0"><div class="ring" style="border-color:var(--line);box-shadow:none;color:var(--muted)">'+ICON.lock+'</div><p class="sub">'+esc(msg)+'</p>'+(left!=null?'<p style="font-size:22px;font-weight:600;margin:10px 0 0" class="num">'+mi(left)+' miles to go</p>':'')+'</div><button class="btn" data-act="close">Close</button>');
let SAMPLE=null,writing=null;
async function recipeSheet(id){
  if(id[0]==="c"){
    const k=id.slice(2).split("|"),jid=k[0],stop=k[1],R=ROUTES[jid];if(!R)return;
    const s=R.stops.find(x=>x.n===stop),place=stop+(s&&s.c?", "+s.c:""),un=(S.jstate[jid]||{unlocked:{}}).unlocked[stop];
    if(!un){lockedSheet(place,jdish(jid,stop),"This recipe unlocks when you reach "+stop+".",jid===RT.id&&s?Math.max(0,s.mi-stats().total):null);return;}
    if(R.recipes&&R.recipes[stop]){recipeBody(id,R.recipes[stop],place,"made");return;}
    if(!SAMPLE){sheet(head(place,jdish(jid,stop))+'<p class="sub">'+(STANDALONE?"Recipes for planned journeys are written by Claude, so they are only available in the Claude version of the app.":"Recipes for planned journeys are written by Claude, which is not available in this view. Open the app inside Claude and try again.")+'</p><button class="btn" style="margin-top:18px" data-act="close">Close</button>');return;}
    if(writing===id)return;writing=id;
    sheet(head(place,jdish(jid,stop))+'<p class="sub">Claude is writing this recipe. It usually takes under a minute, and only happens once.</p>');
    const known=R.dishes&&R.dishes[stop];
    const prompt="Write an accurate, culturally appropriate home recipe for "+(known?known+", a traditional dish from "+place:"one traditional dish that is genuinely associated with "+place+" or its region")+
      ". Use UK measurements (g, ml, tsp, tbsp, oven temperatures in °C with the fan temperature in brackets) and ingredients found in UK supermarkets, naming a substitute where the authentic ingredient is hard to find. "+
      'Reply with only a JSON object with these keys: "dish" (the dish name), "blurb" (one or two sentences on what it is and its link to the place), "serves" (for example "Serves 4"), "prep" (for example "20 min"), "cook" (for example "45 min"), "veg" (true or false), "ing" (array of ingredient strings with quantities), "steps" (array of 4 to 7 method steps as strings), "adapt" (one sentence giving a vegetarian or lighter adaptation).';
    try{
      const r=await SAMPLE.json(prompt);
      if(!r||typeof r.dish!=="string"||!Array.isArray(r.ing)||!Array.isArray(r.steps)||!r.ing.length||!r.steps.length)throw {code:"invalid_json"};
      const clean={dish:String(r.dish).slice(0,120),blurb:String(r.blurb||"").slice(0,600),serves:String(r.serves||"").slice(0,40),prep:String(r.prep||"").slice(0,40),cook:String(r.cook||"").slice(0,40),veg:r.veg===true,ing:r.ing.slice(0,40).map(x=>String(x).slice(0,300)),steps:r.steps.slice(0,12).map(x=>String(x).slice(0,900)),adapt:String(r.adapt||"").slice(0,500)};
      (R.recipes||(R.recipes={}))[stop]=clean;persistRoute(jid);writing=null;
      renderRecipes();if(!$("#scrim").hidden)recipeBody(id,clean,place,"made");
    }catch(e){
      writing=null;const c=e&&e.code;
      const msg=c==="not_granted"||c==="sampling_disabled"?"Claude was not allowed to write recipes in this view, so this one could not be made."
        :c==="rate_limited"?"Claude is busy or you have reached a usage limit. Try again in a little while."
        :c==="session_expired"?"You need to sign in to Claude again, then try once more.":"The recipe could not be written this time.";
      sheet(head(place,jdish(jid,stop))+'<p class="sub">'+msg+'</p><div class="stack" style="margin-top:18px"><button class="btn pri" data-act="recipe" data-id="'+esc(id)+'">Try again</button><button class="btn" data-act="close">Close</button></div>');
    }
    return;
  }
  const isR=id[0]==="r",key=id.slice(2),r=isR?RBY[key]:FUEL.find(f=>f.dish===key);if(!r)return;
  if(isR&&!S.unlocked[key]){lockedSheet(key+", "+CITIES[key].c,r.dish,"This recipe unlocks when you reach "+key+" on the Coventry to Penang journey.",Math.max(0,PEN.stopMi[key]-sum(ridesOf("penang"))));return;}
  recipeBody(id,r,isR?key+", "+CITIES[key].c:r.cat,isR?"route":"fuel");
}
/* dish names for a planned journey, asked once when it is created */
async function nameDishes(id){
  const R=ROUTES[id];if(!SAMPLE||!R||R.dishes)return;
  const places=R.stops.filter(hasDish);if(!places.length)return;
  const prompt="For each place below, name one traditional dish that is genuinely associated with that town or its region, choosing a local speciality over a generic national dish where one exists. Do not repeat a dish. "+
    "Reply with only a JSON object whose keys are the place names exactly as written before the comma, and whose values are the dish names.\n\n"+places.map(s=>s.n+", "+(s.c||"")).join("\n");
  try{const r=await SAMPLE.json(prompt);if(r&&typeof r==="object"){const d={};places.forEach(s=>{if(typeof r[s.n]==="string"&&r[s.n].trim())d[s.n]=r[s.n].trim().slice(0,120);});
    if(Object.keys(d).length){R.dishes=d;persistRoute(id);if(RT.id===id){renderRecipes();renderRewards();}}}}
  catch(e){console.error(e);}
}
/* ---------- Journeys: switching ---------- */
const decode=r=>({id:r.id,from:r.from,to:r.to,stops:r.stops,runs:r.runs,entries:r.entries,
  legs:r.legs.map(l=>{const c=[];let x=0,y=0;for(let i=0;i<l.c.length;i+=2){x+=l.c[i];y+=l.c[i+1];c.push([x/1000,y/1000]);}return {a:l.a,b:l.b,k:l.k,c};})});
const encode=r=>({id:r.id,from:r.from,to:r.to,stops:r.stops,runs:r.runs,entries:r.entries,
  legs:r.legs.map(l=>{const c=[];let x=0,y=0;l.c.forEach(p=>{const X=Math.round(p[0]*1000),Y=Math.round(p[1]*1000);c.push(X-x,Y-y);x=X;y=Y;});return {a:l.a,b:l.b,k:l.k,c};})});
async function activate(id,quiet){
  let rt=PENANG;
  if(id!=="penang"){
    const jm=jmeta(id);
    if(!jm)id="penang";
    else if(ROUTES[id])rt=decode(ROUTES[id]);
    else{
      try{if(!quiet)toast("Rebuilding the route");const built=await planRoute(jm.from,jm.to);built.id=id;ROUTES[id]=encode(built);persistRoute(id);rt=decode(ROUTES[id]);}
      catch(e){id="penang";toast("That route could not be rebuilt, so Coventry to Penang is showing.");}
    }
  }
  S.active=id;setRoute(rt);drawRoute();
}
function journeySheet(id){
  if(id===RT.id&&id==="penang")return;
  const jm=jmeta(id),name=id==="penang"?"Coventry → Penang":jm.from.n+" → "+jm.to.n,n=ridesOf(id).length;
  let h=head("Journey",name)+'<div class="stack">';
  if(id!==RT.id)h+='<button class="btn pri" data-act="switch" data-id="'+esc(id)+'">Switch to this journey</button>';
  if(id!=="penang")h+='<button class="btn danger" data-act="jdel" data-id="'+esc(id)+'">Delete this journey'+(n?" and its "+n+(n===1?" ride":" rides"):"")+'</button>';
  sheet(h+'<button class="btn ghost" data-act="close">Cancel</button></div>');
}

/* ---------- Journey planner ---------- */
let NETG=null,plan={from:null,to:null,field:"from",result:null};
const fold=s=>s.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
function loadNet(){
  if(NETG)return Promise.resolve(NETG);
  return new Promise((res,rej)=>{
    if(window.NET)return res();
    const s=document.createElement("script");s.src="net.js";s.onload=()=>res();s.onerror=()=>rej(new Error("load"));document.body.appendChild(s);
  }).then(()=>{NETG=buildNet(window.NET);return NETG;});
}
function buildNet(N){
  const n=N.n,e=N.e,nn=n.length/2,ea=[],eb=[],ek=[],eo=[],ec=[];
  for(let i=0;i<e.length;){ea.push(e[i]);eb.push(e[i+1]);ek.push(e[i+2]);ec.push(e[i+3]);eo.push(i+4);i+=4+2*e[i+3];}
  const M=ea.length,el=new Float64Array(M),adj=new Array(nn);
  const pts=i=>{const a=ea[i],b=eb[i],out=[[n[2*a]/1000,n[2*a+1]/1000]];let x=n[2*a],y=n[2*a+1];
    for(let k=0,o=eo[i];k<ec[i];k++,o+=2){x+=e[o];y+=e[o+1];out.push([x/1000,y/1000]);}out.push([n[2*b]/1000,n[2*b+1]/1000]);return out;};
  const grid=new Map(),CELL=.5,put=(x,y,v)=>{const k=Math.floor(x/CELL)*4096+Math.floor(y/CELL);let a=grid.get(k);if(!a)grid.set(k,a=[]);a.push(v);};
  for(let i=0;i<M;i++){
    const p=pts(i);let L=0;
    for(let s=0;s<p.length-1;s++){
      const a=p[s],b=p[s+1];L+=hav(a,b);
      if(ek[i]===0){const d=Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1])),steps=Math.max(1,Math.ceil(d/.2));
        for(let q=0;q<steps;q++){const t=q/steps;put(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,[i,s]);}}
    }
    el[i]=L;(adj[ea[i]]||(adj[ea[i]]=[])).push(i);(adj[eb[i]]||(adj[eb[i]]=[])).push(i);
  }
  const par=new Int32Array(nn);for(let i=0;i<nn;i++)par[i]=i;
  const find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};
  for(let i=0;i<M;i++)par[find(ea[i])]=find(eb[i]);
  const cm=new Map();for(let i=0;i<M;i++){const c=find(ea[i]);cm.set(c,(cm.get(c)||0)+el[i]);}
  const big=i=>cm.get(find(ea[i]))>=150;
  const cgrid=new Map();
  N.cities.forEach((c,i)=>{const k=Math.floor(c[3])*4096+Math.floor(c[4]);let a=cgrid.get(k);if(!a)cgrid.set(k,a=[]);a.push(i);});
  return {n,nn,ea,eb,ek,el,adj,pts,grid,CELL,cities:N.cities,cc:N.cc,cgrid,M,big};
}
function nearCity(net,lon,lat,maxMi,maxRank){
  let best=-1,bd=maxMi;const cx=Math.floor(lon),cy=Math.floor(lat);
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const a=net.cgrid.get((cx+dx)*4096+(cy+dy));if(!a)continue;
    for(const i of a){const c=net.cities[i];if(c[5]>maxRank)continue;const d=hav([lon,lat],[c[3],c[4]]);if(d<bd){bd=d;best=i;}}}
  return best;
}
function snap(net,lon,lat){
  const cx=Math.floor(lon/net.CELL),cy=Math.floor(lat/net.CELL),cl=Math.cos(lat*RAD);let best=null,bd=1e9,bestB=null,bdB=1e9,stop=99;
  for(let r=0;r<=9&&r<=stop;r++){
    for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
      const a=net.grid.get((cx+dx)*4096+(cy+dy));if(!a)continue;
      for(const v of a){const p=net.pts(v[0]),isBig=net.big(v[0]);
        for(let s=Math.max(0,v[1]-1);s<=Math.min(p.length-2,v[1]);s++){
          const A=p[s],B=p[s+1],ux=(B[0]-A[0])*cl,uy=B[1]-A[1],wx=(lon-A[0])*cl,wy=lat-A[1],L=ux*ux+uy*uy;
          const t=L?Math.max(0,Math.min(1,(wx*ux+wy*uy)/L)):0,ex=wx-t*ux,ey=wy-t*uy,d=ex*ex+ey*ey;
          if(d<bd){bd=d;best={e:v[0],s,lon:A[0]+(B[0]-A[0])*t,lat:A[1]+(B[1]-A[1])*t};}
          if(isBig&&d<bdB){bdB=d;bestB={e:v[0],s,lon:A[0]+(B[0]-A[0])*t,lat:A[1]+(B[1]-A[1])*t};}
        }}
    }
    if(best&&stop===99&&Math.sqrt(bd)<(r-.5)*net.CELL)stop=r+1;
  }
  /* prefer a substantial road network over a stray fragment when one is within about 20 miles further */
  if(bestB&&Math.sqrt(bdB)-Math.sqrt(bd)<.3)best=bestB;
  if(!best)return null;
  const p=net.pts(best.e);let la=0;for(let s=0;s<best.s;s++)la+=hav(p[s],p[s+1]);
  la+=hav(p[best.s],[best.lon,best.lat]);
  best.la=Math.min(la,net.el[best.e]);best.d=hav([lon,lat],[best.lon,best.lat]);
  return best;
}
function dijkstra(net,sources){
  const dist=new Float64Array(net.nn).fill(Infinity),prev=new Int32Array(net.nn).fill(-1),hk=[],hv=[];
  const push=(k,v)=>{let i=hk.length;hk.push(k);hv.push(v);while(i>0){const p=(i-1)>>1;if(hk[p]<=k)break;hk[i]=hk[p];hv[i]=hv[p];i=p;}hk[i]=k;hv[i]=v;};
  const pop=()=>{const k=hk[0],v=hv[0],lk=hk.pop(),lv=hv.pop(),n=hk.length;if(n){let i=0;for(;;){let c=2*i+1;if(c>=n)break;if(c+1<n&&hk[c+1]<hk[c])c++;if(hk[c]>=lk)break;hk[i]=hk[c];hv[i]=hv[c];i=c;}hk[i]=lk;hv[i]=lv;}return [k,v];};
  sources.forEach(s=>{if(s[1]<dist[s[0]]){dist[s[0]]=s[1];push(s[1],s[0]);}});
  while(hk.length){const [d,u]=pop();if(d>dist[u])continue;const a=net.adj[u];if(!a)continue;
    for(const ei of a){const v=net.ea[ei]===u?net.eb[ei]:net.ea[ei],w=net.el[ei]+(net.ek[ei]?15:0),nd=d+w;if(nd<dist[v]){dist[v]=nd;prev[v]=ei;push(nd,v);}}}
  return {dist,prev};
}
/* geometry of part of an edge between two distances measured from its first node */
function slice(net,ei,from,to){
  const p=net.pts(ei),rev=from>to,lo=Math.min(from,to),hi=Math.max(from,to),out=[];let acc=0;
  for(let s=0;s<p.length-1;s++){
    const L=hav(p[s],p[s+1]),a=acc,b=acc+L;acc=b;
    if(b<lo||a>hi)continue;
    const t0=L?Math.max(0,(lo-a)/L):0,t1=L?Math.min(1,(hi-a)/L):1;
    const P=t=>[p[s][0]+(p[s+1][0]-p[s][0])*t,p[s][1]+(p[s+1][1]-p[s][1])*t];
    if(!out.length)out.push(P(t0));
    out.push(P(t1));
  }
  if(!out.length)out.push(p[0]);
  return rev?out.reverse():out;
}
/* chain of edges from a snapped start to a graph node, following a dijkstra tree rooted at the snap */
function chain(net,sn,tree,node){
  const segs=[];let u=node;
  while(tree.prev[u]>=0){const ei=tree.prev[u],from=net.ea[ei]===u?net.eb[ei]:net.ea[ei];
    segs.push({k:net.ek[ei],c:from===net.ea[ei]?net.pts(ei):net.pts(ei).reverse()});u=from;}
  segs.reverse();
  if(sn){const toA=u===net.ea[sn.e]&&(u!==net.eb[sn.e]||Math.abs(tree.dist[u]-sn.la)<1e-6);
    segs.unshift({k:net.ek[sn.e],c:slice(net,sn.e,sn.la,toA?0:net.el[sn.e])});}
  return segs;
}
const srcOf=(net,sn)=>[[net.ea[sn.e],sn.la],[net.eb[sn.e],net.el[sn.e]-sn.la]];
async function planRoute(from,to){
  const net=await loadNet();
  const ISO=40,sa=snap(net,from.lon,from.lat),sb=snap(net,to.lon,to.lat);
  const A=sa&&sa.d<=ISO?sa:null,B=sb&&sb.d<=ISO?sb:null;
  let segs=null;const notes=[];
  const tA=A?dijkstra(net,srcOf(net,A)):null;
  if(A&&B){
    let best=Infinity,mode=null;
    const viaA=tA.dist[net.ea[B.e]]+B.la,viaB=tA.dist[net.eb[B.e]]+net.el[B.e]-B.la;
    if(viaA<best){best=viaA;mode="a";}if(viaB<best){best=viaB;mode="b";}
    if(A.e===B.e&&Math.abs(A.la-B.la)<=best){best=Math.abs(A.la-B.la);mode="same";}
    if(mode==="same")segs=[{k:net.ek[A.e],c:slice(net,A.e,A.la,B.la)}];
    else if(mode){const node=mode==="a"?net.ea[B.e]:net.eb[B.e];
      segs=chain(net,A,tA,node);segs.push({k:net.ek[B.e],c:slice(net,B.e,mode==="a"?0:net.el[B.e],B.la)});}
  }
  if(!segs){
    /* not joined by road: ride to the coast, cross by sea, ride on */
    const tB=B?dijkstra(net,srcOf(net,B)):null;
    const cand=(tree,pt)=>{const out=[{lon:pt.lon,lat:pt.lat,d:0,node:-1,name:pt.n}];
      if(!net.cs)net.cs=net.cities.map(c=>c[5]>7?null:snap(net,c[3],c[4]));
      if(tree)net.cities.forEach((c,ci)=>{const s=net.cs[ci];if(!s||s.d>12)return;
        const node=tree.dist[net.ea[s.e]]+s.la<=tree.dist[net.eb[s.e]]+net.el[s.e]-s.la?net.ea[s.e]:net.eb[s.e];
        const d=tree.dist[node];if(isFinite(d))out.push({lon:net.n[2*node]/1000,lat:net.n[2*node+1]/1000,d,node,name:c[0]});});
      return out;};
    const CA=A?cand(tA,from).slice(1):cand(null,from),CB=B?cand(tB,to).slice(1):cand(null,to);
    if(!CA.length)CA.push({lon:from.lon,lat:from.lat,d:0,node:-1,name:from.n});
    if(!CB.length)CB.push({lon:to.lon,lat:to.lat,d:0,node:-1,name:to.n});
    let best=Infinity,pa=null,pb=null;
    const rb=CB.map(c=>[c.lon*RAD,c.lat*RAD,Math.cos(c.lat*RAD)]);
    for(const a of CA){const x=a.lon*RAD,y=a.lat*RAD,cy=Math.cos(y);
      for(let j=0;j<CB.length;j++){const b=rb[j],h=Math.sin((b[1]-y)/2)**2+cy*b[2]*Math.sin((b[0]-x)/2)**2;
        const cost=a.d+CB[j].d+16*EARTH*Math.asin(Math.sqrt(h));if(cost<best){best=cost;pa=a;pb=CB[j];}}}
    segs=[];
    if(pa.node>=0)segs=chain(net,A,tA,pa.node);
    segs.push({k:2,c:[[pa.lon,pa.lat],[pb.lon,pb.lat]],an:pa.name,bn:pb.name});
    if(pb.node>=0){const back=chain(net,B,tB,pb.node).reverse();back.forEach(s=>s.c=s.c.slice().reverse());segs=segs.concat(back);}
    notes.push("No road joins these two places, so the route includes a sea crossing from "+pa.name+" to "+pb.name+".");
  }
  if(sa&&A&&sa.d>3)notes.push("The nearest mapped road to "+from.n+" is "+mi(sa.d)+" miles away, so the route starts there.");
  if(sb&&B&&sb.d>3)notes.push("The nearest mapped road to "+to.n+" is "+mi(sb.d)+" miles away, so the route ends there.");
  return assemble(net,from,to,segs,notes);
}
function assemble(net,from,to,segs,notes){
  /* merge consecutive segments of one kind into legs */
  const KIND=["road","ferry","sea"],raw=[];
  segs.forEach(s=>{if(s.c.length<2)return;const k=KIND[s.k],last=raw[raw.length-1];
    if(last&&last.k===k&&k!=="sea"){s.c.forEach((p,i)=>{if(i||last.c[last.c.length-1][0]!==p[0]||last.c[last.c.length-1][1]!==p[1])last.c.push(p);});}
    else raw.push({k,c:s.c.slice(),an:s.an,bn:s.bn});});
  let cum=0;const marks=[];
  raw.forEach(l=>{l.m0=cum;if(l.k==="road")for(let i=1;i<l.c.length;i++)cum+=hav(l.c[i-1],l.c[i]);l.m1=cum;});
  const total=cum,used=new Set(),uniq=n=>{let x=n,i=2;while(used.has(x))x=n+" ("+(i++)+")";used.add(x);return x;};
  const cname=i=>net.cc[net.cities[i][2]];
  /* country along the way */
  const boxes=G.countries.map(c=>c.p.map(r=>{let a=1e9,b=1e9,x=-1e9,y=-1e9;for(const p of r){if(p[0]<a)a=p[0];if(p[0]>x)x=p[0];if(p[1]<b)b=p[1];if(p[1]>y)y=p[1];}return [a,b,x,y];}));
  const inRing=(x,y,r)=>{let ins=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)ins=!ins;}return ins;};
  let hint=-1;
  const where=(x,y)=>{const test=ci=>{const c=G.countries[ci];for(let k=0;k<c.p.length;k++){const b=boxes[ci][k];if(x<b[0]||x>b[2]||y<b[1]||y>b[3])continue;if(inRing(x,y,c.p[k]))return true;}return false;};
    if(hint>=0&&test(hint))return G.countries[hint].n;
    for(let ci=0;ci<G.countries.length;ci++)if(ci!==hint&&test(ci)){hint=ci;return G.countries[ci].n;}
    return null;};
  const runs=[],entries=[],seen=new Set();let lastC=null;
  raw.forEach(l=>{if(l.k!=="road")return;let m=l.m0;l.c.forEach((p,i)=>{if(i)m+=hav(l.c[i-1],p);const c=where(p[0],p[1]);
    if(c&&c!==lastC){runs.push([Math.round(m*10)/10,c]);if(!seen.has(c)){seen.add(c);entries.push({n:c,mi:Math.round(m*10)/10});}lastC=c;}});});
  if(!runs.length){const c=where(from.lon,from.lat)||from.c||"";runs.push([0,c]);entries.push({n:c,mi:0});}
  const cAt=m=>{let c=runs[0][1];for(const r of runs){if(r[0]<=m)c=r[1];else break;}return c;};
  /* stops: the two ends, each crossing, then larger towns passed */
  const first=raw[0],lastL=raw[raw.length-1],fp=first.c[0],lp=lastL.c[lastL.c.length-1];
  const stops=[{n:uniq(from.n),c:from.c||cAt(0),lat:fp[1],lon:fp[0],mi:0,fixed:1}];
  const endStop={n:null,c:to.c||cAt(total),lat:lp[1],lon:lp[0],mi:total,fixed:1};
  raw.forEach((l,i)=>{if(l.k==="road")return;
    const a=l.c[0],b=l.c[l.c.length-1];
    const nameFor=(p,given,isStart,isEnd)=>{if(isStart)return stops[0].n;if(isEnd)return "__END__";
      const ci=given?-1:nearCity(net,p[0],p[1],30,9),base=given||(ci>=0?net.cities[ci][0]:null),tail=l.k==="ferry"?" ferry port":" coast";
      if(!base)return uniq(l.k==="ferry"?"Ferry terminal":"Landing");
      return uniq(used.has(base)||base===to.n?base+tail:base);};
    const an=nameFor(a,l.an,i===0,false),bn=nameFor(b,l.bn,false,i===raw.length-1);
    l.a=an;l.b=bn;
    if(i!==0)stops.push({n:an,c:where(a[0],a[1])||cAt(l.m0),lat:a[1],lon:a[0],mi:l.m0,fixed:1});
    if(i!==raw.length-1)stops.push({n:bn,c:where(b[0],b[1])||cAt(l.m1),lat:b[1],lon:b[0],mi:l.m1,fixed:1});
  });
  endStop.n=uniq(to.n);raw.forEach(l=>{if(l.b==="__END__")l.b=endStop.n;});
  const spacing=Math.max(60,total/24),cands=[];
  raw.forEach(l=>{if(l.k!=="road")return;let m=l.m0,next=l.m0;
    for(let i=1;i<l.c.length;i++){const a=l.c[i-1],b=l.c[i],L=hav(a,b);
      while(next<=m+L){const t=L?(next-m)/L:0,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t,ci=nearCity(net,x,y,7,7);
        if(ci>=0)cands.push({ci,mi:next,lon:x,lat:y,rank:net.cities[ci][5]});next+=5;}
      m+=L;}});
  const all=stops.concat([endStop]);
  [1,3,5,7].forEach(tier=>{cands.forEach(c=>{if(c.rank>tier||c.done)return;
    if(all.every(s=>Math.abs(s.mi-c.mi)>=spacing*(s.fixed?.5:1))){const nm=net.cities[c.ci][0];if(used.has(nm))return;c.done=1;
      all.push({n:uniq(nm),c:cname(c.ci),lat:c.lat,lon:c.lon,mi:c.mi});}});});
  all.sort((a,b)=>a.mi-b.mi||(a===endStop?1:b===endStop?-1:0));
  /* name the ends of road legs so every leg has a from and a to */
  raw.forEach((l,i)=>{if(l.k!=="road")return;l.a=i===0?stops[0].n:raw[i-1].b;l.b=i===raw.length-1?endStop.n:raw[i+1].a;});
  const sea=raw.filter(l=>l.k!=="road");
  return {id:null,from:from.n,to:to.n,legs:raw.map(l=>({a:l.a,b:l.b,k:l.k,c:l.c})),
    stops:all.map(s=>({n:s.n,c:s.c,lat:s.lat,lon:s.lon,mi:Math.round(s.mi*10)/10})),runs,entries,total,notes,
    seaMiles:sea.reduce((t,l)=>t+hav(l.c[0],l.c[l.c.length-1]),0),crossings:sea.length};
}
function searchPlaces(q){
  q=q.trim();if(!NETG||q.length<2)return [];
  const m=q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(m){const lat=+m[1],lon=+m[2];if(Math.abs(lat)<=90&&Math.abs(lon)<=180)return [{n:lat.toFixed(3)+", "+lon.toFixed(3),sub:"Coordinates",c:"",lat,lon}];}
  const f=fold(q),a=[],b=[];
  for(const c of NETG.cities){const nm=fold(c[0]);const hit=nm.startsWith(f)?a:nm.includes(f)?b:null;if(hit&&hit.length<8)hit.push(c);if(a.length>=8)break;}
  return a.concat(b).slice(0,8).map(c=>({n:c[0],sub:(c[1]&&c[1]!==c[0]?c[1]+", ":"")+NETG.cc[c[2]],c:NETG.cc[c[2]],lat:c[4],lon:c[3]}));
}
function planSheet(){
  const pick=k=>plan[k]?'<b>'+esc(plan[k].n)+'</b><span>'+esc(plan[k].sub||"")+'</span>':'<b style="color:var(--muted);font-weight:400">Choose a place</b>';
  let h=head("New journey","Where to?")+
    '<div class="list"><button class="item" data-act="pfield" data-f="from"><span class="glyph '+(plan.from?"done":"")+'">'+ICON.pin+'</span><span class="t"><span>Start</span>'+pick("from")+'</span></button>'+
    '<button class="item" data-act="pfield" data-f="to"><span class="glyph '+(plan.to?"done":"")+'">'+ICON.pin+'</span><span class="t"><span>End</span>'+pick("to")+'</span></button></div>'+
    '<label class="f" for="p-q">Search for the '+(plan.field==="from"?"start":"end")+'<input id="p-q" type="search" autocomplete="off" autocapitalize="words" placeholder="City name, or latitude, longitude"></label>'+
    '<div id="p-results" class="list" style="border-top:0"></div><p class="note" id="p-msg">'+(NETG?"Search about 7,300 towns and cities worldwide, or paste coordinates from a map.":"Loading the world road network. This takes a few seconds the first time.")+'</p>'+
    '<div class="stack" style="margin-top:16px"><button class="btn pri" data-act="pgo" '+(plan.from&&plan.to?"":"disabled style=\"opacity:.45\"")+'>Find the route</button></div>';
  sheet(h);
  if(!NETG)loadNet().then(()=>{const m=$("#p-msg");if(m)m.textContent="Search about 7,300 towns and cities worldwide, or paste coordinates from a map.";})
    .catch(()=>{const m=$("#p-msg");if(m){m.textContent="The road network could not be loaded. Check your connection and try again.";m.className="err";}});
}
function planResults(){
  const box=$("#p-results"),q=$("#p-q");if(!box||!q)return;
  const r=searchPlaces(q.value);plan.hits=r;
  box.innerHTML=r.map((p,i)=>'<button class="item" data-act="ppick" data-i="'+i+'"><span class="t"><b>'+esc(p.n)+'</b><span>'+esc(p.sub)+'</span></span></button>').join("")||(q.value.trim().length>=2&&NETG?'<p class="note" style="padding:10px 0">No match. Try a nearby larger town, or paste coordinates as latitude, longitude.</p>':"");
}
async function planGo(){
  if(!plan.from||!plan.to)return;
  sheet(head("New journey","Finding the route")+'<p class="sub">Working out the roads from '+esc(plan.from.n)+' to '+esc(plan.to.n)+'.</p>');
  await new Promise(r=>setTimeout(r,40));
  let r;try{r=await planRoute(plan.from,plan.to);}catch(e){console.error(e);sheet(head("New journey","No route found")+'<p class="sub">The route could not be worked out. Check your connection and try again.</p><button class="btn" style="margin-top:18px" data-act="plan">Back</button>');return;}
  plan.result=r;
  try{await loadElev();const pts=[];let c=0;r.legs.forEach((l,li)=>{if(l.k!=="road")return;l.c.forEach((q,i)=>{if(i)c+=hav(l.c[i-1],q);pts.push([q[0],q[1],c,li]);});});
    if(pts.length>1){const pr=profileOf(pts,c);r.climb=pr.up;r.peak=pr.hi;}}catch(e){}
  let h=head("New journey",plan.from.n+" → "+plan.to.n);
  if(r.total<1){h+='<p class="sub">There is no road to ride between these two places: they are joined only by sea. Choose a different start or end.</p><button class="btn" style="margin-top:18px" data-act="plan">Change places</button>';sheet(h);return;}
  h+='<div class="rows"><div class="row"><span class="k">Distance to ride</span><span class="v">'+fmt(r.total)+' mi</span></div>'+
    '<div class="row"><span class="k">Countries</span><span class="v">'+r.entries.length+'</span></div>'+
    '<div class="row"><span class="k">Stops along the way</span><span class="v">'+(r.stops.length-2)+'</span></div>'+
    (r.crossings?'<div class="row"><span class="k">Sea crossings</span><span class="v">'+r.crossings+'<small>'+fmt(r.seaMiles)+' mi, not counted</small></span></div>':'')+
    (r.climb!=null?'<div class="row"><span class="k">Climbing</span><span class="v">about '+fmt(r.climb)+' m<small>highest point about '+fmt(r.peak)+' m</small></span></div>':'')+
    '<div class="row"><span class="k">At '+esc(S.settings.speed)+' mph</span><span class="v">about '+fmt(r.total/(+S.settings.speed||16.3))+' hours</span></div></div>'+
    r.notes.map(n=>'<p class="note">'+esc(n)+'</p>').join("")+
    (r.stops.length>2?'<p class="note">Via '+r.stops.slice(1,-1).slice(0,8).map(s=>esc(s.n)).join(", ")+(r.stops.length>10?" and more":"")+'.</p>':'')+
    '<div class="stack" style="margin-top:18px"><button class="btn pri" data-act="pstart">Start this journey</button><button class="btn" data-act="plan">Change places</button></div>';
  sheet(h);
}
async function planStart(){
  const r=plan.result;if(!r)return;
  const id="j"+Date.now().toString(36);r.id=id;
  S.journeys.push({id,from:{n:plan.from.n,c:plan.from.c,lat:plan.from.lat,lon:plan.from.lon},to:{n:plan.to.n,c:plan.to.c,lat:plan.to.lat,lon:plan.to.lon},created:today(),miles:Math.round(r.total)});
  ROUTES[id]=encode(r);persistRoute(id);
  plan={from:null,to:null,field:"from",result:null};
  await activate(id,true);checkMilestones(true);persist();closeSheet();renderAll();
  nameDishes(id);
  location.hash="journey";show("journey");mapMode="all";frame(false);
  toast("Journey started");
}

/* ---------- Export and restore ---------- */
async function exportFile(name,text){
  if(STANDALONE){try{const a=document.createElement("a"),url=URL.createObjectURL(new Blob([text],{type:name.endsWith(".csv")?"text/csv":"application/json"}));
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);toast("Saved "+name);return;}catch(e){}}
  try{const d=window.claude&&await window.claude.use("downloads");if(d){await d.save({filename:name,data:text});toast("Saved "+name);return;}}
  catch(e){if(e&&e.code==="declined")return;}
  let copied=false;try{await navigator.clipboard.writeText(text);copied=true;}catch(e){}
  sheet(head("Export",name)+'<p class="sub">'+(copied?"Copied to your clipboard. ":"")+'File download is not available in this view, so here is the content to copy and keep.</p><textarea class="dump" id="dump" readonly style="margin-top:14px"></textarea><button class="btn" style="margin-top:14px" data-act="close">Done</button>');
  $("#dump").value=text;
}
const csvCell=v=>{v=String(v==null?"":v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
const jname=id=>{if(id==="penang")return "Coventry to Penang";const j=jmeta(id);return j?j.from.n+" to "+j.to.n:id;};
function toCSV(){return "date,miles,duration_minutes,title,notes,journey\n"+S.rides.slice().sort((a,b)=>a.date<b.date?-1:1).map(r=>[r.date,r.miles,r.mins||"",r.title,r.notes,jname(r.j||"penang")].map(csvCell).join(",")).join("\n")+"\n";}
function toJSON(){return JSON.stringify({app:"The Long Way Home",exported:new Date().toISOString(),state:S},null,2);}
function restoreFrom(text){
  let o;try{o=JSON.parse(text);}catch(e){toast("That file is not a valid JSON export.");return;}
  const st=normalise(o.state||o);
  sheet(head("Restore","Replace your data?")+'<p class="sub">The file holds '+st.rides.length+' rides totalling '+mi(sum(st.rides))+' miles. Restoring replaces the '+S.rides.length+' rides stored now. Destinations and recipes already unlocked stay unlocked.</p><div class="stack" style="margin-top:20px"><button class="btn pri" id="do-restore">Restore</button><button class="btn" data-act="close">Cancel</button></div>');
  $("#do-restore").onclick=async()=>{undoSnap=JSON.stringify(S.rides);const keepU=S.unlocked,keepA=S.awards;S=st;S.unlocked=Object.assign({},st.unlocked,keepU);S.awards=Object.assign({},st.awards,keepA);closeSheet();await activate(S.active,true);checkMilestones(true);persist();renderAll();toast("Data restored",true);};
}

/* ---------- Events ---------- */
function show(tab){
  const tabs=["journey","explore","rewards","recipes","profile"];if(!tabs.includes(tab))tab="journey";
  tabs.forEach(t=>{$("#v-"+t).classList.toggle("on",t===tab);document.querySelector('[data-tab="'+t+'"]').classList.toggle("on",t===tab);});
  $("#fab").hidden=tab!=="journey";$("#main").scrollTop=0;
  if(tab==="journey"&&map)setTimeout(()=>frame(false),30);
  if(tab==="rewards")renderRewards();
}
window.addEventListener("hashchange",()=>show(location.hash.slice(1)));
document.addEventListener("click",async e=>{
  if(e.target.id==="scrim"){closeSheet();return;}
  const b=e.target.closest("[data-act]");if(!b||b.disabled)return;
  const a=b.dataset.act;
  if(a==="log")rideSheet();
  else if(a==="close")closeSheet();
  else if(a==="edit"){const r=S.rides.find(x=>x.id===b.dataset.id);if(r)rideSheet(r);}
  else if(a==="del"){const id=b.dataset.id;change(()=>{S.rides=S.rides.filter(r=>r.id!==id);},"Ride deleted");}
  else if(a==="undo"){if(undoSnap){const now=JSON.stringify(S.rides);S.rides=JSON.parse(undoSnap);undoSnap=now;$("#toast").hidden=true;persist();renderAll();toast("Change undone");}}
  else if(a==="city")citySheet(b.dataset.n);
  else if(a==="recipe")recipeSheet(b.dataset.id);
  else if(a==="rectab"){recTab=b.dataset.t;renderRecipes();}
  else if(a==="fav"){const id=b.dataset.id,i=S.favs.indexOf(id);if(i>=0)S.favs.splice(i,1);else S.favs.push(id);persist();renderRecipes();recipeSheet(id);}
  else if(a==="goal"){S.settings.goal=b.dataset.g;if(b.dataset.g==="custom"&&!S.settings.goalDate)S.settings.goalDate=stats().goalDate;persist();renderJourney();renderProfile();}
  else if(a==="enter")closeLanding();
  else if(a==="enter-plan"){closeLanding();location.hash="profile";show("profile");plan.result=null;setTimeout(planSheet,350);}
  else if(a==="theme"){S.settings.theme=b.dataset.t;applyTheme();persist();renderProfile();}
  else if(a==="csv")exportFile("long-way-home-rides.csv",toCSV());
  else if(a==="json")exportFile("long-way-home-backup.json",toJSON());
  else if(a==="restore")$("#restore-file").click();
  else if(a==="journey")journeySheet(b.dataset.id);
  else if(a==="switch"){closeSheet();await activate(b.dataset.id);checkMilestones(true);persist();renderAll();toast("Journey switched");}
  else if(a==="jdel"){const id=b.dataset.id;
    if(b.dataset.sure!=="1"){b.dataset.sure="1";b.textContent="Tap again to delete for good";return;}
    S.rides=S.rides.filter(r=>(r.j||"penang")!==id);S.journeys=S.journeys.filter(j=>j.id!==id);delete S.jstate[id];delete ROUTES[id];persistRoute(id,true);
    closeSheet();if(RT.id===id)await activate("penang",true);persist();renderAll();toast("Journey deleted");}
  else if(a==="plan"){plan.result=null;planSheet();}
  else if(a==="pfield"){plan.field=b.dataset.f;planSheet();const q=$("#p-q");if(q)q.focus();}
  else if(a==="ppick"){const p=plan.hits&&plan.hits[+b.dataset.i];if(p){plan[plan.field]=p;if(plan.field==="from"&&!plan.to)plan.field="to";planSheet();}}
  else if(a==="pgo")planGo();
  else if(a==="pstart")planStart();
});
document.addEventListener("input",e=>{if(e.target.id==="p-q")planResults();});
document.addEventListener("submit",e=>{e.preventDefault();if(e.target.id==="ride-form")submitRide();});
document.addEventListener("change",e=>{
  const t=e.target,s=S.settings;
  if(t.id==="g-date"&&t.value){s.goalDate=t.value;}
  else if(t.id==="g-speed"){const v=parseFloat(t.value);if(v>=5&&v<=40)s.speed=Math.round(v*10)/10;}
  else if(t.id==="g-days"){const v=parseInt(t.value,10);if(v>=1&&v<=7)s.days=v;}
  else if(t.id==="restore-file"){const f=t.files&&t.files[0];if(f){const rd=new FileReader();rd.onload=()=>restoreFrom(String(rd.result));rd.readAsText(f);}t.value="";return;}
  else return;
  persist();renderJourney();renderProfile();
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#scrim").hidden)closeSheet();});

if(window.claude&&window.claude.use)window.claude.use("sample").then(s=>{SAMPLE=s||null;if(s)renderRecipes();}).catch(()=>{});
window.LWH={get TOTAL(){return TOTAL;},get STOPS(){return STOPS;},get RT(){return RT;},posAt,countryAt,stats,planRoute,loadNet,get state(){return S;},get ROUTES(){return ROUTES;},loadElev,elevAt:(a,b)=>elevAt(a,b),profile:()=>profile(),ensureProfile,setSample(s){SAMPLE=s;},nameDishes};
if(STANDALONE&&"serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
initMap();
show(location.hash.slice(1));
landingText();drawLanding();
loadElev().then(()=>drawLanding()).catch(()=>{});
window.addEventListener("resize",()=>{if(landingOpen)drawLanding();});
initStore();
})();
