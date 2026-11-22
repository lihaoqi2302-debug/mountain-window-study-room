import { Component, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, RoundedBox } from '@react-three/drei'
import { Box3, Group, MathUtils, OrthographicCamera, Vector3 } from 'three'
import type { Vector3Tuple } from 'three'
import { useShallow } from 'zustand/react/shallow'
import books from '../data/books.json'
import { useStudyRoomStore } from '../store/useStudyRoomStore'
import type { Pose, Seat } from '../store/useStudyRoomStore'
import { readMovement } from './movement'
import { StudyRoomModel, useStudyRoomModel } from './StudyRoomModel'
import type { Layout, ModelLoadState } from './StudyRoomModel'
import type { RoomEnvironment } from '../studyContent'

const store = useStudyRoomStore
const wood = '#51392d'
const oak = '#7f5841'
const brass = '#aa8557'
const bookColors = ['#696b59', '#a08465', '#754c40', '#a3987b', '#665455', '#454e59']

const cameraPosition: Vector3Tuple = [7.6, 5.5, 9]
const cameraTarget: Vector3Tuple = [0, 0.9, -0.45]
const layout = {
  table: { x: 0.57, z: -0.18, w: 1.35, d: 0.77 },
  sofa: { x: 0.44, z: -1.39, w: 2.23, d: 0.78 },
  desk: { x: -1.94, z: -1.49, w: .82, d: .47 },
}
const fallback: Layout = {
  bounds: new Box3(new Vector3(-2.73,0,-2.13),new Vector3(3.1,2.9,2.24)),
  obstacles: Object.values(layout).map(({x,z,w,d}) =>
    new Box3(new Vector3(x-w/2,0,z-d/2),new Vector3(x+w/2,1,z+d/2)),
  ),
  spawn: store.getState().pose,
}

function SoftBox({ size, position, color, radius = 0.035 }: {
  size: Vector3Tuple; position: Vector3Tuple; color: string; radius?: number
}) {
  return (
    <RoundedBox args={size} position={position} radius={radius} smoothness={2} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.9} />
    </RoundedBox>
  )
}

function Box({ size, position, color, glow = false }: {
  size: Vector3Tuple; position: Vector3Tuple; color: string; glow?: boolean
}) {
  return (
    <mesh position={position} castShadow={!glow} receiveShadow={!glow}>
      <boxGeometry args={size} />
      {glow ? <meshBasicMaterial color={color} /> : <meshStandardMaterial color={color} roughness={0.9} />}
    </mesh>
  )
}

function Bookcase() {
  return (
    <group position={[2.24, 0, -2.28]}>
      <Box size={[1.43, 2.37, 0.1]} position={[0, 1.19, -0.17]} color="#3d2e26" />
      {[-0.73, 0.73].map((x) => <Box key={x} size={[0.09, 2.44, 0.48]} position={[x, 1.22, 0]} color={wood} />)}
      {[0.08, 0.61, 1.15, 1.69, 2.23].map((y, row) => (
        <group key={y} position={[0, y, 0]}>
          <Box size={[1.51, 0.065, 0.49]} position={[0, 0, 0]} color={oak} />
          {row < 4 && Array.from({ length: 12 }, (_, i) => {
            const height = 0.22 + 0.035 * ((row * 3 + i * 7) % 7)
            return <Box key={i} size={[0.085, height, 0.24]} position={[-0.6 + i * 0.11, 0.035 + height / 2, 0.09]} color={bookColors[(i * 5 + row) % bookColors.length]} />
          })}
        </group>
      ))}
    </group>
  )
}

