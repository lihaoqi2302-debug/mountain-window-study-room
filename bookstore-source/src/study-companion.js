import * as THREE from 'three';
import { TABLE } from './room-layout.js';
import { SEATS } from './seating.js';

const protocol = 'mountain-window/scene-2';
const earth = 'earth-online';
const guide = 'undergrad-guide';
const visitor = { name:'读者' };

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeGuide() {
  const group = new THREE.Group();
  group.name = 'book_undergrad_guide';
  group.userData.interaction = 'study-guide';
  group.position.set(TABLE.x + .54, TABLE.top + .015, TABLE.z + .13);
  group.rotation.y = -.20;
  const cloth = new THREE.MeshStandardMaterial({color:0x594634,roughness:.93});
  const paper = new THREE.MeshStandardMaterial({color:0xc7b899,roughness:.96});
  const dimensions = [.116,.163];
  for (const [w,h,d,y,material] of [
    [dimensions[0],.003,dimensions[1],.010,cloth],
    [.108,.018,.152,0,paper],
    [dimensions[0],.003,dimensions[1],-.010,cloth],
  ]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
    mesh.position.y = y;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const map = canvasTexture(256,384,ctx=>{
    ctx.fillStyle='#574634';ctx.fillRect(0,0,256,384);
    ctx.strokeStyle='#b1966d';ctx.lineWidth=2;ctx.strokeRect(13,14,230,356);
    ctx.fillStyle='#e2c89c';ctx.textAlign='center';ctx.font='35px serif';
    ctx.fillText('本科生',128,154);ctx.fillText('速通指南',128,214);
    ctx.fillRect(97,273,62,2);
  });
  map.anisotropy = 4;
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(...dimensions),new THREE.MeshStandardMaterial({map,roughness:.92}));
  cover.position.y = .0117;
  cover.rotation.x = -Math.PI/2;
  cover.receiveShadow = true;
  group.add(cover);
  return group;
}

function makeAvatar(bodyGeometry, headGeometry, earGeometry) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({color:0x788fa9,roughness:.88});
  const face = new THREE.MeshStandardMaterial({color:0xcbb393,roughness:.96});
  const torso = new THREE.Mesh(bodyGeometry,cloth);
  torso.position.y=.27;
  const head = new THREE.Mesh(headGeometry,face);
  head.position.y=.63;
  body.add(torso,head);
  for(const side of [-1,1]){
    const ear = new THREE.Mesh(earGeometry,cloth);
    ear.position.set(side*.083,.758,0);
    ear.rotation.z=-side*.24;
    body.add(ear);
  }
  const label = new THREE.Sprite(new THREE.SpriteMaterial({depthWrite:false,transparent:true,toneMapped:false}));
  label.scale.set(.56,.137,1);
  label.position.y=.92;
  root.add(body,label);
  return {root,body,label,cloth,face,pose:null,profile:null};
}

function updateLabel(avatar, profile) {
  if (avatar.profile === profile) return;
  const { label, cloth } = avatar;
  avatar.profile = profile;
  cloth.color.set(profile?.color ?? '#788fa9');
  label.material.map?.dispose();
  label.material.map=canvasTexture(352,86,ctx=>{
    ctx.fillStyle='rgba(29,23,18,.88)';ctx.beginPath();ctx.roundRect(3,3,346,80,9);ctx.fill();
    ctx.strokeStyle='rgba(194,151,87,.73)';ctx.lineWidth=2;ctx.stroke();
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#f0dec0';
    const book = profile?.book === earth ? '地球 Online' : profile?.book === guide ? '本科生速通指南' : '';
    const activity = book ? `阅读《${book}》` : profile?.activity === '随意逛逛' ? '' : profile?.activity;
    ctx.font='26px sans-serif';ctx.fillText(profile?.name || '读者',176,activity?28:43,320);
    if(activity){ctx.font='21px sans-serif';ctx.fillStyle='#dac49e';ctx.fillText(activity,176,61,320);}
  });
  label.material.needsUpdate=true;
}

