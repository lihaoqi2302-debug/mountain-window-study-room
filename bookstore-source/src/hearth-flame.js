import * as THREE from 'three';

// A small tileable 3D field provides continuous eddies from every viewing angle.
function flowTexture() {
  const size=32, values=new Uint8Array(size**3);
  let seed=8401;
  const lattices=[4,8,16].map(n=>{
    const grid=new Float32Array(n**3);
    for(let i=0;i<grid.length;i++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      grid[i]=seed/4294967296;
    }
    return {n,grid};
  });
  function sample({n,grid},x,y,z) {
    const coords=[x,y,z].map(v=>v*n/size);
    const [i,j,k]=coords.map(Math.floor);
    const [u,v,w]=coords.map(t=>THREE.MathUtils.smoothstep(t-Math.floor(t),0,1));
    const at=(a,b,c)=>grid[(a%n)+n*((b%n)+n*(c%n))];
    const row=(b,c)=>THREE.MathUtils.lerp(at(i,b,c),at(i+1,b,c),u);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(row(j,k),row(j+1,k),v),
      THREE.MathUtils.lerp(row(j,k+1),row(j+1,k+1),v),w);
  }
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    values[x+size*(y+size*z)]=Math.round(255*(.57*sample(lattices[0],x,y,z)
      +.29*sample(lattices[1],x,y,z)+.14*sample(lattices[2],x,y,z)));
  }
  const texture=new THREE.Data3DTexture(values,size,size,size);
  texture.format=THREE.RedFormat;
  texture.minFilter=texture.magFilter=THREE.LinearFilter;
  texture.wrapS=texture.wrapT=texture.wrapR=THREE.RepeatWrapping;
  texture.needsUpdate=true;
  return texture;
}

// Integrate an emissive 3D density field in thin sections. Each section depth-tests
// against the real wood, so a log can hide the rear tongues and still be lit in front.
export function createHearthFlame(quality) {
  if (quality === 'low') return createLightFlame();
  const sections = quality === 'high' ? 48 : 30;
  const half = new THREE.Vector3(.215,.37,.414);
  const quad = new THREE.PlaneGeometry(1,1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(quad.index);
  geometry.setAttribute('position',quad.attributes.position);
  const depths = Float32Array.from({length:sections}, (_,i) => (i+.5)/sections);
  geometry.setAttribute('section',new THREE.InstancedBufferAttribute(depths,1));
  geometry.instanceCount = sections;
  geometry.boundingBox = new THREE.Box3(half.clone().negate(),half.clone());
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(),half.length());
  const flow = flowTexture();
  const material = new THREE.ShaderMaterial({
    transparent:true, depthTest:true, depthWrite:false, blending:THREE.AdditiveBlending,
    side:THREE.DoubleSide, forceSinglePass:true,
    uniforms:{halfSize:{value:half}, time:{value:0}, strength:{value:1}, sections:{value:sections},flow:{value:flow}},
    vertexShader:`
      attribute float section;
      uniform vec3 halfSize;
      uniform float sections;
      varying vec3 p;
      varying float thickness;
      void main() {
        vec3 center = modelMatrix[3].xyz;
        vec3 view = normalize(cameraPosition-center);
        vec3 guide = abs(view.y)>.98 ? vec3(0.,0.,1.) : vec3(0.,1.,0.);
        vec3 right = normalize(cross(guide,view));
        vec3 up = cross(view,right);
        float depth = dot(abs(view),halfSize);
        p = 2. * position.x * dot(abs(right),halfSize) * right
          + 2. * position.y * dot(abs(up),halfSize) * up + (2.*section-1.)*depth*view;
        thickness = 2.*depth/sections;
        gl_Position = projectionMatrix * viewMatrix * vec4(center+p,1.);
      }`,
    fragmentShader:`
      uniform vec3 halfSize;
      uniform float time;
      uniform float strength;
      uniform highp sampler3D flow;
      varying vec3 p;
      varying float thickness;
      // A plume rises from a fixed gap in the fuel. Its neck curls in both
      // horizontal axes while the disturbance travels upward through it.
      vec2 plume(vec2 xz, float h, vec2 root, float tall, vec2 radius, float seed) {
        float t = h / tall;
        float tip = 1. + .065*sin(time*2.6+seed) + .034*sin(time*4.1+2.*seed);
        if(t >= tip || t<=0.) return vec2(0.);
        float phase = t*7.2 - time*3.3 + seed;
        vec2 bend = t * vec2(.037*sin(phase)+.019*cos(phase*1.73+seed),
                             .052*cos(phase*.87)+.026*sin(phase*1.38-seed));
        vec2 xy = (xz-root-bend) / radius;
        float width = pow(max(.001,1.-t/tip),.68) * (.74+.24*sin(3.14*min(t*2.,1.)));
        float d = length(xy) / max(width,.035);
        float envelope = (1.-smoothstep(.43,1.12,d)) * smoothstep(0.,.10,t) * smoothstep(0.,.14,tip-t);
        // More emission on the outer reaction zone above the hotter root.
        float folds = .83+.17*sin(phase*1.9+4.*xy.x-3.*xy.y);
        float shell = mix(1., .48+.52*smoothstep(.2,.72,d), smoothstep(.12,.6,t));
        float density = envelope*folds*shell;
        float heat = clamp(1.06-.78*t-.21*d,0.,1.);
        return vec2(density,density*heat);
      }
      void main() {
        if(any(greaterThan(abs(p),halfSize))) discard;
        float h=p.y+halfSize.y;
        vec3 uvw=p*vec3(2.0,1.45,1.9)+vec3(.038*time,-.49*time,.025*time);
        float swirl=texture(flow,uvw).r-.5;
        float curl=texture(flow,uvw+vec3(.34,.18,.61)).r-.5;
        vec2 fuel=p.xz+vec2(swirl,curl)*(.020+.15*h);
        h+=swirl*(.015+.055*h);
        vec2 flame=plume(fuel,h,vec2(-.094,-.178),.46,vec2(.071,.096),1.1)
          +plume(fuel,h,vec2(.055,-.08),.69,vec2(.094,.132),3.2)
          +plume(fuel,h,vec2(-.013,.106),.57,vec2(.083,.112),5.4)
          +plume(fuel,h,vec2(.093,.252),.45,vec2(.066,.086),.6)
          +plume(fuel,h,vec2(-.128,.025),.32,vec2(.05,.086),7.8);
        if(flame.x<.003) discard;
        float heat=clamp(flame.y/flame.x+.32*swirl,0.,1.);
        flame.x*=mix(1.,smoothstep(-.24,.21,curl+.46*swirl)*1.42,smoothstep(.08,.48,h));
        vec3 ember=vec3(1.19,.123,.012), amber=vec3(1.78,.63,.065), core=vec3(2.4,1.55,.59);
        vec3 light=mix(ember,amber,smoothstep(.1,.77,heat));
        light=mix(light,core,smoothstep(.68,.98,heat));
        gl_FragColor=vec4(light * strength, 1.-exp(-thickness*flame.x*10.5));
      }`,
  });
  material.addEventListener('dispose',()=>flow.dispose());
  const volume = new THREE.Mesh(geometry,material);
  volume.name = 'fireplace:flame-volume';
  volume.position.set(-.37,.524,0);
  volume.raycast = () => {};
  return volume;
}

