/**
 * cipher-face.js — matrix-glyph AI face (point cloud, three.js).
 *
 *   import { createCipherFace } from './cipher-face.js';
 *   const face = createCipherFace({ container: document.getElementById('face') });
 *   face.setFace('mask');                    // 'head' | 'mask'
 *   await face.useMic();                     // lip-sync to live microphone
 *   face.useAudioElement(myAudioEl);         // lip-sync to TTS / any <audio>
 *   face.useAudioSource(node, audioContext); // lip-sync to a WebAudio node
 *   await face.speak('Hello.');              // browser voice + lip-sync
 *   face.setMonitor(true);                   // hear the mic (headphones!)
 *   face.stop(); face.dispose();
 *
 * Requires the three.js import map (see ai-face.html) for 'three' and
 * 'three/addons/controls/OrbitControls.js'.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾓﾔﾕﾗﾘﾙﾚﾜﾝ0123456789ABCDEFGHJKLMNPRSTVXZ*+=<>'.split('').slice(0,64);
function buildAtlas(){
  const cell = 64, grid = 8, c = document.createElement('canvas');
  c.width = c.height = cell*grid;
  const x = c.getContext('2d');
  x.clearRect(0,0,c.width,c.height);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  for(let i=0;i<64;i++){
    const cx = (i%grid)*cell + cell/2, cy = Math.floor(i/grid)*cell + cell/2;
    const g = GLYPHS[i] || '0';
    x.font = '300 26px "Martian Mono", monospace';
    x.shadowColor = '#fff'; x.shadowBlur = 10;
    x.fillStyle = 'rgba(255,255,255,0.14)'; x.fillText(g,cx,cy);
    x.shadowBlur = 0;
    x.fillStyle = 'rgba(255,255,255,0.92)'; x.fillText(g,cx,cy);
  }
  const t = new THREE.CanvasTexture(c);
  t.flipY = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/* ---------- face relief (bas-relief depth map) ---------- */
const DW = 256, DH = 320;
function buildDepth(){
  const c = document.createElement('canvas'); c.width = DW; c.height = DH;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0,0,DW,DH);
  const el = (cx,cy,rx,ry,v,rot)=>{
    x.save(); x.translate(cx,cy); if(rot) x.rotate(rot);
    x.beginPath(); x.ellipse(0,0,rx,ry,0,0,Math.PI*2);
    const g = x.createRadialGradient(0,0,0,0,0,Math.max(rx,ry));
    g.addColorStop(0,`rgba(${v},${v},${v},1)`); g.addColorStop(1,`rgba(${v},${v},${v},0)`);
    x.fillStyle = g; x.fill(); x.restore();
  };
  // neutral base
  x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0,0,DW,DH);
  x.globalCompositeOperation = 'lighter';
  el(128,150,132,150,40);                       // overall volume
  el(128,95,66,42,26);                          // forehead
  el(96,128,33,11,64,-0.10); el(160,128,33,11,64,0.10);  // brow ridge
  el(96,143,15,9,24);  el(160,143,15,9,24);     // eyeball
  el(128,160,10,36,56);                         // nose bridge
  el(128,190,15,11,100);                        // nose tip
  el(112,189,9,8,62);  el(144,189,9,8,62);      // alae
  el(84,178,30,28,38); el(172,178,30,28,38);    // cheeks
  el(128,208,6,10,22);                          // philtrum
  el(128,220,31,9,70);                          // upper lip
  el(128,236,29,11,74);                         // lower lip
  el(128,266,33,24,56);                         // chin
  x.globalCompositeOperation = 'difference';
  el(52,120,20,38,20); el(204,120,20,38,20);    // temples
  el(96,144,27,17,34); el(160,144,27,17,34);    // eye sockets
  el(114,193,7,5,26); el(142,193,7,5,26);       // nostrils
  el(128,228,30,3,30);                          // mouth line
  el(128,250,28,6,14);                          // sub-lip shadow
  el(78,238,16,30,12); el(178,238,16,30,12);    // jaw edges
  x.globalCompositeOperation = 'source-over';
  x.filter = 'blur(5px)'; x.drawImage(c,0,0); x.filter = 'none';
  const d = x.getImageData(0,0,DW,DH).data;
  const f = new Float32Array(DW*DH);
  for(let i=0;i<DW*DH;i++) f[i] = (d[i*4]-128)/127;
  return f;
}
const DEPTH = buildDepth();
function depthAt(u,v){
  const px = Math.min(DW-2,Math.max(0,u*(DW-1))), py = Math.min(DH-2,Math.max(0,v*(DH-1)));
  const x0 = px|0, y0 = py|0, fx = px-x0, fy = py-y0;
  const a = DEPTH[y0*DW+x0], b = DEPTH[y0*DW+x0+1], cc = DEPTH[(y0+1)*DW+x0], dd = DEPTH[(y0+1)*DW+x0+1];
  return (a*(1-fx)+b*fx)*(1-fy) + (cc*(1-fx)+dd*fx)*fy;
}

