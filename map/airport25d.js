/* ====================================================================
   airport25d.js — 김포공항 국제선 2.5D 멀티플로어 길찾기 (재사용 라이브러리)

   호출:
     const map = AirportMap25D.create({ container, data:AIRPORT_DATA, options });
     map.showRoute({ deskFloor:'1F', deskSide:'S', dest:{floor:'4F', name:'유아휴게실'} });
     map.clearRoute();

   렌더
   - 4개 층을 하나의 화면에 분리 적층(겹치지 않는 최소 간격 = 실제 층고 느낌).
   - 각 층은 도면 SVG 래스터화 마스크로 재구성: 바닥 footprint 아래 압출(슬래브 두께),
     내부 벽(#000)만 위로 offset 적층 → 수직 압출. 외곽(건물 경계) 벽은 제거.
   - 무채색(흰/연회색). 보안구역은 하늘색 채움(색)으로만 구분(점선 경계 없음).
   - 시설 아이콘은 평소 전부 숨김. 경로 표시 시: 출발/목적지 = 현위치 핀,
     경유 에스컬레이터/엘리베이터만 입체 그래픽 + 아이콘(래퍼 없음).
   - 에스컬레이터는 transit_groups(확정 매핑)에서만, 평면 방향(ESC_DIR) 기준.
   - 층별 축척/위치는 floorCalib 로 수동 보정.
   ==================================================================== */
(function (global) {
"use strict";

const FLOORS = ['1F', '2F', '3F', '4F'];
const NS = "http://www.w3.org/2000/svg";

/* ---------- 조절 상수 ---------- */
const DEFAULTS = {
  wallHeight: 16,        // 경계벽 압출 높이(논리 px)
  wallOpacity: 0.45,     // 벽 반투명도
  plateThickness: 10,    // 바닥 슬래브 두께
  isoRot: 27 * Math.PI / 180,
  isoKy: 0.5,            // 세로 압축(아이소 틸트)
  renderScale: 0.6,      // 도면 래스터 해상도 배율
  gap: null,             // 층 간격(null=자동: 겹치지 않는 최소)
  gapMargin: 14,         // 자동 간격 여유
  floorGaps: null,       // [1F-2F, 2F-3F, 3F-4F] 간격(px). null=자동. 숫자=균일. 작게 주면 겹침 허용
  pad: 64,
  wallEdgeErode: 6,      // 외곽 벽 제거 두께(마스크 px). 클수록 더 깎임
  metersPerUnit: 0.075,
  walkMps: 1.2,
  lang: 'ko',            // 목적지 텍스트 언어(기본 한글). 데이터에 name_<lang> 있으면 사용
  // 층별 수동 보정: 보정좌표 = 원래좌표 * s + (dx,dy)  (원본 SVG 단위)
  floorCalib: { '1F':{s:1,dx:0,dy:0}, '2F':{s:1,dx:0,dy:0}, '3F':{s:1,dx:0,dy:0}, '4F':{s:1,dx:0,dy:0} },
};

/* ---------- 색 (무채색 + 최소 강조) ---------- */
const COL = {
  bg:        '#0e1217',
  plateTop:  '#eef1f4',
  plateSec:  '#cfe4f3',   // 보안구역(하늘색 채움)
  slabSide:  '#b3bcc5',
  wallTop:   '#c6ccd2',   // 내부 벽 윗면(연한 회색)
  wallSide:  '#a1a9b2',   // 내부 벽 측면
  route:     '#3da5ff',   // 이동 경로(밝은 파랑) 동그란 점선
  start:     '#f2c200',   // 출발 큐브(노랑)
  startTop:  '#ffd633', startSideA:'#d6a900', startSideB:'#b88f00',
  dest:      '#ff5a3c',
  text:      '#dfe4e9',
  chip:      { '1F':'#c98a2b', '2F':'#3b82d6', '3F':'#2aa37a', '4F':'#8b5cf6' },
};
const FLOOR_KR = { '1F':'1F', '2F':'2F', '3F':'3F', '4F':'4F' };
// 평면도 기준 에스컬레이터 진행 방향(요구사항 매핑 노트)
const ESC_DIR = { 'ESC-A':'E', 'ESC-B':'W', 'ESC-C':'N', 'ESC-D':'N', 'ESC-E':'E' };

/* ---------- 유틸 ---------- */
function pip(x, y, poly){let c=false,n=poly.length,j=n-1;
  for(let i=0;i<n;i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
    if(((yi>y)!=(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))c=!c;j=i;}return c;}
function E(n,a){const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);return e;}
function dist(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1]);}
function lerp(a,b,t){return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];}
function ensureSize(svg,W,H){return /<svg[^>]*\bwidth=/.test(svg)?svg:svg.replace(/<svg/i,`<svg width="${W}" height="${H}"`);}
function svgToImg(s){return new Promise((res,rej)=>{const img=new Image();img.onload=()=>res(img);img.onerror=rej;
  img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s);});}