function createLightFlame() {
  const geometry = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry();
  geometry.copy(plane);
  plane.dispose();
  const layers = [
    -.08, -.13, .39, .03, .05, -.03, .62, 1.42,
    -.02, .10, .53, .67, .09, .22, .37, 2.16,
    -.10, .01, .30, 1.19, .03, -.04, .57, 2.51,
  ];
  geometry.setAttribute('flame', new THREE.InstancedBufferAttribute(new Float32Array(layers), 4));
  geometry.instanceCount = layers.length / 4;
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    forceSinglePass: true, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, strength: { value: 1 } },
    vertexShader: `
      attribute vec4 flame;
      varying vec2 p;
      varying float seed;
      void main() {
        p=uv;
        seed=flame.w*2.4+flame.z*11.;
        float x=position.x*.34;
        vec3 point=vec3(flame.x+cos(flame.w)*x, -.32+uv.y*flame.z, flame.y+sin(flame.w)*x);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.);
      }`,
    fragmentShader: `
      uniform float time, strength;
      varying vec2 p;
      varying float seed;
      void main() {
        float phase=seed+8.*p.y-3.1*time;
        float h=p.y/(.88+.085*sin(phase)+.055*sin(phase*1.7));
        float x=abs(p.x-.5-h*(.11*sin(phase)+.040*cos(phase*2.1)));
        float width=.32*pow(max(0.,1.-h),.71)+.012;
        float alpha=(1.-smoothstep(width*.38,width,x))*smoothstep(0.,.10,h)*(1.-smoothstep(.72,1.,h));
        vec3 amber=vec3(1.65,.49,.045), gold=vec3(2.25,1.2,.34);
        gl_FragColor=vec4(mix(amber,gold,(1.-h)*clamp(1.-x/(width+.01),0.,1.))*strength,alpha*.46);
      }`,
  });
  const flame = new THREE.Mesh(geometry, material);
  flame.position.set(-.37,.524,0);
  flame.frustumCulled = false;
  flame.name = 'fireplace:flame-lightweight';
  flame.raycast = () => {};
  return flame;
}