function buildContours(){
  const c = document.createElement('canvas'); c.width = DW; c.height = DH;
  const x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.lineCap = 'round'; x.lineWidth = 1.6;
  const almond = (cx,cy,rx,ry,tilt)=>{
    x.save(); x.translate(cx,cy); x.rotate(tilt);
    x.beginPath(); x.moveTo(-rx,0);
    x.quadraticCurveTo(-rx*0.45,-ry*1.25, 0,-ry); x.quadraticCurveTo(rx*0.5,-ry*0.85, rx,0);
    x.quadraticCurveTo(rx*0.5,ry*0.95, 0,ry); x.quadraticCurveTo(-rx*0.5,ry*0.9, -rx,0);
    x.stroke(); x.restore();
  };
  // eyes (lidded) + lid crease
  almond(96,144,27,13,-0.07); almond(160,144,27,13,0.07);
  x.lineWidth = 1.2;
  x.beginPath(); x.moveTo(72,140); x.quadraticCurveTo(96,128,120,139); x.stroke();
  x.beginPath(); x.moveTo(136,139); x.quadraticCurveTo(160,128,184,140); x.stroke();
  x.beginPath(); x.moveTo(74,147); x.quadraticCurveTo(96,156,118,147); x.stroke();
  x.beginPath(); x.moveTo(138,147); x.quadraticCurveTo(160,156,182,147); x.stroke();
  // brows
  x.lineWidth = 2.6;
  x.beginPath(); x.moveTo(66,128); x.quadraticCurveTo(96,113,126,124); x.stroke();
  x.beginPath(); x.moveTo(190,128); x.quadraticCurveTo(160,113,130,124); x.stroke();
  // nose
  x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(120,132); x.quadraticCurveTo(116,164,110,184); x.stroke();
  x.beginPath(); x.moveTo(136,132); x.quadraticCurveTo(140,164,146,184); x.stroke();
  x.beginPath(); x.moveTo(110,184); x.quadraticCurveTo(104,196,114,197); x.stroke();
  x.beginPath(); x.moveTo(146,184); x.quadraticCurveTo(152,196,142,197); x.stroke();
  x.beginPath(); x.moveTo(114,197); x.quadraticCurveTo(128,205,142,197); x.stroke();
  x.beginPath(); x.moveTo(118,191); x.quadraticCurveTo(128,187,138,191); x.stroke();
  // lips
  x.lineWidth = 2.2;
  x.beginPath(); x.moveTo(98,228); x.quadraticCurveTo(113,226,122,220);
  x.quadraticCurveTo(128,225,134,220); x.quadraticCurveTo(143,226,158,228); x.stroke();
  x.beginPath(); x.moveTo(98,228); x.quadraticCurveTo(128,252,158,228); x.stroke();
  x.lineWidth = 1.4;
  x.beginPath(); x.moveTo(100,229); x.quadraticCurveTo(128,236,156,229); x.stroke();
  x.beginPath(); x.moveTo(122,210); x.lineTo(120,219); x.stroke();
  x.beginPath(); x.moveTo(134,210); x.lineTo(136,219); x.stroke();
  // jaw + chin
  x.lineWidth = 1.3;
  x.beginPath(); x.moveTo(66,168); x.quadraticCurveTo(78,240,128,266);
  x.quadraticCurveTo(178,240,190,168); x.stroke();
  x.beginPath(); x.moveTo(112,254); x.quadraticCurveTo(128,263,144,254); x.stroke();
  // cheek / temple structure
  x.lineWidth = 1.1;
  x.beginPath(); x.moveTo(70,158); x.quadraticCurveTo(86,190,106,206); x.stroke();
  x.beginPath(); x.moveTo(186,158); x.quadraticCurveTo(170,190,150,206); x.stroke();
  x.beginPath(); x.moveTo(60,104); x.quadraticCurveTo(128,74,196,104); x.stroke();
  const d = x.getImageData(0,0,DW,DH).data;
  const f = new Float32Array(DW*DH);
  for(let i=0;i<DW*DH;i++) f[i] = d[i*4+3]/255;
  return f;
}
const CONT = buildContours();

