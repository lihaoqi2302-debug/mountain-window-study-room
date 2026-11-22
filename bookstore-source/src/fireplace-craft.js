import * as THREE from 'three';
import { canvasTexture, mulberry32 } from './textures.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;

function woodMaps(size) {
  const random = mulberry32(951);
  // Bark has overlapping longitudinal plates. Bright fissures are registered
  // to the same paths in a separate emission map, never to the entire log.
  const cracks = [];
  for (let i = 0; i < 170; i++) {
    const x = random(), y = random(), length = .018 + random() * .27;
    const points = [];
    for (let j = 0; j <= 7; j++) {
      points.push([x + .007 * Math.sin(j * .84 + i) + .008 * (random() - .5), y + j * length / 7]);
    }
    cracks.push({ points, hot: random() > .77, width: .0015 + .0055 * random() });
  }
  function stroke(ctx, points, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  function drawBark(ctx, charred) {
    ctx.fillStyle = charred ? '#312f2c' : '#544337';
    ctx.fillRect(0, 0, 1, 1);
    for (let i = 0; i < 3200; i++) {
      const x = random(), y = random(), w = .001 + .018 * random(), h = .008 + .09 * random();
      ctx.fillStyle = random() > .45 ? 'rgba(185,166,140,.16)' : 'rgba(11,9,8,.23)';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h * .23);
      ctx.lineTo(x + w * .45, y + h); ctx.lineTo(x - w * .3, y + h * .64); ctx.fill();
    }
    for (const c of cracks) {
      stroke(ctx, c.points, c.width * 1.8, 'rgba(190,166,134,.27)');
      stroke(ctx, c.points, c.width, '#211d19');
    }
  }
  const map = draw => canvasTexture(size, size, (ctx, w, h) => {
    ctx.scale(w, h); draw(ctx);
  }, { clamp: true, anisotropy: 8 });
  const bark = map(ctx => drawBark(ctx, false));
  const char = map(ctx => drawBark(ctx, true));
  const heat = map(ctx => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1, 1);
    for (const c of cracks.filter(c => c.hot)) {
      stroke(ctx, c.points, c.width * 1.4, '#822506');
      stroke(ctx, c.points.slice(1, 6), c.width * .55, '#ff901e');
    }
  });
  const split = map(ctx => {
    ctx.fillStyle = '#a17a51'; ctx.fillRect(0, 0, 1, 1);
    for (let i = 0; i < 1800; i++) {
      const x = random(), y = random(), len = .02 + random() * .42;
      stroke(ctx, [[x,y],[x+.004,y+len*.27],[x-.002,y+len*.73],[x+.004,y+len]],
        .0008 + random()*.004, random() > .45 ? 'rgba(64,40,25,.26)' : 'rgba(244,213,160,.30)');
    }
  });
  const grainEnd = (base) => map(ctx => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, 1, 1);
    for (let i=0;i<7500;i++){
      ctx.fillStyle = rndTone();
      ctx.fillRect(random(),random(),.001+random()*.005,.0015);
    }
    function rndTone(){return random()>.5?'rgba(41,28,19,.19)':'rgba(221,190,146,.21)';}
    let r = .013;
    while (r < .74) {
      const points = [];
      for (let j = 0; j <= 128; j++) {
        const a = j * TAU / 128;
        const q = r * (1 + .037*Math.sin(3*a+.7) + .019*Math.cos(7*a + r*9));
        points.push([.50 + q*Math.cos(a), .50 + q*Math.sin(a)]);
      }
      stroke(ctx, points, .003 + random()*.004, 'rgba(72,48,32,.42)');
      r += .012 + random()*.018;
    }
    for (let i = 0; i < 11; i++) {
      const a = random()*TAU, length = .12 + random()*.28;
      const points = Array.from({length:6}, (_,j) => {
        const r = .48 - j*length/5, t = a + .035*Math.sin(j+i);
        return [.5 + r*Math.cos(t), .5 + r*Math.sin(t)];
      });
      stroke(ctx, points, .004, '#533b2c');
    }
  });
  const matte = (map, bumpScale) => new THREE.MeshStandardMaterial({map, bumpMap:map, bumpScale, roughness:.96});
  const barkMat = matte(bark,.00085), charMat = matte(char,.001);
  charMat.color.setHex(0xa5988c);
  charMat.emissive.setHex(0xff782c); charMat.emissiveMap = heat; charMat.emissiveIntensity = 1.8;
  return {
    bark:barkMat, char:charMat, split:matte(split,.00045),
    end:matte(grainEnd('#96724d'),.00013),
    spareEnd:matte(grainEnd('#b8966e'),.00013),
  };
}

