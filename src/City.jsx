import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { FACADE, REACH_COLORS, SHOP_USES, STONE_USES } from './palette.js'
import { NatureGround, StreetSurface, TimeDriver, Trees, VegetationMass, Wild, decayBuildings, makeNatureUniforms } from './Nature.jsx'
import { BACKGROUND } from './palette.js'

// Coordinates: x is metres east, the scene's -z is metres north, y is up.

const ringToShapePoints = (ring) => ring.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y))

// For every wall vertex: its distance along its wall and the wall's length, so the shader
// can space windows evenly between the corners. Roof and floor vertices get (0, 0).
function wallCoordinates(position) {
  const n = position.count
  const seg = new Float32Array(n * 2)
  const p = position.array
  for (let t = 0; t < n; t += 3) {
    const v = [t, t + 1, t + 2]
    const ys = v.map((i) => p[i * 3 + 1])
    if (Math.max(...ys) - Math.min(...ys) < 1e-3) continue // horizontal: a roof
    // The two distinct corners of the wall, ordered the same way for both triangles of the quad.
    const corners = []
    for (const i of v) {
      const xz = [p[i * 3], p[i * 3 + 2]]
      if (!corners.some((c) => Math.abs(c[0] - xz[0]) < 1e-4 && Math.abs(c[1] - xz[1]) < 1e-4)) corners.push(xz)
    }
    if (corners.length !== 2) continue
    corners.sort((c, d) => c[0] - d[0] || c[1] - d[1])
    const [c0, c1] = corners
    const len = Math.hypot(c1[0] - c0[0], c1[1] - c0[1])
    for (const i of v) {
      seg[i * 2] = Math.hypot(p[i * 3] - c0[0], p[i * 3 + 2] - c0[1])
      seg[i * 2 + 1] = len
    }
  }
  return seg
}

const pick = (list, r) => list[Math.floor(r * list.length) % list.length]

// All buildings in one mesh, each extruded from its footprint to its height.
function Buildings({ buildings, tier, meshRef, uniforms }) {
  const { geometry, ranges, baseColors } = useMemo(() => {
    const parts = []
    const ranges = []
    let start = 0
    for (const b of buildings) {
      const shape = new THREE.Shape(ringToShapePoints(b.rings[0]))
      shape.holes = b.rings.slice(1).map((r) => new THREE.Path(ringToShapePoints(r)))
      const g = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false })
      g.deleteAttribute('uv')
      parts.push(g)
      ranges.push([start, g.attributes.position.count])
      start += g.attributes.position.count
    }
    const geometry = mergeGeometries(parts)
    parts.forEach((g) => g.dispose())
    geometry.rotateX(-Math.PI / 2) // footprint plane onto the ground, height upwards
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(start * 3), 3))
    // Per building, for the decay effects: a random number that picks which buildings get
    // overgrown, its height, and whether the walking reach currently highlights it.
    const seed = new Float32Array(start)
    const top = new Float32Array(start)
    buildings.forEach((b, i) => {
      const [s, n] = ranges[i]
      seed.fill(Math.abs(Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1, s, s + n)
      top.fill(b.height, s, s + n)
    })
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    geometry.setAttribute('aTop', new THREE.BufferAttribute(top, 1))
    geometry.setAttribute('aHl', new THREE.BufferAttribute(new Float32Array(start), 1))
    // Facades: floors, shop ground floors, roof colour, and where each vertex sits on its wall.
    const floors = new Float32Array(start)
    const shop = new Float32Array(start)
    const roof = new Float32Array(start * 3)
    const tone = new THREE.Color()
    buildings.forEach((b, i) => {
      const [s, n] = ranges[i]
      floors.fill(b.floors, s, s + n)
      shop.fill(SHOP_USES.includes(b.use) ? 1 : 0, s, s + n)
      tone.set(pick(FACADE.roofs, (seed[s] * 7.31) % 1))
      for (let v = s; v < s + n; v++) tone.toArray(roof, v * 3)
    })
    geometry.setAttribute('aFloors', new THREE.BufferAttribute(floors, 1))
    geometry.setAttribute('aShop', new THREE.BufferAttribute(shop, 1))
    geometry.setAttribute('aRoofColor', new THREE.BufferAttribute(roof, 3))
    geometry.setAttribute('aSeg', new THREE.BufferAttribute(wallCoordinates(geometry.attributes.position), 2))
    const c = new THREE.Color()
    const baseColors = buildings.map((b, i) => c.set(pick(STONE_USES.includes(b.use) ? FACADE.stone : FACADE.plaster, seed[ranges[i][0]])).toArray())
    return { geometry, ranges, baseColors }
  }, [buildings])

  // Paint each building in its plaster tone, or in the shade of the smallest walking-reach area it touches.
  useEffect(() => {
    const colors = geometry.attributes.color.array
    const highlight = geometry.attributes.aHl.array
    const shades = REACH_COLORS.map((h) => new THREE.Color(h).toArray())
    ranges.forEach(([start, count], i) => {
      const reached = tier && tier[i] >= 0
      const rgb = reached ? shades[tier[i]] : baseColors[i]
      for (let v = start; v < start + count; v++) colors.set(rgb, v * 3)
      highlight.fill(reached ? 1 : 0, start, start + count)
    })
    geometry.attributes.color.needsUpdate = true
    geometry.attributes.aHl.needsUpdate = true
  }, [geometry, ranges, baseColors, tier])

  const material = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true })
    decayBuildings(m, uniforms)
    return m
  }, [uniforms])

  return <mesh ref={meshRef} geometry={geometry} material={material} />
}