const LIP_Y = -0.445;
function lipWeights(p, front){
  let lip = 0, jaw = 0;
  if(front > 0.15){
    const dx = Math.abs(p.x)/0.34, dy = Math.abs(p.y-LIP_Y)/0.15;
    if(dx < 1 && dy < 1) lip = (1-dy)*(1-dx*dx)*(p.y > LIP_Y ? 1 : -1.25);
  }
  if(p.y < LIP_Y-0.04) jaw = Math.min(1,(LIP_Y-0.04-p.y)/0.45);
  return [lip, jaw];
}

/* ---------- head point cloud ---------- */
function buildHead(){
  const N = 15000;
  const pos = [], size = [], seed = [], lipA = [], jawA = [], acc = [], dim = [];
  const RX = 0.70, RY = 0.98, RZ = 0.86;
  for(let i=0;i<N;i++){
    const k = i+0.5;
    const y = 1 - 2*k/N, r = Math.sqrt(Math.max(0,1-y*y));
    const th = Math.PI*(1+Math.sqrt(5))*k;
    let dx = r*Math.cos(th), dy = y, dz = r*Math.sin(th);
    let px = dx*RX, py = dy*RY, pz = dz*RZ;
    // jaw taper + chin projection
    const t = Math.min(1,Math.max(0,(-py-0.02)/0.98));
    px *= 1-0.46*t*t; pz *= 1-0.16*t*t;
    if(dz>0) pz += 0.10*t*t;
    if(py>0.55) pz *= 1-0.10*(py-0.55);
    const front = Math.max(0,dz);
    const w = Math.pow(front,1.5);
    let D = 0;
    if(w>0.01){
      const u = 0.5 + (px/0.62)*0.5, v = 0.5 - (py/1.06)*0.5;
      D = depthAt(Math.min(1,Math.max(0,u)), Math.min(1,Math.max(0,v)));
      const nl = Math.hypot(dx/RX, dy/RY, dz/RZ);
      px += (dx/RX/nl)*D*0.20*w; py += (dy/RY/nl)*D*0.20*w; pz += (dz/RZ/nl)*D*0.20*w;
    }
    if(py < -0.90) continue;
    if(dz < 0.02 && Math.random() > 0.40) continue;
    const p = {x:px,y:py,z:pz};
    const [lip,jaw] = lipWeights(p, front);
    pos.push(px,py,pz);
    size.push(6.5 + Math.random()*2.6 + Math.abs(D)*w*3.0);
    seed.push(Math.random());
    lipA.push(lip); jawA.push(jaw);
    acc.push(Math.min(1, Math.max(0, (Math.abs(D)-0.30)*2.1) * w));
    dim.push(dz < 0.02 ? 0.42 : 0.70 + 0.55*w);
  }

  // second pass: feature points concentrated where the relief has structure
  const RXf = 0.62, RYf = 1.06;
  let tries = 0, added = 0;
  while(added < 5200 && tries++ < 160000){
    const u = Math.random(), v = 0.16 + Math.random()*0.76;
    const D = depthAt(u,v);
    const gx = depthAt(Math.min(1,u+0.006),v) - depthAt(Math.max(0,u-0.006),v);
    const gy = depthAt(u,Math.min(1,v+0.006)) - depthAt(u,Math.max(0,v-0.006));
    const grad = Math.hypot(gx,gy);
    const prob = Math.min(1, grad*9.0 + Math.abs(D)*0.35);
    if(Math.random() > prob) continue;
    const x = (u-0.5)*2*RXf, y = (0.5-v)*2*RYf;
    const q = 1 - (x/RX)*(x/RX) - (y/RY)*(y/RY);
    if(q <= 0.04) continue;
    let z = RZ*Math.sqrt(q);
    const t2 = Math.min(1,Math.max(0,(-y-0.02)/0.98));
    let xx = x*(1-0.46*t2*t2*0.55);
    z = z*(1-0.16*t2*t2) + 0.10*t2*t2 + D*0.20;
    const p2 = {x:xx,y:y,z:z};
    const [lip2,jaw2] = lipWeights(p2, 1.0);
    pos.push(xx,y,z);
    size.push(6.8 + Math.random()*3.0);
    seed.push(Math.random());
    lipA.push(lip2); jawA.push(jaw2);
    acc.push(Math.min(1, grad*7.0 + Math.max(0,D)*0.35));
    dim.push(1.15 + Math.min(0.6, grad*4.0));
    added++;
  }

  // third pass: facial contours
  const onSurface = (u,v)=>{
    const x = (u-0.5)*2*RXf, y = (0.5-v)*2*RYf;
    const q = 1 - (x/RX)*(x/RX) - (y/RY)*(y/RY);
    if(q <= 0.03) return null;
    const D = depthAt(u,v);
    const t2 = Math.min(1,Math.max(0,(-y-0.02)/0.98));
    const xx = x*(1-0.46*t2*t2*0.55);
    const z = RZ*Math.sqrt(q)*(1-0.16*t2*t2) + 0.10*t2*t2 + D*0.20;
    return {x:xx,y:y,z:z,D:D};
  };
  for(let iy=0; iy<DH; iy++){
    for(let ix=0; ix<DW; ix++){
      const a = CONT[iy*DW+ix];
      if(a < 0.25 || Math.random() > a*0.62) continue;
      const u = (ix + Math.random()-0.5)/(DW-1), v = (iy + Math.random()-0.5)/(DH-1);
      const s = onSurface(u,v); if(!s) continue;
      const [lip3,jaw3] = lipWeights(s, 1.0);
      pos.push(s.x, s.y, s.z);
      size.push(7.2 + Math.random()*2.8);
      seed.push(Math.random());
      lipA.push(lip3); jawA.push(jaw3);
      acc.push(Math.max(0, s.D) * 0.9);
      dim.push(1.9 + Math.random()*0.5);
    }
  }
  return makeGeo(pos,size,seed,lipA,jawA,acc,dim);
}