function meshData() { return { positions:[], uvs:[] }; }
function triangle(data, a, b, c) {
  for (const [position, uv] of [a,b,c]) {
    data.positions.push(position.x,position.y,position.z); data.uvs.push(...uv);
  }
}
function geometry(data, smooth = false) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(data.uvs,2));
  if (!smooth) { g.computeVertexNormals(); return g; }
  // Average adjacent bark facets while preserving UV seams and the radial split.
  const joined=mergeVertices(g);
  joined.computeVertexNormals();
  const result=joined.toNonIndexed();
  joined.dispose();g.dispose();
  return result;
}

// Each billet is a sector cleaved from a tapered trunk. The curved bark, the
// two radial fracture planes and the saw-cut ends have distinct silhouettes and UVs.
function hewLog(spec, mats, low) {
  const bark = meshData(), split = meshData(), cut = meshData();
  const flakes = meshData(), fibres = meshData();
  const rnd = mulberry32(spec.seed), phase = rnd()*TAU, twist = rnd()*.08-.04;
  const ribs = low ? 12 : 26, along = low ? 6 : 14, splitSteps = low ? 4 : 9;
  const first = -.11 + rnd()*.20, sweep = spec.arc * Math.PI/180;
  const angle = u => first + sweep*u;
  function point(x, y, t) {
    const q = twist*(t-.5), c = Math.cos(q), s = Math.sin(q);
    return V(x*c-y*s + .004*Math.sin(t*Math.PI*1.5+phase),
      x*s+y*c + .004*Math.sin(t*Math.PI+phase),
      (t-.5)*spec.length + .10*(x*c-y*s + .004*Math.sin(t*Math.PI*1.5+phase)));
  }
  function edge(u, t, lift=0) {
    const a = angle(u);
    const r = spec.radius * (1.03-.10*t+.038*Math.sin(3*a+phase)+.032*Math.sin(11*a+.8*Math.sin(4*t+phase))
      +.024*Math.sin(23*a+phase+1.8*t)) + lift;
    return point(r*Math.cos(a),r*Math.sin(a),t);
  }
  function cleft(u,t,side) {
    const a = angle(side), rim = edge(side,t), heart = point(.004,-.004,t);
    const p = heart.lerp(rim,u);
    const ridge = .0035*Math.sin(24*u+phase+1.3*t)*Math.sin(Math.PI*u);
    p.x += ridge*Math.sin(a); p.y -= ridge*Math.cos(a);
    return p;
  }
  function strip(data,n,at,reverse=false) {
    for (let j=0;j<along;j++) for(let i=0;i<n;i++) {
      const vertex=(i,j)=>[at(i/n,j/along),[i/n,j/along]];
      const a=vertex(i,j), b=vertex(i+1,j), c=vertex(i+1,j+1), d=vertex(i,j+1);
      if(reverse){triangle(data,a,c,b);triangle(data,a,d,c);}
      else {triangle(data,a,b,c);triangle(data,a,c,d);}
    }
  }
  strip(bark,ribs,edge);
  strip(split,splitSteps,(u,t)=>cleft(u,t,0));strip(split,splitSteps,(u,t)=>cleft(u,t,1),true);
  for (const t of [0,1]) {
    const border=[];
    for(let j=0;j<splitSteps;j++)border.push(cleft(j/splitSteps,t,0));
    for(let j=0;j<=ribs;j++)border.push(edge(j/ribs,t));
    for(let j=splitSteps-1;j>=1;j--)border.push(cleft(j/splitSteps,t,1));
    const center=point(spec.radius*.35*Math.cos(angle(.5)),spec.radius*.35*Math.sin(angle(.5)),t);
    const vertex=p=>[p,[.5+p.x/(spec.radius*2.3),.5+p.y/(spec.radius*2.3)]];
    for(let j=0;j<border.length;j++){
      const a=vertex(border[j]),b=vertex(border[(j+1)%border.length]);
      if(t)triangle(cut,vertex(center),a,b);else triangle(cut,vertex(center),b,a);
    }
  }
  // Lift one side of individual bark plates and tear fibres past the end grain.
  const plateCount=low?8:33;
  for(let i=0;i<plateCount;i++){
    const u=.04+rnd()*.88,t=.03+rnd()*.78,w=.015+rnd()*.055,h=.025+rnd()*.13;
    const p=(du,dt,r)=>[edge(u+du,t+dt,r),[u+du,t+dt]];
    const a=p(0,0,.0004),b=p(w,.01,.001),c=p(w*.85,h,.003+rnd()*.003),d=p(-w*.18,h*.64,.002);
    triangle(flakes,a,b,c);triangle(flakes,a,c,d);
  }
  for(let i=0;i<(low?3:10);i++){
    const t=i%2,side=i%3?0:1,u=.2+rnd()*.72;
    const a=cleft(u,t,side),b=cleft(u+.04,t,side),tip=a.clone();
    tip.z+=(t?1:-1)*(.006+rnd()*.025);tip.y+=.001;
    const verts=[[a,[u,t]],[b,[u+.04,t]],[tip,[u,t?.96:.04]]];
    triangle(fibres,...verts);triangle(fibres,verts[1],verts[0],verts[2]);
  }
  // A snapped lateral branch on the top billet breaks its long outline.
  if (spec.branch) {
    const u=.48, a=angle(u), root=edge(u,.67,-.008);
    const axis=V(Math.cos(a),Math.sin(a),.67).normalize();
    const across=V(-Math.sin(a),Math.cos(a),0);
    const up=axis.clone().cross(across).normalize();
    const around=low?8:14, rings=[];
    for (let j=0;j<4;j++) {
      const t=j/3, ring=[];
      for(let i=0;i<=around;i++){
        const theta=i/around*TAU, radius=(.027-.011*t)*(1+.09*Math.cos(theta*3));
        const snapped=j===3?.0018*Math.sin(theta*5+.4):0;
        const q=root.clone().addScaledVector(axis,.076*t+snapped)
          .addScaledVector(across,Math.cos(theta)*radius+.006*t*t)
          .addScaledVector(up,Math.sin(theta)*radius);
        ring.push(q);
      }
      rings.push(ring);
    }
    for(let j=0;j<3;j++)for(let i=0;i<around;i++){
      const get=(i,j)=>[rings[j][i],[i/around*.48,j/3*.32]];
      triangle(bark,get(i,j),get(i+1,j),get(i+1,j+1));
      triangle(bark,get(i,j),get(i+1,j+1),get(i,j+1));
    }
    const cap=root.clone().addScaledVector(axis,.076).addScaledVector(across,.006);
    const endVertex=i=>[rings[3][i],[.5+.20*Math.cos(i/around*TAU),.5+.20*Math.sin(i/around*TAU)]];
    for(let i=0;i<around;i++)triangle(cut,[cap,[.5,.5]],endVertex(i),endVertex(i+1));
  }
  const skin=spec.charred?mats.char:mats.bark;
  return [[geometry(bark,true),skin],[geometry(split,true),mats.split],[geometry(cut,true),mats.end],
    [geometry(flakes),skin],[geometry(fibres),mats.split]];
}


