/* ====================================================================
   airport25d.js — 김포공항 국제선 2.5D 멀티플로어 길찾기 (재사용 라이브러리)

   다른 웹앱에서 함수로 호출:
     const map = AirportMap25D.create({ container, data:AIRPORT_DATA, options });
     map.showRoute({ deskFloor:'1F', deskSide:'S', dest:{floor:'4F', name:'유아휴게실'} });
     map.clearRoute();

   렌더 개념
   - 4개 층을 하나의 화면에 분리 적층(exploded isometric)으로 통합 표시.
   - 각 층은 SVG 도면을 래스터화해 만든 마스크로 재구성:
       · 바닥 슬래브 = 건물 footprint를 아래로 압출(두께) → 형태 입체감
       · 벽(#000) = 마스크를 위로 offset 복제 적층 → 수직 압출 직육면체
       · 보안구역(하늘색) = 색·경계로 구분
   - 색은 무채색(흰/연회색) 위주, 층 식별은 라벨 칩 색으로만.
   - 시설 아이콘은 평면(빌보드 3D 아님). 경로 표시 중에는 ESC/ELEV 외 시설은 숨김.
   - 좌표는 고정 논리 크기에 그려지고 CSS로 균일 스케일 → 축소해도 위치 불변.

   길찾기: 벽/보안구역 회피 직교 A* + transit_groups 멀티플로어 그래프 (검증된 로직 재사용).
   ==================================================================== */
(function (global) {
"use strict";

const FLOORS = ['1F', '2F', '3F', '4F'];
const NS = "http://www.w3.org/2000/svg";

/* ---------- 조절 상수 ---------- */
const DEFAULTS = {
  wallHeight: 22,        // 벽 압출 높이(논리 px) — 요구사항: 상수로 조절
  plateThickness: 13,    // 바닥 슬래브 두께
  isoRot: 27 * Math.PI / 180,
  isoKy: 0.5,            // 세로 압축(아이소 틸트)
  renderScale: 0.6,      // 도면 래스터 해상도 배율(메모리/속도)
  gap: null,             // 층 간격(null이면 자동)
  pad: 70,
  metersPerUnit: 0.075,  // 거리 추정(축척 보정 필요)
  walkMps: 1.2,
};

/* ---------- 색 (무채색 + 최소 강조) ---------- */
const COL = {
  bg:        '#0e1217',
  plateTop:  '#eef1f4',  // 일반 바닥(흰/연회색)
  plateSec:  '#cfe4f3',  // 보안구역(하늘색)
  secBorder: '#5aa0cf',
  slabSide:  '#aeb7c0',  // 슬래브 측면(두께)
  wallTop:   '#9aa4af',  // 벽 윗면
  wallSide:  '#646e79',  // 벽 측면(어두움)
  route:     '#ff7a55',
  routeGlow: 'rgba(255,122,85,0.22)',
  start:     '#8b7cf0',
  dest:      '#ff5a3c',
  node:      '#2f6fb0',  // ESC/ELEV
  text:      '#dfe4e9',
  textMut:   '#9aa3ac',
  chip: { '1F':'#c98a2b', '2F':'#3b82d6', '3F':'#2aa37a', '4F':'#8b5cf6' },
};
const FLOOR_KR = { '1F':'1F 입국', '2F':'2F 출국', '3F':'3F 탑승', '4F':'4F 라운지' };

/* ---------- 기하 유틸 ---------- */
function pip(x, y, poly){let c=false,n=poly.length,j=n-1;
  for(let i=0;i<n;i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
    if(((yi>y)!=(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))c=!c;j=i;}return c;}
function E(n,a){const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);return e;}
function dist(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1]);}

/* ---------- 도면 SVG 가공 ---------- */
function ensureSize(svg,W,H){return /<svg[^>]*\bwidth=/.test(svg)?svg:svg.replace(/<svg/i,`<svg width="${W}" height="${H}"`);}
function svgToImg(svgStr){return new Promise((res,rej)=>{const img=new Image();
  img.onload=()=>res(img);img.onerror=rej;
  img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svgStr);});}

/* ====================================================================
   힙 + 직교 A* + 연결요소 스냅 (검증된 로직)
   ==================================================================== */