/* ---------- mask point cloud ---------- */
function buildMask(){
  const W = 400, H = 540;
  const plate = document.createElement('canvas'); plate.width = W; plate.height = H;
  const feat = document.createElement('canvas'); feat.width = W; feat.height = H;
  const a = plate.getContext('2d'), b = feat.getContext('2d');

  a.fillStyle = '#fff';
  a.beginPath(); a.ellipse(200,200,150,178,0,0,Math.PI*2); a.fill();
  a.beginPath(); a.moveTo(92,318); a.quadraticCurveTo(148,366,200,432);
  a.quadraticCurveTo(252,366,308,318); a.closePath(); a.fill();
  a.globalCompositeOperation = 'destination-out';
  a.save(); a.translate(136,196); a.rotate(-0.16);
  a.beginPath(); a.ellipse(0,0,50,29,0,0,Math.PI*2); a.fill(); a.restore();
  a.save(); a.translate(264,196); a.rotate(0.16);
  a.beginPath(); a.ellipse(0,0,50,29,0,0,Math.PI*2); a.fill(); a.restore();
  a.globalCompositeOperation = 'source-over';

  b.strokeStyle = '#fff'; b.lineCap = 'round'; b.fillStyle = '#fff';
  // rim
  b.lineWidth = 5;
  b.beginPath(); b.ellipse(200,200,150,178,0,Math.PI*0.06,Math.PI*0.94,true); b.stroke();
  b.beginPath(); b.moveTo(92,318); b.quadraticCurveTo(148,366,200,432);
  b.quadraticCurveTo(252,366,308,318); b.stroke();
  // brows
  b.lineWidth = 11;
  b.beginPath(); b.moveTo(78,168); b.quadraticCurveTo(128,124,182,158); b.stroke();
  b.beginPath(); b.moveTo(322,168); b.quadraticCurveTo(272,124,218,158); b.stroke();
  // eye rims
  b.lineWidth = 4;
  b.save(); b.translate(136,196); b.rotate(-0.16);
  b.beginPath(); b.ellipse(0,0,50,29,0,0,Math.PI*2); b.stroke(); b.restore();
  b.save(); b.translate(264,196); b.rotate(0.16);
  b.beginPath(); b.ellipse(0,0,50,29,0,0,Math.PI*2); b.stroke(); b.restore();
  // moustache
  b.lineWidth = 13;
  b.beginPath(); b.moveTo(196,318); b.bezierCurveTo(168,318,134,310,126,288);
  b.bezierCurveTo(122,276,134,272,142,281); b.stroke();
  b.beginPath(); b.moveTo(204,318); b.bezierCurveTo(232,318,266,310,274,288);
  b.bezierCurveTo(278,276,266,272,258,281); b.stroke();
  // smile
  b.lineWidth = 6;
  b.beginPath(); b.moveTo(154,340); b.quadraticCurveTo(200,364,246,340); b.stroke();
  // goatee
  b.beginPath(); b.moveTo(178,378); b.quadraticCurveTo(200,394,222,378);
  b.quadraticCurveTo(212,406,200,424); b.quadraticCurveTo(188,406,178,378); b.fill();
  // cheek rings
  b.lineWidth = 3;
  b.beginPath(); b.arc(104,250,26,0,Math.PI*2); b.stroke();
  b.beginPath(); b.arc(296,250,26,0,Math.PI*2); b.stroke();
  // nose
  b.lineWidth = 5;
  b.beginPath(); b.moveTo(200,212); b.lineTo(200,278); b.stroke();
  b.beginPath(); b.moveTo(182,280); b.quadraticCurveTo(200,294,218,280); b.stroke();

  const pd = a.getImageData(0,0,W,H).data, fd = b.getImageData(0,0,W,H).data;
  const pos = [], size = [], seed = [], lipA = [], jawA = [], acc = [], dim = [];
  const S = 2.30/H; // world units per px
  const push = (x,y,isFeat)=>{
    const nx = (x-200)*S, ny = (H*0.46-y)*S;
    const ex = nx/0.98, ey = ny/1.15;
    let z = 0.40*(1 - Math.min(1.6, ex*ex*0.95 + ey*ey*0.5));
    z += 0.16*Math.exp(-((nx/0.10)**2 + ((ny-0.02)/0.30)**2));
    const mouthBand = y>268 && y<352 ? 1 : 0;
    let lip = 0;
    if(mouthBand){
      const dy = (y-310)/44;
      lip = (1-Math.abs(dy))*(y<310?0.8:-1.0)*Math.max(0,1-Math.abs(nx)/0.62);
    }
    pos.push(nx,ny,z);
    size.push(isFeat ? 7.5+Math.random()*2.6 : 6.0+Math.random()*2.0);
    seed.push(Math.random());
    lipA.push(lip); jawA.push(isFeat && y>300 ? Math.min(1,(y-300)/150) : 0);
    acc.push(isFeat ? 0.55+Math.random()*0.45 : 0);
    dim.push(isFeat ? 1.35 : 0.62);
  };
  let guard = 0;
  while(pos.length < 4200*3 && guard++ < 400000){
    const x = Math.random()*W, y = Math.random()*H;
    if(pd[((y|0)*W+(x|0))*4+3] > 140) push(x,y,false);
  }
  guard = 0;
  while(pos.length < 9500*3 && guard++ < 900000){
    const x = Math.random()*W, y = Math.random()*H;
    if(fd[((y|0)*W+(x|0))*4+3] > 120) push(x,y,true);
  }
  return makeGeo(pos,size,seed,lipA,jawA,acc,dim);
}