// Rasterize only the small stack footprint at construction time. Each new billet
// rests on the already-built grate/wood. No runtime physics or frame updates.
function stackFirewood(scope, mats, low, grateTop) {
  const step=.005, nx=106, nz=216, ox=-.67, oz=-.54, count=nx*nz;
  const top=new Float32Array(count).fill(.087);
  for(let j=0;j<nz;j++) for(let i=0;i<nx;i++){
    const x=ox+i*step,z=oz+j*step;
    if(x>=-.602 && x<=-.18 && Math.abs(Math.abs(z)-.266)<.016)top[j*nx+i]=grateTop;
  }
  const bottom=new Float32Array(count), crown=new Float32Array(count);
  const specs=[
    {x:-.258,z:-.018,yaw:.028,roll:-.025,length:.84,radius:.083,arc:172,seed:915,charred:true},
    {x:-.481,z:.016,yaw:-.052,roll:.17,length:.79,radius:.073,arc:194,seed:747,charred:false},
    {x:-.398,z:-.217,yaw:-1.35,roll:.30,length:.40,radius:.070,arc:157,seed:303,charred:true},
    {x:-.405,z:.203,yaw:-1.82,roll:-.37,length:.405,radius:.073,arc:187,seed:422,charred:false},
    {x:-.386,z:.012,yaw:.32,roll:1.04,length:.64,radius:.061,arc:146,seed:586,charred:true,branch:true},
  ];
  for(const spec of specs){
    const parts=hewLog(spec,mats,low);
    const matrix=new THREE.Matrix4(), quat=new THREE.Quaternion(), scale=V(1,1,1);
    const a=V(0,0,0),b=V(0,0,0),c=V(0,0,0);
    let pitch=0, lift=0;
    for(let iteration=0;iteration<4;iteration++){
      quat.setFromEuler(new THREE.Euler(pitch,spec.yaw,spec.roll,'YXZ'));
      matrix.compose(V(spec.x,0,spec.z),quat,scale);
      bottom.fill(Infinity);crown.fill(-Infinity);
      for(const [g] of parts.slice(0,3)){
        const pos=g.attributes.position;
        for(let k=0;k<pos.count;k+=3){
          a.fromBufferAttribute(pos,k).applyMatrix4(matrix);b.fromBufferAttribute(pos,k+1).applyMatrix4(matrix);c.fromBufferAttribute(pos,k+2).applyMatrix4(matrix);
          const bx=b.x-a.x,bz=b.z-a.z,cx=c.x-a.x,cz=c.z-a.z,det=bx*cz-cx*bz;
          if(Math.abs(det)<1e-10)continue;
          const imin=Math.max(0,Math.ceil((Math.min(a.x,b.x,c.x)-ox)/step)),imax=Math.min(nx-1,Math.floor((Math.max(a.x,b.x,c.x)-ox)/step));
          const jmin=Math.max(0,Math.ceil((Math.min(a.z,b.z,c.z)-oz)/step)),jmax=Math.min(nz-1,Math.floor((Math.max(a.z,b.z,c.z)-oz)/step));
          for(let j=jmin;j<=jmax;j++)for(let i=imin;i<=imax;i++){
            const dx=ox+i*step-a.x,dz=oz+j*step-a.z,u=(dx*cz-cx*dz)/det,v=(bx*dz-dx*bz)/det;
            if(u<0||v<0||u+v>1)continue;
            const y=a.y+u*(b.y-a.y)+v*(c.y-a.y), idx=j*nx+i;
            bottom[idx]=Math.min(bottom[idx],y);crown[idx]=Math.max(crown[idx],y);
          }
        }
      }
      let left=-Infinity,right=-Infinity,leftAt=0,rightAt=0;
      lift=-Infinity;
      for(let n=0;n<count;n++){
        if(!Number.isFinite(bottom[n]))continue;
        const along=(ox+n%nx*step-spec.x)*Math.sin(spec.yaw)+(oz+Math.floor(n/nx)*step-spec.z)*Math.cos(spec.yaw);
        const gap=top[n]-bottom[n];
        lift=Math.max(lift,gap);
        if(along<-.055 && gap>left){left=gap;leftAt=along;}
        if(along>.055 && gap>right){right=gap;rightAt=along;}
      }
      if(iteration===3||Math.abs(right-left)<.001)break;
      pitch=THREE.MathUtils.clamp(pitch-(right-left)/(rightAt-leftAt),-.24,.24);
    }
    for(let n=0;n<count;n++)if(Number.isFinite(crown[n]))top[n]=Math.max(top[n],crown[n]+lift);
    matrix.setPosition(spec.x,lift,spec.z);
    for(const [g,mat] of parts)scope.put(mat,g.applyMatrix4(matrix));
  }
}