function hex(h){h=h.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
function put(d,o,c){d[o]=c[0];d[o+1]=c[1];d[o+2]=c[2];d[o+3]=255;}

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
function snapMain(G,gx,gy){const gw=G.gw,gh=G.gh;
  gx=Math.max(0,Math.min(gw-1,gx));gy=Math.max(0,Math.min(gh-1,gy));
  if(G.comp[gy*gw+gx]===G.main)return[gx,gy];
  for(let r=1;r<200;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
    if(Math.abs(dx)!==r&&Math.abs(dy)!==r)continue;
    const nx=gx+dx,ny=gy+dy;if(nx>=0&&ny>=0&&nx<gw&&ny<gh&&G.comp[ny*gw+nx]===G.main)return[nx,ny];}
  for(let r=1;r<200;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
    const nx=gx+dx,ny=gy+dy;if(nx>=0&&ny>=0&&nx<gw&&ny<gh&&!G.blocked[ny*gw+nx])return[nx,ny];}
  return[gx,gy];}
function astar(G,sxv,syv,txv,tyv){const gw=G.gw,gh=G.gh,blk=G.blocked;
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
  const path=[];let c=goal;while(c>=0){const cx=c%gw,cy=(c/gw)|0;path.push([(cx+0.5)/G.sx,(cy+0.5)/G.sy]);if(c===start)break;c=came[c];}
  path.reverse();path[0]=[sxv,syv];path[path.length-1]=[txv,tyv];return path;}
function simplifyOrtho(p){if(!p||p.length<3)return p;const o=[p[0]];
  for(let i=1;i<p.length-1;i++){const a=p[i-1],b=p[i],c=p[i+1];
    if(Math.sign(b[0]-a[0])!==Math.sign(c[0]-b[0])||Math.sign(b[1]-a[1])!==Math.sign(c[1]-b[1]))o.push(b);}
  o.push(p[p.length-1]);return o;}
function pathLen(p){let L=0;for(let i=1;i<p.length;i++)L+=dist(p[i],p[i-1]);return L;}
// 꺾임 최소화: 직선 또는 1회 꺾는(L) 구간으로 최대한 멀리 이어 staircase 제거
function cellFree(G,gx,gy){return gx>=0&&gy>=0&&gx<G.gw&&gy<G.gh&&!G.blocked[gy*G.gw+gx];}
function walkableSeg(G,a,b){
  const x0=Math.round(a[0]*G.sx),y0=Math.round(a[1]*G.sy),x1=Math.round(b[0]*G.sx),y1=Math.round(b[1]*G.sy);
  if(x0===x1){const s=Math.sign(y1-y0)||1;for(let y=y0;;y+=s){if(!cellFree(G,x0,y))return false;if(y===y1)break;}return true;}
  if(y0===y1){const s=Math.sign(x1-x0)||1;for(let x=x0;;x+=s){if(!cellFree(G,x,y0))return false;if(x===x1)break;}return true;}
  return false;}
function reduceBendsOnce(G,pts){
  if(!pts||pts.length<3)return pts;
  const out=[pts[0]];let i=0;
  while(i<pts.length-1){let bestJ=i+1,corner=null;
    for(let j=pts.length-1;j>i+1;j--){
      if((pts[i][0]===pts[j][0]||pts[i][1]===pts[j][1])&&walkableSeg(G,pts[i],pts[j])){bestJ=j;corner=null;break;}
      const c1=[pts[j][0],pts[i][1]],c2=[pts[i][0],pts[j][1]];
      if(walkableSeg(G,pts[i],c1)&&walkableSeg(G,c1,pts[j])){bestJ=j;corner=c1;break;}
      if(walkableSeg(G,pts[i],c2)&&walkableSeg(G,c2,pts[j])){bestJ=j;corner=c2;break;}}
    if(corner)out.push(corner);
    out.push(pts[bestJ]);i=bestJ;}
  return out;}
function reduceBends(G,path){
  let cur=path;
  for(let k=0;k<5;k++){const nx=reduceBendsOnce(G,cur);if(nx.length>=cur.length){cur=nx;break;}cur=nx;}
  return cur;}

/* ====================================================================
   라이브러리 본체
   ==================================================================== */
function create(opts){
  opts=opts||{};
  const data=opts.data||global.AIRPORT_DATA;
  if(!data) throw new Error('AIRPORT_DATA 필요 (opts.data 또는 window.AIRPORT_DATA)');
  const container=typeof opts.container==='string'?document.querySelector(opts.container):opts.container;
  if(!container) throw new Error('container 필요');
  const O=Object.assign({},DEFAULTS,opts);
  if(opts.floorCalib) O.floorCalib=Object.assign({}, DEFAULTS.floorCalib, opts.floorCalib);
  const ROT=O.isoRot,KY=O.isoKy,RS=O.renderScale,WALL_H=O.wallHeight,THICK=O.plateThickness,PAD=O.pad;
  const A=Math.cos(ROT),B=KY*Math.sin(ROT),C=-Math.sin(ROT),Dd=KY*Math.cos(ROT);

  /* DOM */
  container.innerHTML='';
  const wrap=document.createElement('div');
  wrap.style.cssText='position:relative;width:100%;background:'+COL.bg+';border-radius:12px;overflow:hidden;';
  const cv=document.createElement('canvas');cv.style.cssText='display:block;width:100%;height:auto;';
  const svg=E('svg',{});svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  wrap.appendChild(cv);wrap.appendChild(svg);container.appendChild(wrap);
  const ctx=cv.getContext('2d');

  const FL={};
  let LOGW=0,LOGH=0,layoutReady=false,usedGaps={};
  const listeners={};
  const ST={route:null,routeActive:false,desk:{floor:'1F',side:'S'}};
  const emit=(ev,p)=>{(listeners[ev]||[]).forEach(f=>f(p));};

  /* ---------- 래스터화 + 마스크(외곽 벽 제거) + 그리드 ---------- */
  function isSec(r,g,b){return b>=235&&(b-r)>=6&&(b-g)>=1;}
  function lumOf(r,g,b){return 0.299*r+0.587*g+0.114*b;}

  async function rasterFloor(fk){
    const fdat=data.floors[fk],W=fdat.viewBox[0],H=fdat.viewBox[1];
    const mw=Math.round(W*RS),mh=Math.round(H*RS);
    const img=await svgToImg(ensureSize(fdat.svg,W,H));
    const src=document.createElement('canvas');src.width=mw;src.height=mh;
    const sctx=src.getContext('2d',{willReadFrequently:true});
    sctx.clearRect(0,0,mw,mh);sctx.drawImage(img,0,0,mw,mh);
    const px=sctx.getImageData(0,0,mw,mh).data;

    // 1차 판정
    // inside 판정
    const inside=new Uint8Array(mw*mh);
    for(let i=0;i<mw*mh;i++){if(px[i*4+3]>=40)inside[i]=1;}
    // 보안구역 = security_polygons 를 채워 solid 로 판정(내부 흰 섬에 의한 내부 경계 방지)
    const secPolys=fdat.security_polygons||[];
    const secCv=document.createElement('canvas');secCv.width=mw;secCv.height=mh;
    const sx2=secCv.getContext('2d');sx2.fillStyle='#fff';
    secPolys.forEach(poly=>{sx2.beginPath();poly.forEach((p,k)=>{const X=p[0]*RS,Y=p[1]*RS;if(k)sx2.lineTo(X,Y);else sx2.moveTo(X,Y);});sx2.closePath();sx2.fill();});
    const sd=sx2.getImageData(0,0,mw,mh).data, secM=new Uint8Array(mw*mh);
    for(let i=0;i<mw*mh;i++){if(inside[i]&&sd[i*4+3]>40)secM[i]=1;}
    // 벽 = 보안↔일반 경계의 '일반구역 쪽'에만(보안구역 내부엔 벽 없음). 두께 절반.
    const edge=new Uint8Array(mw*mh);
    for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){const i=y*mw+x;if(!inside[i])continue;const s=secM[i];
      if((x+1<mw&&inside[i+1]&&secM[i+1]!==s)||(x-1>=0&&inside[i-1]&&secM[i-1]!==s)||
         (y+1<mh&&inside[i+mw]&&secM[i+mw]!==s)||(y-1>=0&&inside[i-mw]&&secM[i-mw]!==s))edge[i]=1;}
    const R=1, wallB=new Uint8Array(mw*mh);   // 경계벽 두께(이전의 절반) · 일반쪽만
    for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){if(!edge[y*mw+x])continue;
      for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){const nx=x+dx,ny=y+dy;
        if(nx>=0&&ny>=0&&nx<mw&&ny<mh&&inside[ny*mw+nx]&&!secM[ny*mw+nx])wallB[ny*mw+nx]=1;}}
    // 마스크: 바닥(일반=흰/보안=하늘) + 경계벽만 압출
    const top=new ImageData(mw,mh),slab=new ImageData(mw,mh),wt=new ImageData(mw,mh),ws=new ImageData(mw,mh);
    const cTop=hex(COL.plateTop),cSec=hex(COL.plateSec),cSlab=hex(COL.slabSide),cWt=hex(COL.wallTop),cWs=hex(COL.wallSide);
    for(let i=0;i<mw*mh;i++){if(!inside[i])continue;const o=i*4;
      put(slab.data,o,cSlab);
      put(top.data,o, secM[i]?cSec:cTop);
      if(wallB[i]){put(wt.data,o,cWt);put(ws.data,o,cWs);}}
    const masks={};
    for(const [k,id] of [['top',top],['slab',slab],['wallTop',wt],['wallSide',ws]]){
      const c=document.createElement('canvas');c.width=mw;c.height=mh;c.getContext('2d').putImageData(id,0,0);masks[k]=c;}

    // 길찾기 그리드: 건물 밖 + 보안구역만 차단(내부 벽 무시 → 경로 단순/직선적)
    const gw=Math.max(40,Math.round(mw/3)),gh=Math.max(40,Math.round(mh/3));
    const blocked=new Uint8Array(gw*gh),sx=gw/W,sy=gh/H,secs=fdat.security_polygons||[];
    for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){
      const mx=Math.min(mw-1,Math.round((x+0.5)/gw*mw)),my=Math.min(mh-1,Math.round((y+0.5)/gh*mh)),o=(my*mw+mx)*4;
      let bl=false;if(px[o+3]<40)bl=true;
      if(!bl){const vx=(x+0.5)/sx,vy=(y+0.5)/sy;for(const poly of secs){if(pip(vx,vy,poly)){bl=true;break;}}}
      blocked[y*gw+x]=bl?1:0;}
    const comp=new Int32Array(gw*gh).fill(-1);let lab=0,mainL=-1,mc=0;
    for(let i=0;i<comp.length;i++){if(blocked[i]||comp[i]>=0)continue;let cnt=0;const stk=[i];comp[i]=lab;
      while(stk.length){const c=stk.pop();cnt++;const cx=c%gw,cy=(c/gw)|0;
        if(cx+1<gw){const n=c+1;if(!blocked[n]&&comp[n]<0){comp[n]=lab;stk.push(n);}}
        if(cx-1>=0){const n=c-1;if(!blocked[n]&&comp[n]<0){comp[n]=lab;stk.push(n);}}
        if(cy+1<gh){const n=c+gw;if(!blocked[n]&&comp[n]<0){comp[n]=lab;stk.push(n);}}
        if(cy-1>=0){const n=c-gw;if(!blocked[n]&&comp[n]<0){comp[n]=lab;stk.push(n);}}}
      if(cnt>mc){mc=cnt;mainL=lab;}lab++;}
    FL[fk]={W,H,mw,mh,masks,grid:{gw,gh,blocked,comp,main:mainL,sx,sy}};
  }

  /* ---------- 레이아웃 (기준 적층) + 층별 보정(calMat) ----------
     기준(base) 배치는 보정과 무관하게 계산(센터링·적층). 보정 s/dx/dy 는
     '층 중심 기준 확대 + 화면이동'으로 calMat 에서 적용 → dx/dy 가 실제로 먹고
     s 는 제자리에서 커짐(드래그 편집에 직관적). */
  function computeLayout(){
    let maxW=0;
    FLOORS.forEach((fk)=>{const fl=FL[fk];
      const cs=[[0,0],[fl.mw,0],[0,fl.mh],[fl.mw,fl.mh]].map(p=>[A*p[0]+C*p[1], B*p[0]+Dd*p[1]]);
      let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
      cs.forEach(p=>{minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);});
      fl.bMinX=minX;fl.bMinY=minY;fl.w=maxX-minX;fl.h=maxY-minY;maxW=Math.max(maxW,fl.w);});
    const topY={};topY['4F']=PAD+WALL_H;usedGaps={};
    for(let i=2;i>=0;i--){const up=FLOORS[i+1],lo=FLOORS[i];
      let gap;
      if(Array.isArray(O.floorGaps)&&O.floorGaps[i]!=null) gap=O.floorGaps[i];
      else if(typeof O.floorGaps==='number') gap=O.floorGaps;
      else if(O.gap!=null) gap=O.gap;
      else gap=FL[up].h+THICK+WALL_H+O.gapMargin;
      usedGaps[lo]=gap; topY[lo]=topY[up]+gap;}
    const centerX=PAD+maxW/2;
    FLOORS.forEach((fk)=>{const fl=FL[fk];
      fl.e0=centerX-fl.w/2-fl.bMinX; fl.f0=topY[fk]-fl.bMinY; fl.topY=topY[fk];
      fl.cx0=A*(fl.mw/2)+C*(fl.mh/2)+fl.e0; fl.cy0=B*(fl.mw/2)+Dd*(fl.mh/2)+fl.f0;});
    LOGW=maxW+2*PAD; LOGH=FL['1F'].topY+FL['1F'].h+THICK+PAD;
    svg.setAttribute('viewBox',`0 0 ${LOGW.toFixed(1)} ${LOGH.toFixed(1)}`);
    const dpr=Math.min(global.devicePixelRatio||1,2);
    cv.width=Math.round(LOGW*dpr);cv.height=Math.round(LOGH*dpr);cv._dpr=dpr;
    layoutReady=true;
  }
  function calOf(fk){return (O.floorCalib&&O.floorCalib[fk])||{s:1,dx:0,dy:0};}
  // 보정: 평면좌표를 '평면 중심 기준 비균일 확대(sx,sy) + 평면이동(dx,dy)' 으로 변형
  function calMat(fk){const fl=FL[fk],cal=calOf(fk);
    const sx=cal.sx!=null?cal.sx:(cal.s!=null?cal.s:1), sy=cal.sy!=null?cal.sy:(cal.s!=null?cal.s:1);
    const kx=(fl.mw/2)*(1-sx)+RS*(cal.dx||0), ky=(fl.mh/2)*(1-sy)+RS*(cal.dy||0);
    return {a:A*sx,b:B*sx,c:C*sy,d:Dd*sy, e:fl.e0+A*kx+C*ky, f:fl.f0+B*kx+Dd*ky};}
  function project(fk,x,y){const m=calMat(fk),mx=x*RS,my=y*RS;return [m.a*mx+m.c*my+m.e, m.b*mx+m.d*my+m.f];}
  function floorBBox(fk){const fl=FL[fk],m=calMat(fk);
    const cs=[[0,0],[fl.mw,0],[0,fl.mh],[fl.mw,fl.mh]].map(p=>[m.a*p[0]+m.c*p[1]+m.e, m.b*p[0]+m.d*p[1]+m.f]);
    let a1=1e9,b1=1e9,a2=-1e9,b2=-1e9;cs.forEach(p=>{a1=Math.min(a1,p[0]);a2=Math.max(a2,p[0]);b1=Math.min(b1,p[1]);b2=Math.max(b2,p[1]);});
    return {minX:a1,minY:b1-WALL_H,maxX:a2,maxY:b2+THICK};}

  /* ---------- 캔버스: 압출 바닥 ---------- */
  let wallTmp=null,wtx=null;
  function drawFloors(){
    // 아래층(1F)부터 그려 위층(4F)이 맨 위에 오도록 → 겹치면 4F가 보임
    const dpr=cv._dpr;
    if(!wallTmp||wallTmp.width!==cv.width||wallTmp.height!==cv.height){
      wallTmp=document.createElement('canvas');wallTmp.width=cv.width;wallTmp.height=cv.height;wtx=wallTmp.getContext('2d');}
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,cv.width,cv.height);
    for(let i=0;i<=3;i++){const fk=FLOORS[i],fl=FL[fk],mk=fl.masks,m=calMat(fk);
      const T=(dy)=>ctx.setTransform(m.a*dpr,m.b*dpr,m.c*dpr,m.d*dpr,m.e*dpr,(m.f+dy)*dpr);
      ctx.setTransform(m.a*dpr,m.b*dpr,m.c*dpr,m.d*dpr,(m.e+7)*dpr,(m.f+THICK+9)*dpr);
      ctx.globalAlpha=0.16;ctx.drawImage(mk.slab,0,0);ctx.globalAlpha=1;   // 그림자
      for(let k=THICK;k>=1;k--){T(k);ctx.drawImage(mk.slab,0,0);}          // 슬래브 두께
      T(0);ctx.drawImage(mk.top,0,0);                                      // 바닥 윗면
      // 경계벽: 오프스크린에 불투명 압출 후 반투명으로 1회 합성(겹침 누적 방지)
      wtx.setTransform(1,0,0,1,0,0);wtx.clearRect(0,0,wallTmp.width,wallTmp.height);
      const WT=(dy)=>wtx.setTransform(m.a*dpr,m.b*dpr,m.c*dpr,m.d*dpr,m.e*dpr,(m.f+dy)*dpr);
      for(let k=0;k<WALL_H;k++){WT(-k);wtx.drawImage(mk.wallSide,0,0);}
      WT(-WALL_H);wtx.drawImage(mk.wallTop,0,0);
      ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=O.wallOpacity;ctx.drawImage(wallTmp,0,0);ctx.globalAlpha=1;
    }
    ctx.setTransform(1,0,0,1,0,0);
  }

  /* ---------- 멀티플로어 그래프 ---------- */
  const GROUPS=data.floor_links.transit_groups;
  function nodeById(id){const fk=id.split('-')[0];
    for(const n of data.vertical_nodes[fk])if(n.id===id){const o={...n};if(id==='2F-ESC-3')o.y=447.0;return o;}return null;}
  const ADJ={'1F':new Set(),'2F':new Set(),'3F':new Set(),'4F':new Set()},PAIRG={};
  for(const g of GROUPS)for(const a of g.connects)for(const b of g.connects){if(a===b)continue;
    const na=g.nodes.find(id=>id.startsWith(a)),nb=g.nodes.find(id=>id.startsWith(b));
    if(na&&nb){ADJ[a].add(b);(PAIRG[a+'>'+b]=PAIRG[a+'>'+b]||[]).push(g);}}
  function floorSeq(a,b){if(a===b)return[a];const prev={[a]:null},q=[a];
    while(q.length){const c=q.shift();if(c===b)break;for(const nb of[...ADJ[c]].sort())if(!(nb in prev)){prev[nb]=c;q.push(nb);}}
    if(!(b in prev))return null;const s=[];let c=b;while(c!==null){s.push(c);c=prev[c];}return s.reverse();}
  const SIDE_OFF=23;   // 안내데스크 동서남북 이격(1/2로 축소)
  function deskStart(fk,side){const dk=data.guide_desks[fk];const[x,y]=dk.svg;
    const off={N:[0,-SIDE_OFF],S:[0,SIDE_OFF],E:[SIDE_OFF,0],W:[-SIDE_OFF,0]}[side]||[0,SIDE_OFF];
    return {desk:[x,y],start:[x+off[0],y+off[1]]};}
  function facilitiesOf(fk){return (data.facilities[fk]||[]).map((f,idx)=>({...f,floor:fk,idx}));}
  function iconURL(pSeq){const g=data.pseq_icon_groups[pSeq];return g&&g.svg?('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(g.svg)):null;}
  // 목적지 명칭: 선택 언어(name_<lang>) 있으면 사용, 없으면 기본(한글) name
  function tr(f){if(!f)return'';const k='name_'+O.lang;return f[k]||f['name_'+(O.lang||'ko')]||f.name||'';}

  function computeRoute(deskFloor,deskSide,dest){
    const seq=floorSeq(deskFloor,dest.floor);if(!seq)return{error:'층간 연결 경로 없음'};
    const{desk,start}=deskStart(deskFloor,deskSide);
    const legs=[];let cur=start,curFloor=deskFloor;
    for(let i=0;i<seq.length-1;i++){const Aa=seq[i],Bb=seq[i+1];const cands=PAIRG[Aa+'>'+Bb]||[];
      let bg=null,bp=null,bl=1e18,bnA=null,bnB=null;
      for(const g of cands){const na=nodeById(g.nodes.find(id=>id.startsWith(Aa))),nb=nodeById(g.nodes.find(id=>id.startsWith(Bb)));
        if(!na||!nb)continue;const p=astar(FL[curFloor].grid,cur[0],cur[1],na.x,na.y);if(!p)continue;
        const L=pathLen(p);if(L<bl){bl=L;bg=g;bp=p;bnA=na;bnB=nb;}}
      if(!bg)return{error:`${Aa}→${Bb} 환승 지점 도달 불가`};
      legs.push({floor:Aa,pts:reduceBends(FL[curFloor].grid,simplifyOrtho(bp)),desk:(i===0?desk:null),exitTo:{node:bnA,nodeB:bnB,transit:bg,toFloor:Bb}});
      cur=[bnB.x,bnB.y];curFloor=Bb;}
    const p=astar(FL[curFloor].grid,cur[0],cur[1],dest.x,dest.y);
    if(!p)return{error:'목적지 경로 없음'};
    legs.push({floor:curFloor,pts:reduceBends(FL[curFloor].grid,simplifyOrtho(p)),desk:(seq.length===1?desk:null),arrive:dest});
    return {legs,seq,totalLen:legs.reduce((s,l)=>s+pathLen(l.pts),0)};
  }

  /* ---------- SVG 오버레이 ---------- */
  let dotRAF=null;
  function clearLayer(){if(dotRAF)cancelAnimationFrame(dotRAF);svg.innerHTML='';}
  function renderOverlay(){
    clearLayer();
    const defs=E('defs',{});
    defs.innerHTML='<marker id="a25-arr" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L8 5L1 9" fill="none" stroke="'+COL.route+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></marker>';
    svg.appendChild(defs);
    // 정렬 편집: 선택 층 하이라이트
    if(ST.editFloor&&FL[ST.editFloor]){const b=floorBBox(ST.editFloor);
      svg.appendChild(E('rect',{x:b.minX.toFixed(1),y:b.minY.toFixed(1),width:(b.maxX-b.minX).toFixed(1),height:(b.maxY-b.minY).toFixed(1),rx:8,fill:'rgba(255,207,102,0.07)',stroke:'#ffcf66','stroke-width':2,'stroke-dasharray':'9 6'}));}
    // 층 라벨 칩 (1F/2F/3F/4F)
    FLOORS.forEach((fk)=>{const fl=FL[fk];const left=project(fk,0,fl.H*0.5);chip(left[0]-58,left[1]-13,FLOOR_KR[fk],COL.chip[fk]);});
    // 보안구역 점선 경계: 제거(요구사항). 하늘색 채움(마스크)으로만 구분.
    // 시설 아이콘: 평소 전부 숨김(요구사항). 경로 시에만 표시.
    if(ST.routeActive&&ST.route&&ST.route.legs)drawRoute(ST.route);
  }
  function chip(x,y,label,color){
    const g=E('g',{});
    g.appendChild(E('rect',{x:x,y:y,rx:13,width:44,height:26,fill:'rgba(18,24,31,0.85)',stroke:color,'stroke-width':1.4}));
    const t=E('text',{x:x+22,y:y+17,'text-anchor':'middle','font-size':13,'font-family':'system-ui,sans-serif','font-weight':700,fill:color});
    t.textContent=label;g.appendChild(t);svg.appendChild(g);
  }
  function iconOnly(x,y,url,size){ // 래퍼 없이 아이콘만
    if(!url)return;svg.appendChild(E('image',{href:url,'xlink:href':url,x:x-size/2,y:y-size/2,width:size,height:size}));
  }
  function locPin(x,y,color,labelTxt){ // 지도 현위치 핀
    const r=10,g=E('g',{});
    g.appendChild(E('ellipse',{cx:x,cy:y+1,rx:5,ry:2,fill:'rgba(0,0,0,0.35)'}));
    g.appendChild(E('path',{d:`M ${x} ${y} C ${x-r} ${y-r*1.5}, ${x-r} ${y-r*2.6}, ${x} ${y-r*2.8} C ${x+r} ${y-r*2.6}, ${x+r} ${y-r*1.5}, ${x} ${y} Z`,fill:color,stroke:'#fff','stroke-width':1.8}));
    g.appendChild(E('circle',{cx:x,cy:y-r*1.75,r:r*0.46,fill:'#fff'}));
    svg.appendChild(g);
    if(labelTxt)label(x,y-r*2.8-7,labelTxt,color,true);
  }
  function label(x,y,txt,color,strong){
    const t=E('text',{x:x,y:y,'text-anchor':'middle','font-size':strong?13:12,'font-family':'system-ui,sans-serif','font-weight':strong?700:500,fill:color,'paint-order':'stroke',stroke:COL.bg,'stroke-width':3.5,'stroke-linejoin':'round'});
    t.textContent=txt;svg.appendChild(t);
  }

  /* 출발 표식: 노란 정육면체 큐브 */
  function poly(pts,fill,stroke,sw){return E('polygon',{points:pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' '),fill:fill,stroke:stroke||'none','stroke-width':sw||0});}
  function drawCube(fk,planX,planY,sizePlan,hpx){
    const s=sizePlan/2;
    const base=[[planX-s,planY-s],[planX+s,planY-s],[planX+s,planY+s],[planX-s,planY+s]].map(p=>project(fk,p[0],p[1]));
    const top=base.map(p=>[p[0],p[1]-hpx]);
    let bi=0;for(let i=1;i<4;i++)if(base[i][1]>base[bi][1])bi=i;        // 앞쪽 아래 꼭짓점
    const L=(bi+3)%4,Rr=(bi+1)%4;
    svg.appendChild(poly([base[bi],base[Rr],top[Rr],top[bi]],COL.startSideA,'#9c7a00',0.5));
    svg.appendChild(poly([base[bi],base[L],top[L],top[bi]],COL.startSideB,'#9c7a00',0.5));
    svg.appendChild(poly(top,COL.startTop,'#9c7a00',0.6));
  }

  function drawRoute(r){
    // 전체 경로를 하나의 폴리라인으로. 층간은 수직 상승(같은 x로 올린 뒤 진입점으로)
    const pts=[];
    r.legs.forEach((leg)=>{
      const lp=leg.pts.map(p=>project(leg.floor,p[0],p[1]));
      lp.forEach(p=>pts.push(p));
      if(leg.exitTo){const a=lp[lp.length-1],b=project(leg.exitTo.toFloor,leg.exitTo.nodeB.x,leg.exitTo.nodeB.y);
        pts.push([a[0],b[1]]);pts.push(b);}   // 수직 라이저 + (정렬되면 0) 진입 보정
    });
    // 밝은 파랑 동그란 점선
    const dStr="M"+pts.map(q=>q[0].toFixed(1)+" "+q[1].toFixed(1)).join(" L ");
    svg.appendChild(E('path',{d:dStr,fill:'none',stroke:COL.route,'stroke-width':5,'stroke-linecap':'round','stroke-dasharray':'0.1 12'}));
    // 경유 에스컬레이터/엘리베이터 아이콘(래퍼 없음) — 경로상만
    r.legs.forEach((leg)=>{if(leg.exitTo){
      const a=project(leg.floor,leg.exitTo.node.x,leg.exitTo.node.y),b=project(leg.exitTo.toFloor,leg.exitTo.nodeB.x,leg.exitTo.nodeB.y);
      const isElev=leg.exitTo.transit.type==='elevator';
      iconOnly(a[0],(a[1]+b[1])/2,iconURL(isElev?'12':'11'),24);   // 수직 라이저 중간
    }});
    // 출발: 노란 큐브 + "Here"
    const dl=r.legs[0];if(dl.desk){drawCube(dl.floor,dl.desk[0],dl.desk[1],SIDE_OFF*2,20);
      const c=project(dl.floor,dl.desk[0],dl.desk[1]);label(c[0],c[1]-30,'Here',COL.start,true);}
    // 목적지: 핀 + 언어별 명칭
    const last=r.legs[r.legs.length-1],dst=last.arrive;
    if(dst){const e=project(last.floor,dst.x,dst.y);locPin(e[0],e[1],COL.dest,tr(dst));}
  }

  /* ---------- 공개 API ---------- */
  const api={
    el:wrap,
    isReady(){return layoutReady;},
    listFacilities(){const o=[];FLOORS.forEach(fk=>facilitiesOf(fk).forEach(f=>o.push(f)));return o;},
    setDesk(floor,side){ST.desk.floor=floor||ST.desk.floor;ST.desk.side=side||ST.desk.side;
      if(ST.routeActive&&ST.route&&ST.route._dest)api.showRoute({deskFloor:ST.desk.floor,deskSide:ST.desk.side,dest:ST.route._dest});},
    getRoute(){return ST.route;},
    getLang(){return O.lang;},
    setLang(l){O.lang=l||'ko';if(ST.routeActive)renderOverlay();emit('lang',O.lang);},
    // 층별 정렬(보정)
    getCalib(){return JSON.parse(JSON.stringify(O.floorCalib));},
    setCalib(fk,c){O.floorCalib[fk]=Object.assign({s:1,dx:0,dy:0},O.floorCalib[fk],c);drawFloors();renderOverlay();emit('calib',api.getCalib());},
    nudgeCalib(fk,ddx,ddy){const c=calOf(fk);api.setCalib(fk,{dx:(c.dx||0)+ddx,dy:(c.dy||0)+ddy});},
    resetCalib(fk){if(fk)api.setCalib(fk,{s:1,dx:0,dy:0});else{FLOORS.forEach(f=>O.floorCalib[f]={s:1,dx:0,dy:0});drawFloors();renderOverlay();emit('calib',api.getCalib());}},
    // 층간 높이 간격 [1F-2F, 2F-3F, 3F-4F]
    getFloorGaps(){return [usedGaps['1F'],usedGaps['2F'],usedGaps['3F']];},
    setFloorGaps(arr){O.floorGaps=[arr[0],arr[1],arr[2]];computeLayout();drawFloors();renderOverlay();emit('gaps',api.getFloorGaps());},
    setUniformGap(v){api.setFloorGaps([v,v,v]);},
    resetGaps(){O.floorGaps=null;computeLayout();drawFloors();renderOverlay();emit('gaps',api.getFloorGaps());},
    // 드래그 편집 보조
    viewBox(){return {w:LOGW,h:LOGH};},
    setEditFloor(fk){ST.editFloor=fk||null;renderOverlay();},
    getEditFloor(){return ST.editFloor||null;},
    clientToLocal(cx,cy){const r=cv.getBoundingClientRect();return [(cx-r.left)/r.width*LOGW,(cy-r.top)/r.height*LOGH];},
    floorAtLocal(vx,vy){for(let i=0;i<4;i++){const fk=FLOORS[i],b=floorBBox(fk);if(vx>=b.minX&&vx<=b.maxX&&vy>=b.minY&&vy<=b.maxY)return fk;}return null;},
    // 화면(viewBox) 이동량 → 평면(plan) dx,dy 증분
    planDeltaFromScreen(dvx,dvy){const det=A*Dd-B*C;return [(Dd*dvx-C*dvy)/det/RS,(-B*dvx+A*dvy)/det/RS];},
    on(ev,cb){(listeners[ev]=listeners[ev]||[]).push(cb);return api;},
    showRoute(spec){
      spec=spec||{};
      const deskFloor=spec.deskFloor||ST.desk.floor,deskSide=spec.deskSide||ST.desk.side;
      ST.desk.floor=deskFloor;ST.desk.side=deskSide;
      let dest=spec.dest;
      if(dest&&dest.floor&&dest.x==null&&dest.name)dest=facilitiesOf(dest.floor).find(f=>f.name===dest.name&&!f.in_secure)||dest;
      if(!dest||dest.x==null)return{error:'목적지를 찾을 수 없음'};
      const r=computeRoute(deskFloor,deskSide,dest);r._dest=dest;
      ST.route=r;ST.routeActive=!r.error;renderOverlay();
      if(!r.error){const m=Math.round(r.totalLen*O.metersPerUnit),min=Math.max(1,Math.round(r.totalLen*O.metersPerUnit/O.walkMps/60));
        r.summary={dest:dest.name,floor:dest.floor,meters:m,minutes:min,transfers:r.legs.filter(l=>l.exitTo).length,
          steps:[`${deskFloor} 안내데스크 출발 (${({N:'북',S:'남',E:'동',W:'서'})[deskSide]}쪽)`,
                 ...r.legs.filter(l=>l.exitTo).map(l=>`${l.floor} → ${l.exitTo.toFloor} : ${l.exitTo.transit.type==='elevator'?'엘리베이터':'에스컬레이터'} (${l.exitTo.transit.id})`),
                 `${dest.floor} ${dest.name} 도착`]};}
      emit('route',r);return r;
    },
    clearRoute(){ST.routeActive=false;ST.route=null;renderOverlay();emit('route',null);},
    redraw(){computeLayout();drawFloors();renderOverlay();},
    destroy(){if(dotRAF)cancelAnimationFrame(dotRAF);container.innerHTML='';},
  };

  (async function init(){
    for(const fk of FLOORS){try{await rasterFloor(fk);}catch(e){console.error('raster fail',fk,e);}}
    computeLayout();drawFloors();renderOverlay();
    emit('ready',api);if(typeof O.onReady==='function')O.onReady(api);
  })();

  return api;
}

global.AirportMap25D={create};
})(window);