function Window({ weather }: { weather: RoomEnvironment['weather'] }) {
  const sky = { dusk:'#66758b', day:'#a2b1b0', rain:'#4e6076', snow:'#a1b5d1' }[weather]
  return (
    <group position={[-1.38, 1.89, -2.415]}>
      <Box size={[2.66, 1.64, 0.09]} position={[0, 0, -0.017]} color={wood} />
      <Box size={[2.52, 1.5, 0.09]} position={[0, 0, 0.03]} color={sky} glow />
      <group position={[0, -0.38, 0.083]} scale={[1, 0.78, 0.05]}>
        <mesh position={[-0.6, 0, 0]}>
          <coneGeometry args={[0.59, 0.88, 4, 1]} />
          <meshBasicMaterial color="#a3acb4" />
        </mesh>
        <mesh position={[0.35, -0.025, 0.04]}>
          <coneGeometry args={[0.8, 0.83, 4, 1]} />
          <meshBasicMaterial color="#a7b0ba" />
        </mesh>
        <mesh position={[0.8, -0.19, 0.08]}>
          <coneGeometry args={[0.44, 0.49, 4, 1]} />
          <meshBasicMaterial color="#576b74" />
        </mesh>
      </group>
      {weather === 'rain' && Array.from({ length: 27 }, (_, index) => (
        <mesh key={index} position={[-1.17+index*.089,-.58+(index*13%19)*.061,.099]} rotation={[0,0,-.12]}>
          <planeGeometry args={[.009,.09+(index%5)*.026]} />
          <meshBasicMaterial color="#a3bad6" transparent opacity={.29} depthWrite={false} />
        </mesh>
      ))}
      <Box size={[0.04, 1.54, 0.055]} position={[0, 0, 0.11]} color={wood} />
      <Box size={[2.56, 0.04, 0.055]} position={[0, 0.04, 0.11]} color={wood} />
      <Box size={[2.83, 0.07, 0.25]} position={[0, -0.8, 0.105]} color={oak} />
    </group>
  )
}

function Fireplace({ lit }: { lit: boolean }) {
  return (
    <group position={[-2.77, 0, -0.49]} rotation={[0, Math.PI / 2, 0]}>
      <Box size={[1.28, 1.2, 0.32]} position={[0, 0.61, 0]} color="#413127" />
      <Box size={[1.43, 0.13, 0.59]} position={[0, 0.06, 0.15]} color="#7b6855" />
      {[-0.51, 0.51].map((x) => <Box key={x} size={[0.24, 1.14, 0.41]} position={[x, 0.61, 0.17]} color="#8c7561" />)}
      <Box size={[1.29, 0.25, 0.47]} position={[0, 1.08, 0.17]} color="#8c7561" />
      <SoftBox size={[1.44, 0.105, 0.55]} position={[0, 1.27, 0.17]} color={oak} />
      <pointLight position={[0, 0.32, 0.51]} color="#ff9e50" intensity={lit ? 7 : 0} distance={3.45} />
      {lit && [-0.23, -0.085, 0.08, 0.23].map((x, index) => (
        <mesh key={x} position={[x, 0.27 + index % 2 * 0.065, 0.24]} rotation={[0, 0.4, x * 0.4]}>
          <coneGeometry args={[0.13, 0.34 + index % 2 * 0.17, 5]} />
          <meshBasicMaterial color={index % 2 ? '#ffb662' : '#b95e35'} />
        </mesh>
      ))}
      <Box size={[0.67, 0.09, 0.13]} position={[0, 0.15, 0.35]} color="#492a20" />
    </group>
  )
}