function firebrickLining(scope, low) {
  const rnd=mulberry32(186), bw=.192,bh=.084;
  const grit=canvasTexture(128,128,(ctx,w,h)=>{
    ctx.fillStyle='#d1c7bc';ctx.fillRect(0,0,w,h);
    for(let i=0;i<4000;i++){
      ctx.fillStyle=rnd()>.52?'rgba(84,70,59,.23)':'rgba(248,237,216,.25)';
      ctx.fillRect(rnd()*w,rnd()*h,1+rnd()*2,1);
    }
  },{anisotropy:4});
  const brick = new THREE.MeshStandardMaterial({map:grit,bumpMap:grit,bumpScale:.0007,vertexColors:true,roughness:1});
  function place(w,h,d,x,y,z){
    const g=new RoundedBoxGeometry(w,h,d,low?1:2,.003);
    const pos=g.attributes.position,colors=new Float32Array(pos.count*3);
    // Soot lies heaviest over the flame path and the upper throat.
    const tone=new THREE.Color().setHex(rnd()>.55?0x665248:0x70584a);
    const mottling=.82+rnd()*.25;
    for(let i=0;i<pos.count;i++){
      const height=y+pos.getY(i), lateral=z+pos.getZ(i);
      const soot=(.24+.70*Math.exp(-lateral*lateral/.13))*THREE.MathUtils.smoothstep(height,.27,1.05);
      tone.toArray(colors,3*i);
      for(let k=0;k<3;k++)colors[3*i+k]*=mottling*(1-soot*.80);
    }
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));
    scope.put(brick,g,{p:[x,y,z]});
  }
  for(let r=0;r<15;r++){
    const y=.096+(r+.5)*bh;
    for(let start=-.55-(r%2)*bw*.5;start<.55;start+=bw){
      const l=Math.max(start,-.55),h=Math.min(start+bw,.55);
      if(h-l>.012)place(.022,bh-.004,h-l-.004,-.157,y,(l+h)/2);
    }
    for(const side of [-1,1]){
      for(let start=-.689-((r+1)%2)*bw*.5;start<-.168;start+=bw){
        const l=Math.max(start,-.689),h=Math.min(start+bw,-.168);
        if(h-l>.012)place(h-l-.004,bh-.004,.017,(l+h)/2,y,side*.551);
      }
    }
  }
}

