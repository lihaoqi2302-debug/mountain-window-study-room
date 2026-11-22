import { useEffect } from 'react'
import { Box3, Vector3 } from 'three'
import type { Group, Mesh, Object3D } from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { ThreeEvent } from '@react-three/fiber'
import type { Pose, Seat } from '../store/useStudyRoomStore'
import { useStudyRoomStore } from '../store/useStudyRoomStore'

export type Layout = {
  bounds: Box3
  obstacles: Box3[]
  spawn: Pose
  camera?: { position: Vector3; target: Vector3 }
}

export type LoadedRoom = { scene: Group; layout: Layout; seats: Partial<Record<Seat, Pose>> }
export type ModelLoadState = { progress: number | null } | { room: LoadedRoom } | null
const actions: Record<string, string> = {
  book_earth_online: 'earth-online',
  book_undergrad_guide: 'undergrad-guide',
  seat_sofa: 'sofa',
  seat_desk: 'desk',
}

async function readModel(response: Response, report: (value: ModelLoadState) => void) {
  const length = Number(response.headers.get('content-length'))
  if (!response.body || !length || response.headers.has('content-encoding')) {
    report({ progress: null })
    return response.arrayBuffer()
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    report({ progress: Math.min(.99, received / length) })
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes.buffer
}

function makeLayout(scene: Group): LoadedRoom {
  const boundsMarker = scene.getObjectByName('room_bounds')
  const bounds = new Box3().setFromObject(boundsMarker ?? scene)
  if (bounds.isEmpty()) throw new Error('The GLB has no room geometry.')
  const center = bounds.getCenter(new Vector3())
  const offset = new Vector3(-center.x, -bounds.min.y, -center.z)
  scene.position.add(offset)
  scene.updateMatrixWorld(true)
  bounds.translate(offset)

  const obstacles: Box3[] = []
  scene.traverse((object) => {
    if (object.name.startsWith('collision_')) {
      const box = new Box3().setFromObject(object)
      if (!box.isEmpty()) obstacles.push(box)
      object.visible = false
    }
    const mesh = object as Mesh
    if (mesh.isMesh) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
  })
  if (boundsMarker) boundsMarker.visible = false

  const dir = new Vector3()
  const anchor = (name: string): Pose | undefined => {
    const object = scene.getObjectByName(name)
    if (!object) return
    const { x, y, z } = object.getWorldPosition(new Vector3())
    object.getWorldDirection(dir)
    return { x, y, z, yaw: Math.atan2(dir.x, dir.z) }
  }
  const size = bounds.getSize(new Vector3())
  // This centered coordinate space is shared by all copies of the model.
  if (size.x < .6 || size.z < .6 || size.x > 62 || size.z > 62) throw new Error('The room must be modeled in meters.')
  const spawn = anchor('spawn_player') ?? { x: 0, y: 0, z: size.z * .28, yaw: Math.PI }
  const seats: LoadedRoom['seats'] = { sofa: anchor('seat_sofa'), desk: anchor('seat_desk') }
  const overview = scene.getObjectByName('camera_overview')
  const look = scene.getObjectByName('camera_target')
  const camera = overview ? {
    position: overview.getWorldPosition(new Vector3()),
    target: look?.getWorldPosition(new Vector3()) ?? new Vector3(0, size.y * .36, 0),
  } : undefined
  return { scene, layout: { bounds, obstacles, spawn, camera }, seats }
}

function disposeScene(scene: Group) {
  scene.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose()
      material.dispose()
    }
  })
}

export function useStudyRoomModel(report: (value: ModelLoadState) => void) {
  useEffect(() => {
    const controller = new AbortController()
    const model = new URL('models/study_room.glb', document.baseURI)
    const draco = new DRACOLoader().setDecoderPath(new URL('draco/', document.baseURI).href)
    let scene: Group | undefined
    const update = (value: ModelLoadState) => {
      if (!controller.signal.aborted) report(value)
    }
    void (async () => {
      try {
        const response = await fetch(model, { signal: controller.signal })
        if (!response.ok || response.headers.get('content-type')?.includes('text/html')) return
        const buffer = await readModel(response, update)
        if (buffer.byteLength < 12 || new DataView(buffer).getUint32(0, false) !== 0x676c5446) {
          update(null)
          return
        }
        update({ progress: null })
        const loaded = await new GLTFLoader().setDRACOLoader(draco).parseAsync(buffer, new URL('.', model).href)
        if (controller.signal.aborted) {
          disposeScene(loaded.scene)
          return
        }
        scene = loaded.scene
        update({ room: makeLayout(scene) })
      } catch {
        if (scene) { disposeScene(scene); scene = undefined }
        update(null)
      }
    })()
    return () => {
      controller.abort()
      draco.dispose()
      if (scene) disposeScene(scene)
    }
  }, [report])
}

export function StudyRoomModel({ room, openBook, sit }: {
  room: LoadedRoom; openBook: (id: string) => void; sit: (seat: Seat, pose: Pose) => void
}) {
  const { weather, hearth } = useStudyRoomStore((state) => state.environment)
  useEffect(() => {
    const fire = room.scene.getObjectByName('hearth_flame')
    if (fire) fire.visible = hearth
  }, [hearth, room])

  function activate(event: ThreeEvent<MouseEvent>) {
    for (let object: Object3D | null = event.object; object; object = object.parent) {
      const action = actions[object.name]
      if (!action) continue
      event.stopPropagation()
      if (action === 'sofa' || action === 'desk') {
        const pose = room.seats[action]
        if (pose) sit(action, pose)
      } else {
        openBook(action)
      }
      return
    }
  }
  return (
    <>
      <ambientLight color="#f3d8ba" intensity={1.15} />
      <hemisphereLight color={weather === 'rain' ? '#7c91b3' : weather === 'snow' ? '#c5dcf4' : '#b8c6e3'}
        groundColor="#584035" intensity={weather === 'day' ? 1.4 : 1} />
      <directionalLight color="#ffe2b6" position={[3, 7, 5]} intensity={2.1} />
      <primitive object={room.scene} onClick={activate} />
    </>
  )
}