function Room({ openBook, sit }: {
  openBook: (id: string) => void
  sit: (seat: Seat, pose: Pose) => void
}) {
  const { table, sofa, desk } = layout
  const environment = store((state) => state.environment)
  return (
    <>
      <ambientLight color="#edddd1" intensity={0.65} />
      <hemisphereLight args={['#a9bdd9', '#6e4d3b', 1.13]} />
      <directionalLight position={[3, 7, 5]} intensity={2.2} color="#ffe3be" castShadow
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0003} shadow-normalBias={0.025}
        shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={4} shadow-camera-bottom={-4} />
      <pointLight position={[-1.3, 2.06, -1.68]} color="#94b5e8" intensity={environment.weather==='day' ? 4.2 : 2.7} distance={4} />
      <Box size={[6.54, 0.24, 5.1]} position={[0, -0.19, -0.06]} color="#533a2d" />
      {Array.from({ length: 17 }, (_, index) => (
        <Box key={index} size={[0.374, 0.085, 4.98]} position={[-3.07 + index * 0.383, -0.043, -0.058]} color={['#815d48', '#785641', '#88634c'][index % 3]} />
      ))}
      <Box size={[6.46, 2.9, 0.15]} position={[0, 1.45, -2.55]} color="#928370" />
      <Box size={[0.16, 2.9, 4.99]} position={[-3.22, 1.45, -0.057]} color="#8a7764" />
      <Box size={[6.5, 0.12, 0.2]} position={[0, 2.89, -2.55]} color={wood} />
      <Box size={[0.2, 0.12, 5.08]} position={[-3.22, 2.89, -0.06]} color={wood} />
      <Box size={[6.24, 0.12, 0.07]} position={[0, 0.09, -2.44]} color={wood} />
      <Window weather={environment.weather} />
      <Bookcase />
      <Fireplace lit={environment.hearth} />
      <SoftBox size={[4.33, 0.028, 3.09]} position={[0.24, 0.011, -0.16]} color="#573638" />
      <Box size={[4.12, 0.008, 2.88]} position={[0.24, 0.027, -0.16]} color="#9c6a54" />
      <Box size={[3.98, 0.008, 2.74]} position={[0.24, 0.032, -0.16]} color="#6c4345" />
      <group name="seat_sofa" position={[sofa.x, 0, sofa.z]} onClick={(event) => {
        event.stopPropagation()
        sit('sofa', { x:sofa.x+.43, y:.53, z:sofa.z+.10, yaw:0 })
      }}>
        <SoftBox size={[2.22, 0.25, 0.78]} position={[0, 0.21, 0]} color="#685144" />
        <SoftBox size={[2.22, 0.67, 0.24]} position={[0, 0.61, -0.28]} color="#a1937a" radius={0.10} />
        {[-0.47, 0.47].map((x) => (
          <SoftBox key={x} size={[0.92, 0.19, 0.57]} position={[x, 0.43, 0.04]} color="#b4a38b" radius={0.075} />
        ))}
        {[-1, 1].map((direction) => (
          <SoftBox key={direction} size={[0.22, 0.37, 0.77]} position={[direction, 0.41, 0]} color="#756052" radius={0.095} />
        ))}
        <group position={[-0.67, 0.7, -0.17]} rotation={[0.17, 0, -0.21]}>
          <SoftBox size={[0.34, 0.34, 0.14]} position={[0, 0, 0]} color="#854e41" radius={0.066} />
        </group>
      </group>
      <group position={[desk.x, 0, desk.z]}>
        <SoftBox size={[desk.w, .07, desk.d]} position={[0,.63,0]} color={oak} />
        {[-.33,.33].flatMap((x) => [-.17,.17].map((z) => (
          <Box key={`${x}:${z}`} size={[.05,.61,.05]} position={[x,.3,z]} color={wood} />
        )))}
        <Box size={[.23,.02,.16]} position={[-.14,.675,0]} color="#ad9879" />
        <group name="seat_desk" position={[0,0,.47]} onClick={(event) => {
          event.stopPropagation()
          sit('desk', { x:desk.x,y:.34,z:desk.z+.47,yaw:Math.PI })
        }}>
          <SoftBox size={[.34,.08,.34]} position={[0,.30,0]} color="#7c7963" />
          <SoftBox size={[.34,.26,.075]} position={[0,.45,.16]} color="#7c7963" />
          {[-.13,.13].flatMap((x) => [-.13,.13].map((z) => (
            <Box key={`${x}:${z}`} size={[.036,.29,.036]} position={[x,.14,z]} color={wood} />
          )))}
        </group>
      </group>
      <group position={[table.x, 0, table.z]}>
        <SoftBox size={[table.w, 0.095, table.d]} position={[0, 0.46, 0]} color={oak} />
        {[-0.52, 0.52].flatMap((x) => [-0.27, 0.27].map((z) => (
          <Box key={`${x}:${z}`} size={[0.09, 0.42, 0.09]} position={[x, 0.22, z]} color={wood} />
        )))}
        <group position={[-0.21, 0.548, -0.065]} rotation={[0, 0.21, 0]} onClick={(event) => {
          event.stopPropagation()
          openBook('earth-online')
        }}>
          <Box size={[0.35, 0.037, 0.45]} position={[0, 0, 0]} color="#435369" />
          <Box size={[0.27, 0.012, 0.018]} position={[0, 0.021, -0.1]} color={brass} />
        </group>
        <group position={[0.2, 0.541, 0.095]} rotation={[0, -0.19, 0]} onClick={(event) => {
          event.stopPropagation()
          openBook('undergrad-guide')
        }}>
          <Box size={[0.33, 0.04, 0.36]} position={[0, 0, 0]} color="#927350" />
          <Box size={[0.23, 0.012, 0.017]} position={[0, 0.023, -0.08]} color="#bbab87" />
        </group>
        <mesh position={[0.42, 0.59, -0.16]} castShadow>
          <cylinderGeometry args={[0.075, 0.063, 0.15, 16]} />
          <meshStandardMaterial color="#ada195" roughness={0.82} />
        </mesh>
      </group>
      <group position={[2.73, 0, -1.38]}>
        <mesh position={[0, 0.038, 0]} receiveShadow>
          <cylinderGeometry args={[0.19, 0.2, 0.06, 16]} />
          <meshStandardMaterial color={brass} metalness={0.65} roughness={0.43} />
        </mesh>
        <mesh position={[0, 0.81, 0]}>
          <cylinderGeometry args={[0.022, 0.022, 1.59, 10]} />
          <meshStandardMaterial color={brass} metalness={0.6} roughness={0.46} />
        </mesh>
        <mesh position={[0, 1.67, 0]} castShadow>
          <cylinderGeometry args={[0.16, 0.27, 0.32, 20]} />
          <meshStandardMaterial color="#bfb08e" emissive="#ad7545" emissiveIntensity={0.37} roughness={0.85} />
        </mesh>
        <pointLight position={[0, 1.45, 0]} intensity={6} color="#ffd099" distance={3.2} />
      </group>
    </>
  )
}