export function installStudyCompanion({ scene, room, getState, getWalker, getChapter, updateReadingLayout, setEnvironment, openEarth, prepareGuide }) {
  if (window.parent === window || !/^https?:$/.test(location.protocol)) return null;
  const target = location.origin;
  const send = (type, data = {}) => parent.postMessage({ protocol, type, ...data }, target);
  const guideBook = makeGuide();
  room.root.add(guideBook);
  const remoteRoot = new THREE.Group();
  remoteRoot.name = 'study-companions';
  scene.add(remoteRoot);
  const bodyGeometry = new THREE.CapsuleGeometry(.148,.24,4,14);
  const headGeometry = new THREE.SphereGeometry(.136,16,12);
  const earGeometry = new THREE.ConeGeometry(.058,.119,4);
  const avatars = new Map();

  const request = document.createElement('button');
  request.id = 'btnStudyCompanions';
  request.type = 'button';
  request.className = 'chip';
  request.setAttribute('aria-label','共学房间');
  request.innerHTML = '<span class="chip__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="8" r="3"/><path d="M3 19v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m1-14a3 3 0 0 1 0 6m5 8v-2a4 4 0 0 0-3-3.9"/></svg></span><span class="chip__label">共学</span>';
  async function reveal(type, details) {
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* The browser may already have exited. */ }
    }
    send(type,details);
  }
  request.addEventListener('click',()=>void reveal('panel'));
  document.querySelector('#roomTools').append(request);
  const noteButton=document.createElement('button');
  noteButton.id='btnStudyNotes';
  noteButton.type='button';
  noteButton.hidden=true;
  noteButton.textContent='便签';
  noteButton.setAttribute('aria-label','章节便签');
  noteButton.addEventListener('click',()=>{
    const chapter=getChapter();
    if(chapter)void reveal('notes',{chapter});
  });
  document.querySelector('#readCameraTools').append(noteButton);
  const scenePanels = Array.from(document.querySelectorAll('#tocPanel, #musicPanel, #helpPanel, #sceneryPanel, #shelfInspection'));
  const roomTools = document.querySelector('#roomTools');
  let covered, reading;
  function announcePanel(force = false) {
    const next = scenePanels.some((panel) => !panel.hidden) || roomTools.classList.contains('is-open');
    const nextReading = document.body.dataset.mode === 'reading';
    if (force || covered !== next || reading !== nextReading) {
      covered = next;
      reading = nextReading;
      send('scene-panel', { covered, reading });
    }
  }
  const panelObserver = new MutationObserver(() => announcePanel());
  for (const panel of scenePanels) panelObserver.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  panelObserver.observe(roomTools, { attributes: true, attributeFilter: ['class'] });
  panelObserver.observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });

  window.addEventListener('message', ({ source, origin, data }) => {
    if (source !== parent || origin !== target || data?.protocol !== protocol) return;
    if (data.type === 'ready-check') {
      send('ready');
      announcePanel(true);
    } else if (data.type === 'environment') {
      const value=data.value;
      if(value===null||typeof value?.hearth==='boolean'&&['dusk','day','rain','snow'].includes(value.weather))setEnvironment(value);
    } else if (data.type === 'open-book') {
      if (data.id === earth) openEarth();
      else if (data.id === guide) openGuide();
    } else if (data.type === 'peers') {
      const peers = Array.isArray(data.peers) ? data.peers : [];
      const ids = new Set(peers.map(peer => peer.id));
      for (const [id, avatar] of avatars) {
        if (ids.has(id)) continue;
        avatar.root.removeFromParent();
        avatar.label.material.map?.dispose();
        avatar.label.material.dispose();
        avatar.cloth.dispose();
        avatar.face.dispose();
        avatars.delete(id);
      }
      for (const { id, pose, profile = visitor } of peers) {
        if (!pose) continue;
        let avatar = avatars.get(id);
        if (!avatar) {
          avatar = makeAvatar(bodyGeometry,headGeometry,earGeometry);
          remoteRoot.add(avatar.root);
          avatars.set(id,avatar);
        }
        if (!avatar.pose || avatar.pose.seat !== pose.seat ||
            Math.hypot(avatar.root.position.x-pose.x,avatar.root.position.z-pose.z) > 1.45) {
          avatar.root.position.set(pose.x,pose.y ?? .05,pose.z);
          avatar.root.rotation.y = pose.yaw;
        }
        avatar.pose = pose;
        const prior = avatar.profile, incoming = profile || visitor;
        if (!avatar.label.material.map || prior?.name !== incoming.name || prior?.color !== incoming.color
            || prior?.activity !== incoming.activity || prior?.book !== incoming.book) {
          updateLabel(avatar,incoming);
        }
      }
    }
  });

  // Keep arrivals on the open rug in front of the table, within both home camera framings.
  let standing = { x:-.65+Math.random()*1.07,y:.05,z:.49+Math.random()*.46,yaw:Math.PI };
  let previousPose, previousBook, lastSample = 0;
  function openGuide() {
    if (prepareGuide()) void reveal('read-guide');
  }

  function update(dt, now) {
    const state = getState();
    const canAnnotate=state.mode==='reading'&&!state.pdfMode;
    if(noteButton.hidden===canAnnotate){
      noteButton.hidden=!canAnnotate;
      updateReadingLayout();
    }
    const book = (state.mode === 'reading' || document.body.dataset.mode === 'reading') && !state.pdfMode ? earth : null;
    if (book !== previousBook) { previousBook = book; send('reading', {id:book}); }
    if (now - lastSample >= 40) {
      lastSample = now;
      let pose = standing;
      const walker = getWalker();
      if (state.locomotion === 'walk' && walker) {
        const {x,y,z} = walker.position, direction = walker.direction;
        pose = standing = { x,y:y-1.62,z,yaw:Math.atan2(direction.x,direction.z) };
      } else if (state.locomotion === 'seated' && SEATS[state.seatId]) {
        const seat = SEATS[state.seatId], [x,,z] = seat.eye;
        pose = { x,y:.43,z,
          yaw:Math.atan2(seat.look[0]-x,seat.look[2]-z),seat:state.seatId };
      }
      if (!previousPose || pose.seat !== previousPose.seat || ['x','y','z','yaw'].some(key=>Math.abs(pose[key]-previousPose[key])>.001)) {
        previousPose = pose;
        send('pose',{pose});
      }
    }
    const alpha = state.reducedMotion ? 1 : 1 - Math.exp(-dt * 16);
    for (const {root,body,label,pose} of avatars.values()) {
      root.position.x = THREE.MathUtils.lerp(root.position.x,pose.x,alpha);
      root.position.y = THREE.MathUtils.lerp(root.position.y,pose.y ?? .05,alpha);
      root.position.z = THREE.MathUtils.lerp(root.position.z,pose.z,alpha);
      const delta = pose.yaw-root.rotation.y;
      root.rotation.y += Math.atan2(Math.sin(delta),Math.cos(delta))*alpha;
      body.scale.y = pose.seat ? .73 : 1;
      label.position.y = pose.seat ? .68 : .92;
    }
  }
  send('ready');
  announcePanel(true);
  return { guideBook, openGuide, update };
}