function makeGeo(pos,size,seed,lip,jaw,acc,dim){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size,1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed,1));
  g.setAttribute('aLip', new THREE.Float32BufferAttribute(lip,1));
  g.setAttribute('aJaw', new THREE.Float32BufferAttribute(jaw,1));
  g.setAttribute('aAcc', new THREE.Float32BufferAttribute(acc,1));
  g.setAttribute('aDim', new THREE.Float32BufferAttribute(dim,1));
  g.computeBoundingSphere();
  return g;
}

/* ---------- material ---------- */
const VERT = `
attribute float aSize, aSeed, aLip, aJaw, aAcc, aDim;
uniform float uTime, uJaw, uWide, uDpr, uScale;
varying float vGlyph, vBright, vAcc;
float hash(float n){ return fract(sin(n*91.3458)*47453.5453); }
void main(){
  vec3 p = position;
  p.y -= aJaw * uJaw * 0.085;
  p.y += aLip * uJaw * 0.085;
  p.z += abs(aLip) * uJaw * 0.05;
  p.x *= 1.0 + abs(aLip) * uWide * 0.16;
  p.x += sin(uTime*0.7 + p.y*1.4)*0.006;

  float col = floor((p.x + 1.2) * 11.0);
  float sc = hash(col);
  float t = fract(uTime * (0.10 + 0.20*sc) + sc);
  float headY = 1.45 - t*3.1;
  float d = p.y - headY;
  float glow = d >= 0.0 ? exp(-d*4.2) : 0.0;
  vBright = ((0.26 + 0.14*hash(aSeed*37.0) + 0.85*glow) * aDim + aAcc*0.16) * 1.55;
  vAcc = aAcc;
  vGlyph = floor(mod(floor(uTime*7.0 + aSeed*64.0 + hash(aSeed)*30.0), 64.0));

  vec4 mv = modelViewMatrix * vec4(p,1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uDpr * uScale * (1.0 + glow*0.30) * (4.6 / max(0.001,-mv.z));
}`;
const FRAG = `
precision highp float;
uniform sampler2D uAtlas;
uniform float uOpacity;
uniform vec3 uAccent;
varying float vGlyph, vBright, vAcc;
void main(){
  float gi = vGlyph;
  vec2 cell = vec2(mod(gi,8.0), floor(gi/8.0));
  vec4 tex = texture2D(uAtlas, (cell + gl_PointCoord) * 0.125);
  float a = tex.a * clamp(vBright,0.0,2.0) * uOpacity;
  if(a < 0.006) discard;
  vec3 base = mix(vec3(0.14,0.66,1.0), vec3(0.66,0.97,1.0), clamp((vBright-0.40)*1.5,0.0,1.0));
  vec3 col = mix(base, uAccent, clamp(vAcc,0.0,1.0)*0.5);
  col = mix(col, vec3(1.0), clamp((vBright-1.0)*1.3,0.0,0.7));
  gl_FragColor = vec4(col, min(a,1.0));
}`;