function blocks(x: number, z: number, { bounds, obstacles }: Layout) {
  const radius = .18
  if (x < bounds.min.x+radius || x > bounds.max.x-radius
      || z < bounds.min.z+radius || z > bounds.max.z-radius) return true
  return obstacles.some(({min,max}) =>
    x > min.x-radius && x < max.x+radius && z > min.z-radius && z < max.z+radius)
}

function Player({ peerId, world, stand }: { peerId?: string; world: Layout; stand: () => void }) {
  const body = useRef<Group>(null)
  const initialized = useRef(false)
  const lastSeat = useRef<Seat | undefined>(undefined)
  const shape = useRef<Group>(null)
  const marker = useRef<Group>(null)
  const profile = store(useShallow((state) => {
    if (peerId) return state.peers[peerId]?.profile ?? null
    return { name: state.name, color: state.color, activity: state.activity, book: state.openBook }
  }))
  const show = store((state) => !peerId || Boolean(state.peers[peerId]?.pose))

  useFrame((_, delta) => {
    const view = body.current
    if (!view) return
    const state = store.getState()
    if (!peerId && !state.openBook) {
      const { x, z } = readMovement()
      if (x || z) {
        if (state.pose.seat) stand()
        const previous = store.getState().pose
        const step = Math.min(delta, 0.055) * 1.75 / Math.hypot(x, z)
        const nextX = previous.x + x * step
        const nextZ = previous.z + z * step
        const allowedX = blocks(nextX, previous.z, world) ? previous.x : nextX
        const pose = {
          x: allowedX,
          z: blocks(allowedX, nextZ, world) ? previous.z : nextZ,
          y: 0,
          yaw: Math.atan2(x, z),
        }
        if (pose.x !== previous.x || pose.z !== previous.z || pose.yaw !== previous.yaw) state.setPose(pose)
      }
    }
    const pose = peerId ? state.peers[peerId]?.pose : store.getState().pose
    if (!pose) return
    const weight = peerId && initialized.current && lastSeat.current === pose.seat
      && Math.hypot(view.position.x - pose.x, view.position.z - pose.z) < 1.5 ? 1 - Math.exp(-delta * 16) : 1
    view.position.x = MathUtils.lerp(view.position.x, pose.x, weight)
    view.position.y = MathUtils.lerp(view.position.y, pose.y ?? 0, weight)
    view.position.z = MathUtils.lerp(view.position.z, pose.z, weight)
    const angle = pose.yaw - view.rotation.y
    view.rotation.y += Math.atan2(Math.sin(angle), Math.cos(angle)) * weight
    initialized.current = true
    lastSeat.current = pose.seat
    if (shape.current) shape.current.scale.y = pose.seat ? .70 : 1
    if (marker.current) marker.current.position.y = pose.seat ? .67 : .93
  })

  if (!show) return null
  const reading = books.find(({ id }) => id === profile?.book)
  return (
    <group ref={body}>
      <group ref={shape}>
      <mesh position={[0, 0.28, 0]} castShadow>
        <capsuleGeometry args={[0.15, 0.23, 5, 16]} />
        <meshStandardMaterial color={profile?.color ?? '#788fa9'} roughness={0.94} />
      </mesh>
      <mesh position={[0, 0.575, 0]} castShadow>
        <sphereGeometry args={[0.145, 18, 14]} />
        <meshStandardMaterial color="#d1b394" roughness={0.97} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.082, 0.703, -0.008]} rotation={[0, 0, -side * 0.24]}>
            <coneGeometry args={[0.064, 0.12, 4]} />
            <meshStandardMaterial color={profile?.color ?? '#788fa9'} roughness={0.94} />
          </mesh>
          <mesh position={[side * 0.048, 0.584, 0.133]}>
            <sphereGeometry args={[0.012, 8, 6]} />
            <meshBasicMaterial color="#382a23" />
          </mesh>
        </group>
      ))}
      </group>
      <group ref={marker} position={[0,.93,0]}>
      <Html center style={{ pointerEvents: 'none' }}>
        <div className="avatar-label">
          <span className="avatar-name">{peerId ? profile?.name ?? '读者' : '你'}</span>
          {peerId && profile && (reading || profile.activity !== '随意逛逛') && (
            <span className="avatar-activity">{reading ? `正在翻阅《${reading.title}》` : profile.activity}</span>
          )}
        </div>
      </Html>
      </group>
    </group>
  )
}