// The timeline drives the shaders directly; only the trees need React to redraw.
function Nature({ nature, stage, uniforms }) {
  const [params, setParams] = useState(null)
  return (
    <>
      <TimeDriver stage={stage} thresholds={nature.thresholds} uniforms={uniforms} onChange={setParams} />
      <VegetationMass nature={nature} uniforms={uniforms} />
      <Trees nature={nature} params={params} />
      <Wild nature={nature} params={params} uniforms={uniforms} />
    </>
  )
}

// One flat shape per area. They don't write depth, so drawn 15 → 10 → 5 the smaller sits on top.
function ReachArea({ polygons, color, order }) {
  const geometry = useMemo(() => {
    const shapes = polygons.map((p) => {
      const s = new THREE.Shape(p.outer.map(([x, y]) => new THREE.Vector2(x, y)))
      s.holes = p.holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
      return s
    })
    const g = new THREE.ShapeGeometry(shapes)
    g.rotateX(-Math.PI / 2)
    return g
  }, [polygons])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} position-y={0.05} renderOrder={order}>
      <meshBasicMaterial color={color} depthWrite={false} />
    </mesh>
  )
}

// A click (not a drag) on a building or the ground reports the spot in metres east and north.
function ClickPicker({ targets, onPick }) {
  const { camera, gl } = useThree()
  useEffect(() => {
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()
    let down = null
    const onDown = (e) => (down = e.button === 0 ? [e.clientX, e.clientY] : null)
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return
      down = null
      const r = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObjects(targets.map((t) => t.current).filter(Boolean), false)[0]
      if (hit) onPick([hit.point.x, -hit.point.z])
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [camera, gl, targets, onPick])
  return null
}

export default function City({ data, nature, size, reach, onPick, stage }) {
  const uniforms = useMemo(makeNatureUniforms, [])
  const buildingsRef = useRef()
  const groundRef = useRef()
  const targets = useMemo(() => [buildingsRef, groundRef], [])
  const start = reach && !reach.tooFar ? reach.start : null

  return (
    <Canvas camera={{ position: [-500, 1500, 1700], fov: 40, near: 5, far: 20000 }} dpr={[1, 2]}>
      <color attach="background" args={[BACKGROUND]} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[-600, 1200, 400]} intensity={1.6} />
      <NatureGround size={size} nature={nature} uniforms={uniforms} meshRef={groundRef} />
      {reach?.areas &&
        [...reach.areas].reverse().map((a, k) => (
          <ReachArea key={a.minutes} polygons={a.polygons} color={REACH_COLORS[reach.areas.length - 1 - k]} order={1 + k} />
        ))}
      <StreetSurface edges={data.edges} nature={nature} uniforms={uniforms} />
      <Buildings buildings={data.buildings} tier={reach?.tier} meshRef={buildingsRef} uniforms={uniforms} />
      <Nature nature={nature} stage={stage} uniforms={uniforms} />
      {start && (
        <mesh position={[start[0], 20, -start[1]]}>
          <cylinderGeometry args={[5, 5, 40, 24]} />
          <meshLambertMaterial color="#1b2f55" />
        </mesh>
      )}
      <OrbitControls makeDefault target={[0, 0, 0]} maxPolarAngle={Math.PI / 2.1} minDistance={80} maxDistance={6000} />
      {onPick && <ClickPicker targets={targets} onPick={onPick} />}
    </Canvas>
  )
}