class Heap{constructor(){this.a=[];}get size(){return this.a.length;}
  push(p,v){const a=this.a;a.push([p,v]);let i=a.length-1;
    while(i>0){const q=(i-1)>>1;if(a[q][0]<=a[i][0])break;const t=a[q];a[q]=a[i];a[i]=t;i=q;}}
  pop(){const a=this.a,top=a[0],last=a.pop();
    if(a.length){a[0]=last;let i=0,n=a.length;
      while(true){let l=2*i+1,r=l+1,s=i;if(l<n&&a[l][0]<a[s][0])s=l;if(r<n&&a[r][0]<a[s][0])s=r;
        if(s===i)break;const t=a[s];a[s]=a[i];a[i]=t;i=s;}}return top;}}

function snapMain(G,gx,gy){
  const gw=G.gw,gh=G.gh;
  gx=Math.max(0,Math.min(gw-1,gx));gy=Math.max(0,Math.min(gh-1,gy));
  if(G.comp[gy*gw+gx]===G.main)return[gx,gy];
  for(let r=1;r<200;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
    if(Math.abs(dx)!==r&&Math.abs(dy)!==r)continue;
    const nx=gx+dx,ny=gy+dy;if(nx>=0&&ny>=0&&nx<gw&&ny<gh&&G.comp[ny*gw+nx]===G.main)return[nx,ny];}
  for(let r=1;r<200;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
    const nx=gx+dx,ny=gy+dy;if(nx>=0&&ny>=0&&nx<gw&&ny<gh&&!G.blocked[ny*gw+nx])return[nx,ny];}
  return[gx,gy];}

function astar(G,sxv,syv,txv,tyv){
  const gw=G.gw,gh=G.gh,blk=G.blocked;
  const [s0,s1]=snapMain(G,Math.round(sxv*G.sx),Math.round(syv*G.sy));
  const [t0,t1]=snapMain(G,Math.round(txv*G.sx),Math.round(tyv*G.sy));
  const start=s1*gw+s0,goal=t1*gw+t0;
  if(start===goal)return[[sxv,syv],[txv,tyv]];
  const gx2=goal%gw,gy2=(goal/gw)|0;
  const g=new Float64Array(gw*gh).fill(Infinity),came=new Int32Array(gw*gh).fill(-1);
  g[start]=0;const H=new Heap();H.push(Math.abs(s0-gx2)+Math.abs(s1-gy2),start);
  while(H.size){const cur=H.pop()[1];if(cur===goal)break;
    const cx=cur%gw,cy=(cur/gw)|0,cg=g[cur],ng=cg+1;let ni;
    if(cx+1<gw){ni=cur+1;if(!blk[ni]&&ng<g[ni]){g[ni]=ng;came[ni]=cur;H.push(ng+Math.abs(cx+1-gx2)+Math.abs(cy-gy2),ni);}}
    if(cx-1>=0){ni=cur-1;if(!blk[ni]&&ng<g[ni]){g[ni]=ng;came[ni]=cur;H.push(ng+Math.abs(cx-1-gx2)+Math.abs(cy-gy2),ni);}}
    if(cy+1<gh){ni=cur+gw;if(!blk[ni]&&ng<g[ni]){g[ni]=ng;came[ni]=cur;H.push(ng+Math.abs(cx-gx2)+Math.abs(cy+1-gy2),ni);}}
    if(cy-1>=0){ni=cur-gw;if(!blk[ni]&&ng<g[ni]){g[ni]=ng;came[ni]=cur;H.push(ng+Math.abs(cx-gx2)+Math.abs(cy-1-gy2),ni);}}}
  if(came[goal]<0&&goal!==start)return null;
  const path=[];let c=goal;
  while(c>=0){const cx=c%gw,cy=(c/gw)|0;path.push([(cx+0.5)/G.sx,(cy+0.5)/G.sy]);if(c===start)break;c=came[c];}
  path.reverse();path[0]=[sxv,syv];path[path.length-1]=[txv,tyv];return path;}
function simplifyOrtho(p){if(!p||p.length<3)return p;const o=[p[0]];
  for(let i=1;i<p.length-1;i++){const a=p[i-1],b=p[i],c=p[i+1];
    if(Math.sign(b[0]-a[0])!==Math.sign(c[0]-b[0])||Math.sign(b[1]-a[1])!==Math.sign(c[1]-b[1]))o.push(b);}
  o.push(p[p.length-1]);return o;}
function pathLen(p){let L=0;for(let i=1;i<p.length;i++)L+=dist(p[i],p[i-1]);return L;}