export function buildFirebed(scope, quality) {
  const low=quality==='low', rnd=mulberry32(2147), size=low?256:512;
  const mats=woodMaps(size);
  const iron=new THREE.MeshStandardMaterial({color:0x302e2a,metalness:.6,roughness:.82});
  const ashMap=canvasTexture(size,size,(ctx,w,h)=>{
    ctx.fillStyle='#58514b';ctx.fillRect(0,0,w,h);
    for(let i=0;i<13500;i++){
      const c=rnd();ctx.fillStyle=c>.81?'#a39b8c':c>.52?'#746e63':c>.24?'#403b37':'#302c29';
      ctx.fillRect(rnd()*w,rnd()*h,1+rnd()*4,1+rnd()*2);
    }
  },{anisotropy:4});
  const ash=new THREE.MeshStandardMaterial({color:0xbabcc0,map:ashMap,bumpMap:ashMap,bumpScale:.0015,roughness:1});
  firebrickLining(scope,low);
  scope.put(ash,new RoundedBoxGeometry(.474,.021,1.067,2,.009),{p:[-.402,.077,0]});
  const coal=new THREE.MeshStandardMaterial({color:0x37322e,roughness:1});
  const cinder=new THREE.MeshStandardMaterial({color:0x534b41,emissive:0xff9c41,
    map:mats.char.map,emissiveMap:mats.char.emissiveMap,emissiveIntensity:2.7,roughness:1});
  for(let i=0;i<(low?27:78);i++){
    const x=-.178-rnd()*.435,z=(rnd()-.5)*.995,r=.006+rnd()*.017;
    const hot=Math.abs(z)<.37 && x>-.53 && rnd()>.48;
    scope.put(hot?cinder:coal,new THREE.IcosahedronGeometry(1,0),{
      p:[x,.089+r*.24,z],s:[r*(.7+rnd()),r*.46,r],r:[rnd()*.5,rnd()*TAU,rnd()*.35]});
  }
  // Forged andirons stand on the hearthstone, with turned-up front stops.
  const grateTop=.160;
  for(const z of [-.266,.266]){
    scope.put(iron,new RoundedBoxGeometry(.438,.027,.032,2,.004),{p:[-.389,grateTop-.0135,z]});
    for(const x of [-.576,-.206])scope.put(iron,new THREE.BoxGeometry(.026,.079,.029),{p:[x,.1095,z]});
    const pts=[V(-.577,.146,z),V(-.613,.157,z),V(-.625,.191,z),V(-.627,.239,z)];
    scope.put(iron,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),12,.010,7,false));
    scope.put(iron,new THREE.SphereGeometry(.017,10,8),{p:[-.627,.248,z]});
  }
  stackFirewood(scope,mats,low,grateTop);
  return mats;
}

export function addSpareFirewood(scope, wood) {
  const stack = [
    [-.088,.056,.022,-.18,-.29,.332,.050],
    [.068,.059,.020,-.30,.12,.345,.055],
    [-.014,.115,-.006,-.24,.84,.352,.054],
    [.073,.148,.026,1.10,-.16,.283,.048],
    [.055,.173,.038,.53,.62,.357,.055],
    [-.047,.219,-.010,.91,1.15,.344,.053],
  ];
  const freshWood = {...wood,end:wood.spareEnd};
  for(const [i,[x,y,z,yaw,roll,length,radius]] of stack.entries()) {
    const spec={length,radius,arc:159+i*11,seed:841+39*i,charred:false};
    const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(.045*(i-2),yaw,roll,'YXZ'));
    for(const [geometry,material] of hewLog(spec,freshWood,true)){
      scope.put(material,geometry.applyQuaternion(rotation),{p:[x,y,z]});
    }
  }
}