/* ---------- shared, built once ---------- */
let _atlas = null, _headGeo = null, _maskGeo = null;
function atlasTex(){ if(!_atlas) _atlas = buildAtlas(); return _atlas; }
function headGeo(){ if(!_headGeo) _headGeo = buildHead(); return _headGeo; }
function maskGeo(){ if(!_maskGeo) _maskGeo = buildMask(); return _maskGeo; }

const hex2vec = (h)=>{ const c = new THREE.Color(h); return new THREE.Vector3(c.r,c.g,c.b); };

export function createCipherFace(opts = {}){
  const container = opts.container || document.body;
  const accent = hex2vec(opts.accent || '#8b5cfe');
  const bg = new THREE.Color(opts.background || '#0a0a0c');

  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha: !!opts.transparent });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(bg, opts.transparent ? 0 : 1);
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, opts.distance || 4.6);
  const group = new THREE.Group(); scene.add(group);

  function makeMat(){
    return new THREE.ShaderMaterial({
      uniforms:{ uTime:{value:0}, uJaw:{value:0}, uWide:{value:0},
        uDpr:{value:Math.min(2, window.devicePixelRatio || 1)}, uScale:{value:1},
        uAtlas:{value:atlasTex()}, uOpacity:{value:1}, uAccent:{value:accent} },
      vertexShader:VERT, fragmentShader:FRAG,
      transparent:true, depthTest:false, depthWrite:false, blending:THREE.AdditiveBlending
    });
  }
  const headMat = makeMat(), maskMat = makeMat();
  const head = new THREE.Points(headGeo(), headMat);
  const mask = new THREE.Points(maskGeo(), maskMat);
  group.add(head, mask);

  let controls = null;
  if(opts.orbit !== false){
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.07;
    controls.minDistance = 2.4; controls.maxDistance = 9;
    controls.enablePan = false;
    controls.minPolarAngle = 0.5; controls.maxPolarAngle = Math.PI - 0.5;
  }

  function resize(){
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = h + 'px';
    camera.aspect = w / Math.max(1,h); camera.updateProjectionMatrix();
    const s = Math.min(1.4, Math.max(0.75, h / 900));
    headMat.uniforms.uScale.value = maskMat.uniforms.uScale.value = s;
  }
  const ro = new ResizeObserver(resize); ro.observe(container);
  window.addEventListener('resize', resize);
  resize();

  /* ---------- audio ---------- */
  let ctx = opts.audioContext || null, analyser = null, freq = null;
  let micSrc = null, micStream = null, monitorGain = null, extSrc = null, elSrc = null, elTarget = null;
  let mode = 'idle', onState = opts.onState || null, onLevel = opts.onLevel || null;
  const setMode = (m)=>{ mode = m; if(onState) onState(m); };

  function ensureCtx(){
    if(!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if(!analyser){
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.55;
      freq = new Uint8Array(analyser.frequencyBinCount);
      monitorGain = ctx.createGain(); monitorGain.gain.value = 0;
      monitorGain.connect(ctx.destination);   // analyser itself never reaches the speakers
    }
    if(ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function bandAvg(f0, f1){
    const nyq = ctx.sampleRate / 2, n = analyser.frequencyBinCount;
    const i0 = Math.max(0, Math.floor(f0 / nyq * n)), i1 = Math.min(n - 1, Math.ceil(f1 / nyq * n));
    let s = 0; for(let i = i0; i <= i1; i++) s += freq[i];
    return s / ((i1 - i0 + 1) * 255);
  }
  function stop(){
    if(micSrc){ try{ micSrc.disconnect(); }catch(e){} micSrc = null; }
    if(micStream){ micStream.getTracks().forEach(t=>t.stop()); micStream = null; }
    if(extSrc){ try{ extSrc.disconnect(analyser); }catch(e){} extSrc = null; }
    if(elTarget){ try{ elTarget.pause(); }catch(e){} }
    if(window.speechSynthesis) window.speechSynthesis.cancel();
    if(monitorGain) monitorGain.gain.value = 0;
    setMode('idle');
  }

  async function useMic(){
    stop(); ensureCtx();
    micStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:false } });
    micSrc = ctx.createMediaStreamSource(micStream);
    micSrc.connect(analyser);
    micSrc.connect(monitorGain);
    setMode('listening');
  }
  function setMonitor(on){ if(monitorGain) monitorGain.gain.value = on ? 1 : 0; }

  function useAudioElement(el){
    stop(); ensureCtx();
    if(!el.__cipherSrc) el.__cipherSrc = ctx.createMediaElementSource(el);
    elSrc = el.__cipherSrc; elTarget = el;
    try{ elSrc.disconnect(); }catch(e){}
    elSrc.connect(analyser);
    elSrc.connect(ctx.destination);        // you hear the track
    const done = ()=>{ if(mode === 'speaking') setMode('idle'); el.removeEventListener('ended', done); };
    el.addEventListener('ended', done);
    setMode('speaking');
    return el.play();
  }
  function useAudioSource(node, nodeCtx){
    if(nodeCtx) ctx = nodeCtx;
    stop(); ensureCtx();
    extSrc = node; node.connect(analyser);
    setMode('speaking');
  }

  /* browser voice — no analysable stream, so the mouth runs on a speech envelope */
  let ttsT0 = 0, ttsWord = 0, ttsEnergy = 0.8;
  function speak(text, o = {}){
    return new Promise((resolve, reject)=>{
      if(!('speechSynthesis' in window)){ reject(new Error('speechSynthesis unavailable')); return; }
      stop();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = o.rate ?? 1; u.pitch = o.pitch ?? 0.85; u.volume = o.volume ?? 1;
      if(o.voice){
        const v = speechSynthesis.getVoices().find(x => x.name === o.voice || x.lang === o.voice);
        if(v) u.voice = v;
      }
      const now = ()=> performance.now() / 1000;
      u.onstart = ()=>{ ttsT0 = now(); ttsWord = ttsT0; setMode('tts'); };
      u.onboundary = (e)=>{ if(e.name === 'word'){ ttsWord = now(); ttsEnergy = 0.62 + Math.random() * 0.38; } };
      u.onend = ()=>{ if(mode === 'tts') setMode('idle'); resolve(); };
      u.onerror = (e)=>{ if(mode === 'tts') setMode('idle'); reject(e); };
      speechSynthesis.speak(u);
    });
  }

  /* ---------- loop ---------- */
  let jaw = 0, wide = 0, blend = opts.face === 'mask' ? 1 : 0, target = blend;
  let px = 0, py = 0, raf = 0, disposed = false;
  headMat.uniforms.uOpacity.value = 1 - blend;
  maskMat.uniforms.uOpacity.value = blend;

  const onPointer = (e)=>{
    px = (e.clientX / window.innerWidth - 0.5);
    py = (e.clientY / window.innerHeight - 0.5);
  };
  if(opts.parallax !== false) window.addEventListener('pointermove', onPointer);

  const t0 = performance.now() / 1000;
  function tick(){
    if(disposed) return;
    const t = performance.now() / 1000 - t0;
    let jT = 0, wT = 0;
    if(mode === 'tts'){
      const tt = t - (ttsT0 - t0), gap = Math.min(1, (performance.now()/1000 - ttsWord) / 0.045);
      jT = Math.min(1, (0.26 + 0.74 * Math.abs(Math.sin(tt * Math.PI * 4.6))) *
                       ttsEnergy * (0.62 + 0.38 * Math.sin(tt * 11.0)) * gap * 0.92);
      wT = 0.22 + 0.34 * Math.abs(Math.sin(tt * 7.1));
    }else if(mode !== 'idle' && analyser){
      analyser.getByteFrequencyData(freq);
      jT = Math.min(1, Math.max(0, (bandAvg(90, 520) - 0.06) * 2.6));
      wT = Math.min(1, Math.max(0, (bandAvg(1800, 5200) - 0.03) * 3.4));
    }else{
      jT = 0.035 + 0.03 * Math.sin(t * 1.5) + 0.02 * Math.sin(t * 0.41);
    }
    jaw += (jT - jaw) * (jT > jaw ? 0.42 : 0.13);
    wide += (wT - wide) * (wT > wide ? 0.35 : 0.10);
    blend += (target - blend) * 0.09;
    if(onLevel) onLevel(jaw);

    for(const m of [headMat, maskMat]){
      m.uniforms.uTime.value = t; m.uniforms.uJaw.value = jaw; m.uniforms.uWide.value = wide;
    }
    headMat.uniforms.uOpacity.value = Math.max(0, 1 - blend * 1.25);
    maskMat.uniforms.uOpacity.value = Math.max(0, (blend - 0.2) * 1.25);
    head.visible = headMat.uniforms.uOpacity.value > 0.01;
    mask.visible = maskMat.uniforms.uOpacity.value > 0.01;

    if(opts.parallax !== false){
      group.rotation.y += ((px * 0.42) - group.rotation.y) * 0.05;
      group.rotation.x += ((py * 0.22) - group.rotation.x) * 0.05;
    }
    group.position.y = Math.sin(t * 0.7) * 0.012;

    if(controls) controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  tick();
  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(()=>{ const t = atlasTex(); t.image = buildAtlas().image; t.needsUpdate = true; });
  }

  return {
    canvas: renderer.domElement,
    setFace(name){ target = name === 'mask' ? 1 : 0; },
    get face(){ return target === 1 ? 'mask' : 'head'; },
    get mode(){ return mode; },
    get level(){ return jaw; },
    get audioContext(){ return ctx; },
    set onState(f){ onState = f; },
    set onLevel(f){ onLevel = f; },
    useMic, useAudioElement, useAudioSource, speak, setMonitor, stop, resize,
    dispose(){
      disposed = true; cancelAnimationFrame(raf); stop();
      ro.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      if(controls) controls.dispose();
      renderer.dispose();
      if(renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  };
}