/* ====================================================================
   라이브러리 본체
   ==================================================================== */
function create(opts){
  opts = opts || {};
  const data = opts.data || global.AIRPORT_DATA;
  if(!data) throw new Error('AIRPORT_DATA 가 필요합니다 (opts.data 또는 window.AIRPORT_DATA).');
  const container = typeof opts.container==='string' ? document.querySelector(opts.container) : opts.container;
  if(!container) throw new Error('container 가 필요합니다.');
  const O = Object.assign({}, DEFAULTS, opts);
  const ROT=O.isoRot, KY=O.isoKy, RS=O.renderScale, WALL_H=O.wallHeight, THICK=O.plateThickness, PAD=O.pad;
  const A=Math.cos(ROT), B=KY*Math.sin(ROT), C=-Math.sin(ROT), Dd=KY*Math.cos(ROT);
  function isoM(mx,my){return [A*mx+C*my, B*mx+Dd*my];}     // 마스크px → iso

  /* DOM */
  container.innerHTML='';
  const wrap=document.createElement('div');
  wrap.style.cssText='position:relative;width:100%;background:'+COL.bg+';border-radius:12px;overflow:hidden;';
  const cv=document.createElement('canvas'); cv.style.cssText='display:block;width:100%;height:auto;';
  const svg=E('svg',{}); svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;';
  wrap.appendChild(cv); wrap.appendChild(svg); container.appendChild(wrap);
  const ctx=cv.getContext('2d');

  /* 상태 */
  const FL={};                 // floor data: {W,H,mw,mh,masks,grid,minX,minY,w,h,e,f,topY}
  let LOGW=0,LOGH=0,layoutReady=false;
  const listeners={};
  const ST={ route:null, routeActive:false, desk:{floor:'1F',side:'S'}, hover:null };
  const emit=(ev,p)=>{(listeners[ev]||[]).forEach(f=>f(p));};

  /* ---------- 래스터화 + 마스크 + 그리드 ---------- */
  function isSec(r,g,b){return b>=235 && (b-r)>=6 && (b-g)>=1;}   // 하늘색 보안색 검출
  function lumOf(r,g,b){return 0.299*r+0.587*g+0.114*b;}

  async function rasterFloor(fk){
    const fdat=data.floors[fk], W=fdat.viewBox[0], H=fdat.viewBox[1];
    const mw=Math.round(W*RS), mh=Math.round(H*RS);
    const img=await svgToImg(ensureSize(fdat.svg,W,H));
    const src=document.createElement('canvas'); src.width=mw; src.height=mh;
    const sctx=src.getContext('2d',{willReadFrequently:true});
    sctx.clearRect(0,0,mw,mh); sctx.drawImage(img,0,0,mw,mh);
    const px=sctx.getImageData(0,0,mw,mh).data;

    // 4개 마스크 ImageData
    const top=new ImageData(mw,mh), slab=new ImageData(mw,mh), wt=new ImageData(mw,mh), ws=new ImageData(mw,mh);
    const cTop=hex(COL.plateTop), cSec=hex(COL.plateSec), cSlab=hex(COL.slabSide), cWt=hex(COL.wallTop), cWs=hex(COL.wallSide);
    for(let i=0;i<mw*mh;i++){
      const o=i*4, a=px[o+3];
      if(a<40) continue;                               // 건물 밖
      put(slab.data,o,cSlab);                          // 슬래브(footprint 전체)
      const r=px[o],g=px[o+1],b=px[o+2], lum=lumOf(r,g,b);
      if(lum<60){ put(wt.data,o,cWt); put(ws.data,o,cWs); put(top.data,o,cTop); }  // 벽
      else if(isSec(r,g,b)) put(top.data,o,cSec);      // 보안구역
      else put(top.data,o,cTop);                       // 일반 바닥
    }
    const masks={};
    for(const [k,id] of [['top',top],['slab',slab],['wallTop',wt],['wallSide',ws]]){
      const c=document.createElement('canvas');c.width=mw;c.height=mh;c.getContext('2d').putImageData(id,0,0);masks[k]=c;
    }
    // 길찾기 그리드(스트라이드 샘플) — 보안구역은 폴리곤으로 정확히 차단
    const STR=3, gw=Math.max(40,Math.round(mw/STR*1)), gh=Math.max(40,Math.round(mh/STR*1));
    const blocked=new Uint8Array(gw*gh), sx=gw/W, sy=gh/H, secs=fdat.security_polygons||[];
    for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){
      const mx=Math.min(mw-1,Math.round((x+0.5)/gw*mw)), my=Math.min(mh-1,Math.round((y+0.5)/gh*mh)), o=(my*mw+mx)*4;
      let bl=false; if(px[o+3]<40)bl=true; else if(lumOf(px[o],px[o+1],px[o+2])<60)bl=true;
      if(!bl){const vx=(x+0.5)/sx,vy=(y+0.5)/sy;for(const poly of secs){if(pip(vx,vy,poly)){bl=true;break;}}}
      blocked[y*gw+x]=bl?1:0;
    }
    // 연결요소(주 통로)
    const comp=new Int32Array(gw*gh).fill(-1); let lab=0,mainL=-1,mc=0;
    for(let i=0;i<comp.length;i++){if(blocked[i]||comp[i]>=0)continue;let cnt=0;const stk=[i];comp[i]=lab;
      while(stk.length){const c=stk.pop();cnt++;const cx=c%gw,cy=(c/gw)|0;
        if(cx+1<gw){const n=c+1;if(!blocked[n]&&comp[n]<0){comp[n]=lab;stk.push(n);}}
        if(cx-1>=0){const n=c-1;if(!blocked[n]&&comp[n]<0){comp[n]=lab;stk.push(n);}}
        if(cy+1<gh){const n=c+gw;if(!blocked[n]&&comp[n]<0){comp[n]=lab;stk.push(n);}}
        if(cy-1>=0){const n=c-gw;if(!blocked[n]&&comp[n]<0){comp[n]=lab;stk.push(n);}}}
      if(cnt>mc){mc=cnt;mainL=lab;}lab++;}
    FL[fk]={W,H,mw,mh,masks, grid:{gw,gh,blocked,comp,main:mainL,sx,sy}};
  }
  function hex(h){h=h.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
  function put(d,o,c){d[o]=c[0];d[o+1]=c[1];d[o+2]=c[2];d[o+3]=255;}

  /* ---------- 레이아웃 ---------- */
  function computeLayout(){
    let maxW=0,maxH=0;
    FLOORS.forEach((fk)=>{const fl=FL[fk];
      const cs=[[0,0],[fl.mw,0],[0,fl.mh],[fl.mw,fl.mh]].map(p=>isoM(p[0],p[1]));
      let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
      cs.forEach(p=>{minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);});
      fl.minX=minX;fl.minY=minY;fl.w=maxX-minX;fl.h=maxY-minY;
      maxW=Math.max(maxW,fl.w);maxH=Math.max(maxH,fl.h);});
    const GAP=O.gap||(maxH+WALL_H+THICK+44);
    const TOP=PAD+WALL_H, centerX=PAD+maxW/2;
    FLOORS.forEach((fk,i)=>{const fl=FL[fk];
      fl.e=centerX-fl.w/2-fl.minX;
      fl.topY=TOP+(3-i)*GAP;
      fl.f=fl.topY-fl.minY;});
    LOGW=maxW+2*PAD;
    LOGH=FL['1F'].topY+FL['1F'].h+THICK+PAD;
    svg.setAttribute('viewBox',`0 0 ${LOGW.toFixed(1)} ${LOGH.toFixed(1)}`);
    const dpr=Math.min(global.devicePixelRatio||1, 2);
    cv.width=Math.round(LOGW*dpr); cv.height=Math.round(LOGH*dpr); cv._dpr=dpr;
    layoutReady=true;
  }
  // 평면좌표 → 논리 화면좌표 (해당 층 표면)
  function project(fk,planX,planY){const fl=FL[fk];const p=isoM(planX*RS,planY*RS);return [p[0]+fl.e, p[1]+fl.f];}

  /* ---------- 캔버스: 압출 바닥 그리기 ---------- */
  function drawFloors(){
    const dpr=cv._dpr;
    ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,cv.width,cv.height);
    for(let i=3;i>=0;i--){            // 위층(4F) 먼저 → 아래층이 앞에
      const fk=FLOORS[i], fl=FL[fk], m=fl.masks;
      const T=(dy)=>ctx.setTransform(A*dpr,B*dpr,C*dpr,Dd*dpr,fl.e*dpr,(fl.f+dy)*dpr);
      // 그림자(살짝 아래 어둡게)
      ctx.setTransform(A*dpr,B*dpr,C*dpr,Dd*dpr,(fl.e+8)*dpr,(fl.f+THICK+10)*dpr);
      ctx.globalAlpha=0.18; ctx.drawImage(m.slab,0,0); ctx.globalAlpha=1;
      // 슬래브 측면(두께): 깊은 곳부터
      for(let k=THICK;k>=1;k--){T(k);ctx.drawImage(m.slab,0,0);}
      // 바닥 윗면
      T(0); ctx.drawImage(m.top,0,0);
      // 벽 압출(위로): 측면 적층 후 윗면
      for(let k=0;k<WALL_H;k++){T(-k);ctx.drawImage(m.wallSide,0,0);}
      T(-WALL_H); ctx.drawImage(m.wallTop,0,0);
    }
    ctx.setTransform(1,0,0,1,0,0);
  }

  /* ---------- 시설/노드 추출 ---------- */
  function facilitiesOf(fk){return (data.facilities[fk]||[]).map((f,idx)=>({...f,floor:fk,idx}));}
  function vnodesOf(fk){return (data.vertical_nodes[fk]||[]).filter(n=>n.type!=='STAIR');}
  function iconURL(pSeq){const g=data.pseq_icon_groups[pSeq];return g&&g.svg?('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(g.svg)):null;}

  /* ---------- 멀티플로어 그래프 ---------- */
  const GROUPS=data.floor_links.transit_groups;
  function nodeById(id){const fk=id.split('-')[0];
    for(const n of data.vertical_nodes[fk])if(n.id===id){const o={...n};if(id==='2F-ESC-3')o.y=447.0;return o;}return null;}
  const ADJ={'1F':new Set(),'2F':new Set(),'3F':new Set(),'4F':new Set()}, PAIRG={};
  for(const g of GROUPS)for(const a of g.connects)for(const b of g.connects){if(a===b)continue;
    const na=g.nodes.find(id=>id.startsWith(a)),nb=g.nodes.find(id=>id.startsWith(b));
    if(na&&nb){ADJ[a].add(b);(PAIRG[a+'>'+b]=PAIRG[a+'>'+b]||[]).push(g);}}
  function floorSeq(a,b){if(a===b)return[a];const prev={[a]:null},q=[a];
    while(q.length){const c=q.shift();if(c===b)break;for(const nb of[...ADJ[c]].sort())if(!(nb in prev)){prev[nb]=c;q.push(nb);}}
    if(!(b in prev))return null;const s=[];let c=b;while(c!==null){s.push(c);c=prev[c];}return s.reverse();}

  const SIDE_OFF=46;
  function deskStart(fk,side){const dk=data.guide_desks[fk];const[x,y]=dk.svg;
    const off={N:[0,-SIDE_OFF],S:[0,SIDE_OFF],E:[SIDE_OFF,0],W:[-SIDE_OFF,0]}[side]||[0,SIDE_OFF];
    return {desk:[x,y],start:[x+off[0],y+off[1]]};}

  function computeRoute(deskFloor,deskSide,dest){
    const seq=floorSeq(deskFloor,dest.floor); if(!seq)return{error:'층간 연결 경로 없음'};
    const{desk,start}=deskStart(deskFloor,deskSide);
    const legs=[];let cur=start,curFloor=deskFloor;
    for(let i=0;i<seq.length-1;i++){const Aa=seq[i],Bb=seq[i+1];const cands=PAIRG[Aa+'>'+Bb]||[];
      let bg=null,bp=null,bl=1e18,bnA=null,bnB=null;
      for(const g of cands){const na=nodeById(g.nodes.find(id=>id.startsWith(Aa))),nb=nodeById(g.nodes.find(id=>id.startsWith(Bb)));
        if(!na||!nb)continue;const p=astar(FL[curFloor].grid,cur[0],cur[1],na.x,na.y);if(!p)continue;
        const L=pathLen(p);if(L<bl){bl=L;bg=g;bp=p;bnA=na;bnB=nb;}}
      if(!bg)return{error:`${Aa}→${Bb} 환승 지점 도달 불가`};
      legs.push({floor:Aa,pts:simplifyOrtho(bp),desk:(i===0?desk:null),exitTo:{node:bnA,transit:bg,toFloor:Bb},enterAt:(i>0?cur:null)});
      cur=[bnB.x,bnB.y];curFloor=Bb;}
    const p=astar(FL[curFloor].grid,cur[0],cur[1],dest.x,dest.y);
    if(!p)return{error:'목적지 경로 없음'};
    legs.push({floor:curFloor,pts:simplifyOrtho(p),desk:(seq.length===1?desk:null),enterAt:(seq.length>1?cur:null),arrive:dest});
    return {legs,seq,totalLen:legs.reduce((s,l)=>s+pathLen(l.pts),0)};
  }

  /* ---------- SVG 오버레이 ---------- */
  let dotRAF=null;
  function clearLayer(){ if(dotRAF)cancelAnimationFrame(dotRAF); svg.innerHTML=''; }

  function renderOverlay(){
    clearLayer();
    const defs=E('defs',{});
    defs.innerHTML='<marker id="a25-arr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L8 5L1 9" fill="none" stroke="'+COL.route+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></marker>';
    svg.appendChild(defs);

    // 층 라벨 칩 + 보안구역 경계
    FLOORS.forEach((fk)=>{
      const fl=FL[fk];
      // 칩: 층의 왼쪽 꼭짓점 근처
      const left=project(fk, 0, fl.H*0.5);
      chip(left[0]-96, left[1]-14, FLOOR_KR[fk], COL.chip[fk]);
      // 보안구역 경계(경계+색으로 구분)
      (data.floors[fk].security_polygons||[]).forEach(poly=>{
        const pts=poly.map(p=>{const s=project(fk,p[0],p[1]);return s[0].toFixed(1)+','+s[1].toFixed(1);}).join(' ');
        svg.appendChild(E('polygon',{points:pts,fill:'none',stroke:COL.secBorder,'stroke-width':1.4,'stroke-dasharray':'5 4','stroke-opacity':0.9}));
      });
    });

    const showAllFac = !ST.routeActive;
    // 시설 핀 (평면). 경로중에는 ESC/ELEV만.
    FLOORS.forEach((fk)=>{
      vnodesOf(fk).forEach(n=>pinNode(fk,n));         // ESC/ELEV 항상
      if(showAllFac) facilitiesOf(fk).forEach(f=>{ if(f.in_secure)return; pinFacility(fk,f); });
    });

    if(ST.routeActive && ST.route && ST.route.legs) drawRoute(ST.route);
  }

  function chip(x,y,label,color){
    const g=E('g',{});
    g.appendChild(E('rect',{x:x,y:y,rx:13,width:92,height:27,fill:'rgba(20,26,33,0.85)',stroke:color,'stroke-width':1.4}));
    const t=E('text',{x:x+46,y:y+18,'text-anchor':'middle','font-size':13,'font-family':'system-ui,sans-serif','font-weight':600,fill:color});
    t.textContent=label; g.appendChild(t); svg.appendChild(g);
  }
  function pinFacility(fk,f){
    const [px,py]=project(fk,f.x,f.y);
    const g=E('g',{class:'a25-pin',style:'cursor:pointer'});
    g.appendChild(E('circle',{cx:px,cy:py,r:8.5,fill:'#fff',stroke:'#b6c0c9','stroke-width':1.2}));
    const url=iconURL(f.pSeq);
    if(url)g.appendChild(E('image',{href:url,'xlink:href':url,x:px-7,y:py-7,width:14,height:14}));
    g.addEventListener('click',()=>{ emit('facilityClick',f); api.showRoute({deskFloor:ST.desk.floor,deskSide:ST.desk.side,dest:f}); });
    g.addEventListener('mouseenter',ev=>hoverShow(ev,f.name));
    g.addEventListener('mousemove',hoverMove); g.addEventListener('mouseleave',hoverHide);
    svg.appendChild(g);
  }
  function pinNode(fk,n){
    const [px,py]=project(fk,n.x,n.y);
    const isElev=n.type==='ELEV';
    const g=E('g',{style:'cursor:default'});
    g.appendChild(E('rect',{x:px-8,y:py-8,width:16,height:16,rx:3,fill:'#fff',stroke:COL.node,'stroke-width':1.6}));
    const url=iconURL(isElev?'12':'11');
    if(url)g.appendChild(E('image',{href:url,'xlink:href':url,x:px-7,y:py-7,width:14,height:14}));
    g.addEventListener('mouseenter',ev=>hoverShow(ev,n.kr));
    g.addEventListener('mousemove',hoverMove); g.addEventListener('mouseleave',hoverHide);
    svg.appendChild(g);
  }

  function drawRoute(r){
    const allPts=[];   // 애니메이션용 전체 경로(화면좌표)
    r.legs.forEach((leg,li)=>{
      const scr=leg.pts.map(p=>project(leg.floor,p[0],p[1]));
      const dStr="M"+scr.map(q=>q[0].toFixed(1)+" "+q[1].toFixed(1)).join(" L ");
      svg.appendChild(E('path',{d:dStr,fill:'none',stroke:COL.routeGlow,'stroke-width':13,'stroke-linecap':'round','stroke-linejoin':'round'}));
      svg.appendChild(E('path',{d:dStr,fill:'none',stroke:COL.route,'stroke-width':5,'stroke-linecap':'round','stroke-linejoin':'round'}));
      allPts.push(...scr);
      // 환승 라이저(다음 층 진입점으로 상승)
      if(leg.exitTo){
        const from=project(leg.floor, leg.exitTo.node.x, leg.exitTo.node.y);
        const nb=leg.exitTo.transit.nodes.find(id=>id.startsWith(leg.exitTo.toFloor));
        const ndB=nodeById(nb);
        const to=project(leg.exitTo.toFloor, ndB.x, ndB.y);
        svg.appendChild(E('path',{d:`M${from[0]} ${from[1]} L${to[0]} ${to[1]}`,fill:'none',stroke:COL.route,'stroke-width':4,'stroke-dasharray':'7 6','stroke-linecap':'round','marker-end':'url(#a25-arr)'}));
        allPts.push(to);
        const kind=leg.exitTo.transit.type==='elevator'?'엘리베이터':'에스컬레이터';
        const mid=[(from[0]+to[0])/2+10,(from[1]+to[1])/2];
        label(mid[0],mid[1],'▲ '+leg.exitTo.toFloor+' '+kind, COL.route);
      }
    });
    // 출발(안내데스크)
    const dl=r.legs[0]; if(dl.desk){const d=project(dl.floor,dl.desk[0],dl.desk[1]);
      svg.appendChild(E('circle',{cx:d[0],cy:d[1],r:7,fill:COL.start,stroke:'#fff','stroke-width':2}));
      label(d[0],d[1]-16,'안내데스크',COL.start,true);}
    // 도착
    const last=r.legs[r.legs.length-1], dst=last.arrive;
    if(dst){const e=project(last.floor,dst.x,dst.y);
      const ring=E('circle',{cx:e[0],cy:e[1],r:8,fill:'none',stroke:COL.dest,'stroke-width':2});
      ring.innerHTML='<animate attributeName="r" values="8;16;8" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0;0.9" dur="2s" repeatCount="indefinite"/>';
      svg.appendChild(ring);
      svg.appendChild(E('circle',{cx:e[0],cy:e[1],r:7,fill:COL.dest,stroke:'#fff','stroke-width':2}));
      label(e[0],e[1]-16,dst.name,COL.dest,true);}
    // 이동 점
    if(allPts.length>1) animateDot(allPts);
  }
  function label(x,y,txt,color,strong){
    const t=E('text',{x:x,y:y,'text-anchor':'middle','font-size':strong?13:12,'font-family':'system-ui,sans-serif','font-weight':strong?700:500,fill:color,'paint-order':'stroke',stroke:COL.bg,'stroke-width':3.5,'stroke-linejoin':'round'});
    t.textContent=txt; svg.appendChild(t);
  }
  function animateDot(pts){
    const dot=E('circle',{r:6,fill:COL.route,stroke:'#fff','stroke-width':2});
    const glow=E('circle',{r:10,fill:COL.route,opacity:0.28}); svg.appendChild(glow); svg.appendChild(dot);
    const seg=[];let tot=0;for(let i=1;i<pts.length;i++){const L=dist(pts[i],pts[i-1]);seg.push(L);tot+=L;}
    const DUR=Math.min(9000,Math.max(3500,tot*5)),HOLD=1400,CY=DUR+HOLD;let t0=null;
    function fr(t){if(t0===null)t0=t;const e=(t-t0)%CY,p=e<DUR?e/DUR:1;
      let tr=p*tot,acc=0,i=0;while(i<seg.length-1&&acc+seg[i]<tr){acc+=seg[i];i++;}
      const f=seg[i]?(tr-acc)/seg[i]:0,x=pts[i][0]+(pts[i+1][0]-pts[i][0])*f,y=pts[i][1]+(pts[i+1][1]-pts[i][1])*f;
      dot.setAttribute('cx',x.toFixed(1));dot.setAttribute('cy',y.toFixed(1));glow.setAttribute('cx',x.toFixed(1));glow.setAttribute('cy',y.toFixed(1));
      dotRAF=requestAnimationFrame(fr);}
    dotRAF=requestAnimationFrame(fr);
  }

  /* 호버 라벨 */
  let hov=null;
  function hoverEl(){if(!hov){hov=document.createElement('div');
    hov.style.cssText='position:absolute;z-index:9;pointer-events:none;background:rgba(15,19,24,.94);color:#fff;font:12px system-ui;padding:3px 8px;border-radius:6px;transform:translate(-50%,-150%);display:none;';
    wrap.appendChild(hov);}return hov;}
  function hoverShow(ev,t){const h=hoverEl();h.textContent=t;h.style.display='block';hoverMove(ev);}
  function hoverMove(ev){const h=hoverEl(),b=wrap.getBoundingClientRect();h.style.left=(ev.clientX-b.left)+'px';h.style.top=(ev.clientY-b.top)+'px';}
  function hoverHide(){if(hov)hov.style.display='none';}

  /* ---------- 공개 API ---------- */
  const api={
    el: wrap,
    isReady(){return layoutReady;},
    listFacilities(){const o=[];FLOORS.forEach(fk=>facilitiesOf(fk).forEach(f=>o.push(f)));return o;},
    setDesk(floor,side){ST.desk.floor=floor||ST.desk.floor;ST.desk.side=side||ST.desk.side;if(ST.routeActive&&ST.route&&ST.route._dest)api.showRoute({deskFloor:ST.desk.floor,deskSide:ST.desk.side,dest:ST.route._dest});},
    getRoute(){return ST.route;},
    on(ev,cb){(listeners[ev]=listeners[ev]||[]).push(cb);return api;},
    // 핵심 호출 함수: 목적지까지 경로 표시 (다른 시설은 숨김)
    showRoute(spec){
      spec=spec||{};
      const deskFloor=spec.deskFloor||ST.desk.floor, deskSide=spec.deskSide||ST.desk.side;
      ST.desk.floor=deskFloor; ST.desk.side=deskSide;
      let dest=spec.dest;
      if(dest && dest.floor && dest.x==null && dest.name){            // 이름으로 찾기
        dest=facilitiesOf(dest.floor).find(f=>f.name===dest.name && !f.in_secure) || dest;
      }
      if(!dest || dest.x==null){ return {error:'목적지를 찾을 수 없음'}; }
      const r=computeRoute(deskFloor,deskSide,dest); r._dest=dest;
      ST.route=r; ST.routeActive=!r.error;
      renderOverlay();
      if(!r.error){
        const m=Math.round(r.totalLen*O.metersPerUnit), min=Math.max(1,Math.round(r.totalLen*O.metersPerUnit/O.walkMps/60));
        r.summary={dest:dest.name,floor:dest.floor,meters:m,minutes:min,transfers:r.legs.filter(l=>l.exitTo).length,
          steps:[`${deskFloor} 안내데스크 출발 (${({N:'북',S:'남',E:'동',W:'서'})[deskSide]}쪽)`,
                 ...r.legs.filter(l=>l.exitTo).map(l=>`${l.floor} → ${l.exitTo.toFloor} : ${l.exitTo.transit.type==='elevator'?'엘리베이터':'에스컬레이터'} (${l.exitTo.transit.id})`),
                 `${dest.floor} ${dest.name} 도착`]};
      }
      emit('route',r); return r;
    },
    clearRoute(){ST.routeActive=false;ST.route=null;renderOverlay();emit('route',null);},
    redraw(){drawFloors();renderOverlay();},
    destroy(){if(dotRAF)cancelAnimationFrame(dotRAF);container.innerHTML='';},
  };

  /* ---------- 초기화 ---------- */
  (async function init(){
    for(const fk of FLOORS){ try{await rasterFloor(fk);}catch(e){console.error('raster fail',fk,e);} }
    computeLayout();
    drawFloors();
    renderOverlay();
    emit('ready',api);
    if(typeof O.onReady==='function')O.onReady(api);
  })();

  return api;
}

global.AirportMap25D = { create };
})(window);
