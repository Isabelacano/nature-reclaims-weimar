import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { FACADE, SHOP_USES, STONE_USES } from './palette.js'
import { NatureGround, StreetSurface, Upheaval, VegetationMass, Wild, decayBuildings, makeNatureUniforms } from './Nature.jsx'
import { CityTrees, ConsumingRoots, DiversionRoots, FacadeGrowth, Giants, Growth } from './Trees.jsx'
import { buildingSeed } from './nature.js'
import Environment from './Environment.jsx'
import EntityDriver from './entity/EntityDriver.jsx'

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
function Buildings({ buildings, uniforms }) {
  const geometry = useMemo(() => {
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
    // Per building: a random number that decides how it has aged, its height, floors,
    // shop ground floor, roof colour and plaster tone, and where each vertex sits on its wall.
    const seed = new Float32Array(start)
    const top = new Float32Array(start)
    const floors = new Float32Array(start)
    const shop = new Float32Array(start)
    const roof = new Float32Array(start * 3)
    const colors = new Float32Array(start * 3)
    const tone = new THREE.Color()
    buildings.forEach((b, i) => {
      const [s, n] = ranges[i]
      const r = buildingSeed(i)
      seed.fill(r, s, s + n)
      top.fill(b.height, s, s + n)
      floors.fill(b.floors, s, s + n)
      shop.fill(SHOP_USES.includes(b.use) ? 1 : 0, s, s + n)
      tone.set(pick(FACADE.roofs, (r * 7.31) % 1))
      for (let v = s; v < s + n; v++) tone.toArray(roof, v * 3)
      tone.set(pick(STONE_USES.includes(b.use) ? FACADE.stone : FACADE.plaster, r))
      for (let v = s; v < s + n; v++) tone.toArray(colors, v * 3)
    })
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    geometry.setAttribute('aTop', new THREE.BufferAttribute(top, 1))
    geometry.setAttribute('aFloors', new THREE.BufferAttribute(floors, 1))
    geometry.setAttribute('aShop', new THREE.BufferAttribute(shop, 1))
    geometry.setAttribute('aRoofColor', new THREE.BufferAttribute(roof, 3))
    geometry.setAttribute('aSeg', new THREE.BufferAttribute(wallCoordinates(geometry.attributes.position), 2))
    return geometry
  }, [buildings])

  const material = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true })
    decayBuildings(m, uniforms)
    return m
  }, [uniforms])

  return <mesh geometry={geometry} material={material} castShadow receiveShadow />
}

const MARGIN_M = 200 // the city's ground plane runs this far past the modelled area

export default function City({ data, nature }) {
  const uniforms = useMemo(() => makeNatureUniforms(nature.threshold), [nature])
  // Shared handles between the scene's parts and the entity (the growth pool, the diversion roots).
  const world = useMemo(() => ({}), [])
  const blocked = useMemo(() => (x, y) => nature.buildingAt(x, y) >= 0 || nature.buildingAt(x + 8, y) >= 0 || nature.buildingAt(x, y + 8) >= 0, [nature])
  const { kit, hole } = useMemo(() => {
    const { x0, y0, W, H, cell } = nature.grid
    const kit = [x0, y0, x0 + W * cell, y0 + H * cell]
    return { kit, hole: [kit[0] - MARGIN_M, kit[1] - MARGIN_M, kit[2] + MARGIN_M, kit[3] + MARGIN_M] }
  }, [nature])

  return (
    <Canvas shadows="percentage" camera={{ position: [-760, 470, 1180], fov: 42, near: 5, far: 30000 }} dpr={[1, 1.75]}>
      <Environment kit={kit} hole={hole} blocked={blocked} />
      <NatureGround nature={nature} uniforms={uniforms} rect={hole} />
      <StreetSurface edges={data.edges} nature={nature} uniforms={uniforms} />
      <Buildings buildings={data.buildings} uniforms={uniforms} />
      <VegetationMass nature={nature} uniforms={uniforms} />
      <CityTrees nature={nature} />
      <Giants giants={nature.giants} />
      <Wild nature={nature} uniforms={uniforms} />
      <FacadeGrowth buildings={data.buildings} />
      <Growth world={world} />
      <DiversionRoots world={world} buildings={data.buildings} />
      <ConsumingRoots world={world} buildings={data.buildings} />
      <Upheaval world={world} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} target={[0, 0, 80]} maxPolarAngle={Math.PI / 2.12} minDistance={40} maxDistance={4200} />
      <EntityDriver data={data} nature={nature} world={world} kit={kit} />
    </Canvas>
  )
}