function CameraFit({ world }: { world: Layout }) {
  const { camera, size } = useThree()
  useLayoutEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return
    const extent = world.bounds.getSize(new Vector3())
    if (world === fallback) {
      camera.position.set(...cameraPosition)
      camera.lookAt(...cameraTarget)
      camera.zoom = Math.min(size.width / 8.85, size.height / 6.65)
    } else {
      camera.position.copy(world.camera?.position ?? new Vector3(...cameraPosition).multiplyScalar(Math.max(1, extent.length() / 8)))
      camera.lookAt(world.camera?.target ?? new Vector3(0, extent.y * .28, 0))
      camera.zoom = Math.min(size.width / ((extent.x + extent.z) * .79), size.height / ((extent.x + extent.z) * .53 + extent.y))
    }
    camera.updateProjectionMatrix()
  }, [camera, size, world])
  return null
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <SceneUnavailable /> : this.props.children
  }
}

function SceneUnavailable() {
  return <p className="scene-unavailable">当前浏览器无法开启 3D 场景。你仍可阅读和使用环境音。</p>
}

export default function StudyScene({ openBook }: { openBook: (id: string) => void }) {
  const peers = store(useShallow((state) => Object.keys(state.peers)))
  const [model, reportModel] = useState<ModelLoadState>(null)
  useStudyRoomModel(reportModel)
  const room = model && 'room' in model ? model.room : null
  const world = room?.layout ?? fallback
  const standing = useRef(world.spawn)
  useLayoutEffect(() => {
    standing.current = world.spawn
    store.getState().setPose(world.spawn)
  }, [world])

  function sit(seat: Seat, pose: Pose) {
    const state = store.getState()
    if (state.pose.seat === seat) {
      stand()
      return
    }
    if (!state.pose.seat) standing.current = state.pose
    state.setPose({ ...pose, seat })
  }
  function stand() { store.getState().setPose(standing.current) }

  return (
    <SceneBoundary>
      {model && 'progress' in model && (
        <div className="model-progress" role="status">
          正在载入书屋模型
          <progress aria-label="模型加载进度" max={1} value={model.progress ?? undefined} />
        </div>
      )}
      <Canvas orthographic shadows dpr={[1, 1.6]} camera={{ position: cameraPosition, near: 0.1, far: 150 }}
        fallback={<SceneUnavailable />} aria-label="可行走的三维书屋">
        <CameraFit world={world} />
        {room ? <StudyRoomModel room={room} openBook={openBook} sit={sit} /> : <Room openBook={openBook} sit={sit} />}
        <Player world={world} stand={stand} />
        {peers.map((id) => <Player key={id} peerId={id} world={world} stand={stand} />)}
      </Canvas>
    </SceneBoundary>
  )
}
