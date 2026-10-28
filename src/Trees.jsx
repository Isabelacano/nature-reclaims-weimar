import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { buildingSeed, hash2, valueNoise } from './nature.js'
import { NATURE, WILD } from './palette.js'
import { SWAY_VERTEX, extendMaterial } from './shaders.js'
import { rootGeometry, rootMaterial } from './Nature.jsx'

// Trees, giants, and the growth the entity can summon. Everything that sways uses SWAY_VERTEX.

const UP = new THREE.Vector3(0, 1, 0)

// Colour every vertex, darker toward the bottom of each lump (self-shade), and give it its bend.
function finish(g, hex, { shade = 0, bendTop = 1, treeH = 1, bend } = {}) {
  const out = g.index ? g.toNonIndexed() : g
  out.deleteAttribute('uv')
  const n = out.attributes.position.count
  const col = new Float32Array(n * 3)
  const bends = new Float32Array(n)
  const c = new THREE.Color(hex)
  out.computeBoundingBox()
  const { min, max } = out.boundingBox
  for (let i = 0; i < n; i++) {
    const y = out.attributes.position.getY(i)
    const k = 1 - shade * (1 - (y - min.y) / (max.y - min.y || 1))
    col[i * 3] = c.r * k
    col[i * 3 + 1] = c.g * k
    col[i * 3 + 2] = c.b * k
    bends[i] = bend ? bend(y) : Math.min(Math.max(y / bendTop, 0), 1)
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3))
  out.setAttribute('aBend', new THREE.BufferAttribute(bends, 1))
  out.setAttribute('aTreeH', new THREE.BufferAttribute(new Float32Array(n).fill(treeH), 1))
  return out
}

// A lumpy blob: an icosahedron pushed in and out by noise, so no two crowns share a silhouette.
function lump(r, squash, seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i)
    const k = 1 + 0.28 * valueNoise(v.x * 1.7 + seed, v.z * 1.7 + v.y, 501 + seed)
    p.setXYZ(i, v.x * r * k, v.y * r * squash * k, v.z * r * k)
  }
  return g
}

// A limb from a to b, tapering.
function limb(a, b, r0, r1, sides = 5) {
  const d = new THREE.Vector3().subVectors(b, a)
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), sides, 1, true).translate(0, d.length() / 2, 0)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()))
  return g.translate(a.x, a.y, a.z)
}

// ---- the city's trees: six variants, each 1 unit tall, instanced ----

const VARIANTS = 6
function treeVariant(v) {
  const r = (k) => hash2(v, k, 601)
  const parts = []
  const crown = NATURE.crowns[v % NATURE.crowns.length]
  const bark = NATURE.bark[v % NATURE.bark.length]
  // 0, 1: broad crowns; 2: tall and narrow; 3: wide, leaning; 4: sparse, half bare; 5: open and light
  const shape = [
    { trunk: 0.42, spread: 0.3, lumps: 7, size: 0.2, squash: 0.75 },
    { trunk: 0.5, spread: 0.26, lumps: 6, size: 0.19, squash: 0.8 },
    { trunk: 0.35, spread: 0.1, lumps: 6, size: 0.12, squash: 1.3 },
    { trunk: 0.38, spread: 0.38, lumps: 7, size: 0.18, squash: 0.6 },
    { trunk: 0.55, spread: 0.3, lumps: 3, size: 0.13, squash: 0.8 },
    { trunk: 0.5, spread: 0.24, lumps: 5, size: 0.15, squash: 0.9 },
  ][v]
  const bendX = (r(1) - 0.5) * 0.08
  const top = new THREE.Vector3(bendX, shape.trunk, (r(2) - 0.5) * 0.06)
  parts.push(finish(limb(new THREE.Vector3(0, -0.05, 0), top, 0.04, 0.022, 6), bark))
  const ends = []
  const nBranches = shape.lumps - 1
  for (let k = 0; k < nBranches; k++) {
    const az = (k / nBranches) * Math.PI * 2 + r(10 + k) * 0.9
    const from = top.clone().multiplyScalar(0.7 + 0.3 * r(20 + k))
    const rise = v === 2 ? 0.1 + 0.5 * (k / nBranches) : 0.12 + 0.22 * r(30 + k)
    const out = shape.spread * (0.6 + 0.5 * r(40 + k))
    const end = new THREE.Vector3(from.x + Math.cos(az) * out, from.y + rise, from.z + Math.sin(az) * out)
    parts.push(finish(limb(from, end, 0.016, 0.007, 4), bark))
    ends.push(end)
  }
  ends.push(top.clone().add(new THREE.Vector3(0, 0.12, 0)))
  ends.forEach((e, k) => {
    // The sparse variant keeps some limbs bare.
    if (v === 4 && k % 2) return
    const s = shape.size * (0.75 + 0.5 * r(50 + k))
    const tone = new THREE.Color(crown[0]).lerp(new THREE.Color(crown[1]), r(60 + k))
    parts.push(finish(lump(s, shape.squash, v * 7 + k).translate(e.x, e.y, e.z), '#' + tone.getHexString(), { shade: 0.45 }))
  })
  // Recompute bend over the whole tree: 0 at the foot, 1 at the top.
  const g = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  g.computeBoundingBox()
  const H = g.boundingBox.max.y
  const pos = g.attributes.position
  const bend = g.attributes.aBend
  for (let i = 0; i < pos.count; i++) bend.setX(i, Math.max(pos.getY(i), 0) / H)
  return g
}

export function CityTrees({ nature }) {
  const geometries = useMemo(() => Array.from({ length: VARIANTS }, (_, v) => treeVariant(v)), [])
  const material = useMemo(() => swayMaterial('city-trees'), [])
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries])

  // The few distinctive trees of the old model join the many new ones.
  const groups = useMemo(() => {
    const kindVariant = { column: 2, round: 0, wide: 3 }
    const all = [
      ...nature.trees.map((t, i) => ({ x: t.x, y: t.y, height: 16 + 12 * t.size + t.ground * 0.5, width: t.kind === 'column' ? 0.9 : 1.15, turn: t.turn, variant: kindVariant[t.kind] ?? i % VARIANTS, lean: [0, 0], tone: (t.shade + 0.5) / 3 })),
      ...nature.urbanTrees,
    ]
    return Array.from({ length: VARIANTS }, (_, v) => all.filter((t) => t.variant === v))
  }, [nature])

  const refs = useRef([])
  useEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const tilt = new THREE.Quaternion()
    const axis = new THREE.Vector3()
    const tint = new THREE.Color()
    groups.forEach((list, v) => {
      const mesh = refs.current[v]
      if (!mesh) return
      list.forEach((t, i) => {
        // Never buried: a tree rises at least a few metres out of the mass around it.
        const h = Math.max(t.height, nature.massTop(t.x, t.y) + 7)
        q.setFromAxisAngle(UP, t.turn)
        const [lx, ly] = t.lean
        const amount = Math.hypot(lx, ly)
        if (amount > 1e-3) {
          axis.set(-ly, 0, -lx).normalize() // perpendicular to the lean, in scene axes
          tilt.setFromAxisAngle(axis, amount * 2.2)
          q.premultiply(tilt)
        }
        const w = h * t.width
        m.compose(new THREE.Vector3(t.x, 0, -t.y), q, new THREE.Vector3(w, h, w))
        mesh.setMatrixAt(i, m)
        tint.setRGB(0.82 + 0.3 * t.tone, 0.86 + 0.24 * t.tone, 0.8 + 0.2 * (1 - t.tone))
        mesh.setColorAt(i, tint)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    })
  }, [groups, nature])

  return (
    <group>
      {groups.map((list, v) =>
        list.length ? <instancedMesh key={v} ref={(m) => (refs.current[v] = m)} args={[geometries[v], material, list.length]} frustumCulled={false} castShadow receiveShadow /> : null,
      )}
    </group>
  )
}

// ---- the giants: buttressed, slightly twisting trunks, limbs, and stacked lumpy canopies ----

function giantGeometry(g, k) {
  const parts = []
  const trunkH = g.height * 0.86
  const seed = k * 13
  // Trunk: a cylinder reshaped into flaring buttresses at the foot, gnarled and slightly bent.
  const trunk = new THREE.CylinderGeometry(1, 1, trunkH, 16, 22, true).translate(0, trunkH / 2, 0)
  const p = trunk.attributes.position
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)]
    const th = Math.atan2(z, x)
    const t = y / trunkH
    const buttress = 1.8 * Math.exp(-y / (g.trunk * 3.2)) * Math.pow(Math.max(0, Math.cos(5 * th + g.turn)), 3)
    const gnarl = 1 + 0.12 * valueNoise(th * 2 + seed, y * 0.08, 701)
    const r = g.trunk * (1 - 0.6 * t) * (1 + buttress) * gnarl
    const bx = Math.sin(t * 2.2 + g.turn) * g.trunk * 0.9
    p.setXYZ(i, x * r + bx, y - (buttress > 0.1 ? 0.3 : 0), z * r + Math.cos(t * 1.7 + g.turn) * g.trunk * 0.5)
  }
  parts.push(finish(trunk, WILD.giantTrunk, { bendTop: g.height, treeH: g.height }))
  for (let tier = 0; tier < g.tiers; tier++) {
    const rad = g.crown * (1 - 0.18 * tier)
    const y = g.height * (0.5 + (0.5 / g.tiers) * (tier + 0.6))
    const lumps = 6 + Math.floor(hash2(k, tier, 703) * 3)
    for (let j = 0; j < lumps; j++) {
      const a = g.turn + tier * 2.1 + (j / lumps) * Math.PI * 2 + hash2(k, tier * 10 + j, 707) * 0.6
      const out = rad * (0.45 + 0.4 * hash2(k, tier * 10 + j, 709))
      const end = new THREE.Vector3(Math.cos(a) * out, y + rad * 0.12 * hash2(k, j, 711), Math.sin(a) * out)
      const from = new THREE.Vector3(0, y - rad * 0.35, 0)
      parts.push(finish(limb(from, end, g.trunk * 0.32, g.trunk * 0.12, 5), WILD.giantTrunk, { bendTop: g.height, treeH: g.height }))
      const s = rad * (0.42 + 0.22 * hash2(k, tier * 10 + j, 713))
      const tone = WILD.giantCrown[(tier + j + k) % WILD.giantCrown.length]
      parts.push(finish(lump(s, 0.42, seed + tier * 10 + j).translate(end.x, end.y, end.z), tone, { shade: 0.5, bendTop: g.height, treeH: g.height }))
    }
    // A flatter core lump closes each tier.
    parts.push(finish(lump(rad * 0.6, 0.35, seed + tier).translate(0, y, 0), WILD.giantCrown[(tier + k) % 3], { shade: 0.5, bendTop: g.height, treeH: g.height }))
  }
  const merged = mergeGeometries(parts)
  parts.forEach((q) => q.dispose())
  const pos = merged.attributes.position
  const bend = merged.attributes.aBend
  for (let i = 0; i < pos.count; i++) bend.setX(i, Math.max(pos.getY(i), 0) / g.height)
  return merged
}

export function Giants({ giants }) {
  const geometries = useMemo(() => giants.map(giantGeometry), [giants])
  const material = useMemo(() => swayMaterial('giants', { side: THREE.DoubleSide }), [])
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries])
  return (
    <group>
      {giants.map((g, i) => (
        <mesh key={i} geometry={geometries[i]} material={material} position={[g.x, 0, -g.y]} castShadow receiveShadow />
      ))}
    </group>
  )
}

// ---- leaves, sprigs and vines: the growth the entity summons, and the growth on the walls ----

// One leaf, pointing along +y from its stalk, its two halves folded back along the midrib:
// 6 triangles, or 2 for the coarse leaves used where there are thousands.
function leafGeometry(coarse) {
  const P = []
  const tri = (a, b, c) => P.push(...a, ...b, ...c)
  const edge = (s, t, w) => [s * w, t, -0.18 * w]
  if (coarse) {
    const [b, t] = [[0, 0, 0], [0, 1, 0]]
    tri(b, edge(-1, 0.45, 0.32), t)
    tri(b, t, edge(1, 0.45, 0.32))
  } else {
    const [b, m, t] = [[0, 0, 0], [0, 0.5, 0.03], [0, 1, 0]]
    for (const s of [-1, 1]) {
      const [e1, e2] = [edge(s, 0.3, 0.36), edge(s, 0.68, 0.3)]
      tri(b, e1, m)
      tri(m, e1, e2)
      tri(m, e2, t)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
  g.computeVertexNormals()
  return g
}

const LEAF_TONES = [...NATURE.crowns.flat(), WILD.mass[1], WILD.mass[2], NATURE.ivy]

// A leaf at `at`, its tip toward `dir`, its face turned toward `face`, `size` long.
function leaf(at, dir, face, size, tone, coarse) {
  const y = dir.clone().normalize()
  const z = face.clone().addScaledVector(y, -face.dot(y))
  if (z.lengthSq() < 1e-6) z.set(y.y, -y.x, 0.3)
  z.normalize()
  const x = new THREE.Vector3().crossVectors(y, z)
  const m = new THREE.Matrix4().makeBasis(x.multiplyScalar(size), y.multiplyScalar(size), z.multiplyScalar(size)).setPosition(at)
  return finish(leafGeometry(coarse).applyMatrix4(m), tone)
}

const toneOf = (seed, k) => {
  const c = new THREE.Color(LEAF_TONES[Math.floor(hash2(seed, k, 1131) * LEAF_TONES.length)])
  return '#' + c.multiplyScalar(0.72 + 0.3 * hash2(seed, k, 1133)).getHexString()
}

// Merge, then set the bend from the height (0 at the base, `top` and above swaying most).
function mergeWithBend(parts, bendOf) {
  const g = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  const pos = g.attributes.position
  const bend = g.attributes.aBend
  for (let i = 0; i < pos.count; i++) bend.setX(i, bendOf(pos.getY(i)))
  return g
}

// A leafy shrub about 1 unit across: a short stem, branches spreading from it, about fifty leaves
// along the branches and in a cluster at the top.
function sprigGeometry(seed, coarse = false) {
  const r = (k) => hash2(seed, k, 1101)
  const parts = []
  const bark = NATURE.bark[1]
  const top = new THREE.Vector3(0.04, 0.55, -0.03)
  parts.push(finish(limb(new THREE.Vector3(0, -0.05, 0), top, 0.03, 0.014, 4), bark))
  const BR = 9
  for (let k = 0; k < BR; k++) {
    const az = (k / BR) * Math.PI * 2 + r(k) * 0.8
    const from = new THREE.Vector3(0, 0.08 + 0.45 * (k / BR), 0)
    const out = 0.32 + 0.2 * r(10 + k)
    const tip = new THREE.Vector3(Math.cos(az) * out, from.y + 0.18 + 0.3 * r(20 + k), Math.sin(az) * out)
    const mid = from.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.07, 0))
    parts.push(finish(limb(from, mid, 0.014, 0.009, 3), bark), finish(limb(mid, tip, 0.009, 0.004, 3), bark))
    const along = tip.clone().sub(from).normalize()
    const side = new THREE.Vector3(-along.z, 0, along.x)
    for (let j = 0; j < 7; j++) {
      const t = 0.2 + 0.8 * (j / 6)
      const at = t < 0.5 ? from.clone().lerp(mid, t * 2) : mid.clone().lerp(tip, (t - 0.5) * 2)
      const dir = along.clone().multiplyScalar(0.7).addScaledVector(side, j % 2 ? 1 : -1).add(new THREE.Vector3(0, 0.3 + 0.4 * r(30 + k * 7 + j), 0))
      const face = new THREE.Vector3(r(70 + k * 7 + j) - 0.5, 1, r(80 + k * 7 + j) - 0.5)
      parts.push(leaf(at, dir, face, 0.12 + 0.07 * r(40 + k * 7 + j), toneOf(seed, k * 7 + j), coarse))
    }
  }
  for (let j = 0; j < 9; j++) {
    const az = (j / 9) * Math.PI * 2
    const dir = new THREE.Vector3(Math.cos(az), 1.1 + r(90 + j), Math.sin(az))
    parts.push(leaf(top, dir, new THREE.Vector3(-Math.cos(az), 0.5, -Math.sin(az)), 0.17, toneOf(seed, 100 + j), coarse))
  }
  return mergeWithBend(parts, (y) => Math.min(Math.max(y, 0), 1) * 0.8)
}

// A curtain of vines hanging from y = 0 down to about y = -1, 1 unit wide, its leaves facing +z
// (away from the wall), with a spill of leaves along the top edge where it comes over the cornice.
function vineGeometry(seed, strands, perStrand, coarse) {
  const r = (k) => hash2(seed, k, 1151)
  const parts = []
  const stem = NATURE.bark[2]
  for (let s = 0; s < strands; s++) {
    const x = -0.5 + (s + 0.5) / strands + (r(s) - 0.5) * 0.5 / strands
    const L = 0.45 + 0.55 * r(10 + s)
    const a = new THREE.Vector3(x, 0, 0.02)
    const m = new THREE.Vector3(x + (r(20 + s) - 0.5) * 0.12, -L / 2, 0.06)
    const b = new THREE.Vector3(x + (r(30 + s) - 0.5) * 0.18, -L, 0.03)
    parts.push(finish(limb(a, m, 0.008, 0.007, 3), stem), finish(limb(m, b, 0.007, 0.004, 3), stem))
    for (let j = 0; j < perStrand; j++) {
      const t = (j + 0.6) / perStrand
      const at = t < 0.5 ? a.clone().lerp(m, t * 2) : m.clone().lerp(b, (t - 0.5) * 2)
      const dir = new THREE.Vector3(j % 2 ? 0.8 : -0.8, -0.45 + 0.3 * r(40 + s * 9 + j), 0.35)
      const face = new THREE.Vector3(r(50 + s * 9 + j) - 0.5, 0.25, 1)
      parts.push(leaf(at, dir, face, 0.09 + 0.06 * r(60 + s * 9 + j) * (1 - 0.4 * t), toneOf(seed, s * 9 + j), coarse))
    }
  }
  const cap = Math.round(strands * 1.3)
  for (let j = 0; j < cap; j++) {
    const at = new THREE.Vector3(-0.5 + (j + 0.5) / cap, 0.01, 0.04)
    const dir = new THREE.Vector3(r(200 + j) - 0.5, 0.25, 1)
    parts.push(leaf(at, dir, new THREE.Vector3(0, 1, 0.2), 0.12 + 0.05 * r(210 + j), toneOf(seed, 300 + j), coarse))
  }
  return mergeWithBend(parts, (y) => Math.min(Math.max(-y, 0), 1))
}

// The sway material. lift 1: the plant rides up on the upheaval; 0: it stays fixed to its wall.
function swayMaterial(key, extra = {}, lift = 1) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...extra })
  return extendMaterial(m, key, { ...SWAY_VERTEX, uniforms: { uLift: { value: lift } } })
}

const SPRIGS = 700
const VINES = 450

// A pool's controller: spawn(list) places items; the oldest are reused.
function createPool(mesh, size) {
  const slots = Array.from({ length: size }, () => ({ active: false }))
  let cursor = 0
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v = new THREE.Vector3()
  const s = new THREE.Vector3()
  const zero = new THREE.Matrix4().makeScale(0, 0, 0)
  for (let i = 0; i < size; i++) mesh.setMatrixAt(i, zero)
  mesh.instanceMatrix.needsUpdate = true
  return {
    spawn(it, now) {
      slots[cursor] = { ...it, active: true, t0: now + (it.delay ?? 0) }
      cursor = (cursor + 1) % size
    },
    active: () => slots.reduce((n, sl) => n + (sl.active ? 1 : 0), 0),
    update(now) {
      let changed = false
      slots.forEach((sl, i) => {
        if (!sl.active) return
        const t = now - sl.t0
        const grow = sl.grow ?? 2.2
        let k
        if (t < 0) k = 0
        else if (t < grow) {
          const u = t / grow
          k = 1 - Math.pow(1 - u, 3) + Math.sin(u * Math.PI) * 0.12 // fast, with a little overshoot
        } else if (t < sl.life) k = 1
        else if (t < sl.life + 7) k = 1 - (t - sl.life) / 7
        else {
          sl.active = false
          mesh.setMatrixAt(i, zero)
          changed = true
          return
        }
        q.setFromAxisAngle(UP, sl.turn)
        m.compose(v.set(sl.x, sl.z, -sl.y), q, s.set(sl.sx * k + 1e-4, sl.sy * k + 1e-4, sl.sz * k + 1e-4))
        mesh.setMatrixAt(i, m)
        changed = true
      })
      if (changed) mesh.instanceMatrix.needsUpdate = true
    },
  }
}

// Two pools: leafy sprigs on the ground (which ride on the upheaval) and vine curtains on walls.
export function Growth({ world }) {
  const sprigRef = useRef()
  const vineRef = useRef()
  const sprig = useMemo(() => sprigGeometry(7), [])
  const vine = useMemo(() => vineGeometry(11, 9, 7, false), [])
  const sprigMaterial = useMemo(() => swayMaterial('growth-sprigs', { side: THREE.DoubleSide }, 1), [])
  const vineMaterial = useMemo(() => swayMaterial('growth-vines', { side: THREE.DoubleSide }, 0), [])
  useEffect(() => {
    const pools = { sprig: createPool(sprigRef.current, SPRIGS), vine: createPool(vineRef.current, VINES) }
    world.growth = {
      // Each item: { kind: 'sprig' | 'vine', x, y (metres north), z (height), sx, sy, sz, turn, delay, life, grow }
      spawn(items, now) {
        for (const it of items) pools[it.kind === 'vine' ? 'vine' : 'sprig'].spawn(it, now)
      },
      active: () => pools.sprig.active() + pools.vine.active(),
      update(now) {
        pools.sprig.update(now)
        pools.vine.update(now)
      },
    }
    return () => {
      world.growth = null
      sprig.dispose()
      vine.dispose()
    }
  }, [world, sprig, vine])
  useFrame((state) => world.growth?.update(state.clock.elapsedTime))
  return (
    <group>
      <instancedMesh ref={sprigRef} args={[sprig, sprigMaterial, SPRIGS]} frustumCulled={false} castShadow receiveShadow />
      <instancedMesh ref={vineRef} args={[vine, vineMaterial, VINES]} frustumCulled={false} castShadow receiveShadow />
    </group>
  )
}

// A vine curtain's turn about the vertical, so that its leaves face out along the wall normal (nx, ny).
export const vineTurn = (nx, ny) => Math.atan2(nx, -ny)

// The footprint of a building: points every `step` m around it, pushed `off` m outward, each with
// its outward normal, as [x, y, nx, ny]; and its centre.
export function footprint(building) {
  const ring = building.rings[0].slice(0, -1)
  let area = 0
  let [cx, cy] = [0, 0]
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]]
    area += a[0] * b[1] - b[0] * a[1]
    cx += a[0] / ring.length
    cy += a[1] / ring.length
  }
  const sign = area > 0 ? 1 : -1 // counter-clockwise: the outside is to the right
  const around = (off, step = 2) => {
    const pts = []
    for (let i = 0; i < ring.length; i++) {
      const [a, b] = [ring[i], ring[(i + 1) % ring.length]]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < 0.1) continue
      const [nx, ny] = [(sign * (b[1] - a[1])) / len, (-sign * (b[0] - a[0])) / len]
      for (let d = 0; d < len; d += step) {
        const t = d / len
        pts.push([a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + ny * off, nx, ny])
      }
    }
    return pts
  }
  return { around, centre: [cx, cy] }
}

// ---- permanent growth: vines over the walls of the buildings nature is consuming, shrubs at the foot of others ----

export function FacadeGrowth({ buildings }) {
  const vineRef = useRef()
  const sprigRef = useRef()
  const vine = useMemo(() => vineGeometry(23, 6, 5, true), [])
  const sprig = useMemo(() => sprigGeometry(29, true), [])
  const vineMaterial = useMemo(() => swayMaterial('facade-vines', { side: THREE.DoubleSide }, 0), [])
  const sprigMaterial = useMemo(() => swayMaterial('facade-sprigs', { side: THREE.DoubleSide }, 1), [])
  const { vines, sprigs } = useMemo(() => {
    const vines = []
    const sprigs = []
    buildings.forEach((b, i) => {
      const s = buildingSeed(i)
      const consumed = s > 0.77
      if (!consumed && !(s > 0.3 && hash2(i, 2, 1003) < 0.4)) return
      const wall = footprint(b).around(0.35, 2)
      if (!wall.length) return
      const n = consumed && b.height > 3 ? 2 + Math.floor(hash2(i, 1, 1001) * 3) : 0
      for (let k = 0; k < n; k++) {
        const [x, y, nx, ny] = wall[Math.floor(hash2(i, k, 1005) * wall.length)]
        const w = 4 + 5 * hash2(i, k, 1011)
        // Hanging from the cornice, never longer than the wall.
        const len = Math.min(b.height * 0.95, w * (0.8 + 0.9 * hash2(i, k, 1009)))
        vines.push({ x, y, z: b.height, sx: w, sy: len, sz: w * 0.6, turn: vineTurn(nx, ny) })
      }
      const feet = consumed ? 1 + Math.floor(hash2(i, 3, 1015) * 2) : 1
      for (let k = 0; k < feet; k++) {
        const [x, y, nx, ny] = wall[Math.floor(hash2(i, k + 10, 1005) * wall.length)]
        const size = 1.8 + 2.4 * hash2(i, k, 1013)
        sprigs.push({ x: x + nx * size * 0.4, y: y + ny * size * 0.4, z: 0, sx: size * 1.3, sy: size, sz: size * 1.3, turn: hash2(i, k, 1017) * 6.28 })
      }
    })
    return { vines, sprigs }
  }, [buildings])
  useEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const place = (mesh, list) => {
      list.forEach((it, i) => {
        q.setFromAxisAngle(UP, it.turn)
        m.compose(new THREE.Vector3(it.x, it.z, -it.y), q, new THREE.Vector3(it.sx, it.sy, it.sz))
        mesh.setMatrixAt(i, m)
      })
      mesh.instanceMatrix.needsUpdate = true
    }
    place(vineRef.current, vines)
    place(sprigRef.current, sprigs)
  }, [vines, sprigs])
  useEffect(
    () => () => {
      vine.dispose()
      sprig.dispose()
    },
    [vine, sprig],
  )
  return (
    <group>
      <instancedMesh ref={vineRef} args={[vine, vineMaterial, vines.length]} frustumCulled={false} castShadow receiveShadow />
      <instancedMesh ref={sprigRef} args={[sprig, sprigMaterial, sprigs.length]} frustumCulled={false} castShadow receiveShadow />
    </group>
  )
}

// ---- consumption: great roots that rise from the ground, climb the walls and close over the roofs ----

// Strands that emerge from the ground 6–16 m out, run to the wall, climb it, and cross the roof
// toward its middle; and bands that wrap around the building at two heights.
function consumingRoots(building, seed, delay) {
  const { around, centre } = footprint(building)
  const wall = around(0.3, 1.5)
  if (wall.length < 4) return []
  const H = building.height
  const r = (c, k) => hash2(seed, c, k)
  const roots = []
  const n = Math.min(9, 3 + Math.floor(wall.length / 12))
  for (let c = 0; c < n; c++) {
    const [x, y, nx, ny] = wall[Math.floor(r(c, 1201) * wall.length)]
    const [tx, ty] = [-ny, nx] // along the wall
    const rad = 0.7 + 0.9 * r(c, 1203)
    const out = 6 + 10 * r(c, 1205)
    const slide = (r(c, 1207) - 0.5) * 10
    const pts = []
    for (let d = out; d > 0.5; d -= 1.5) {
      const w = slide * (d / out) + valueNoise(d * 0.2, seed + c, 1209) * 1.5
      pts.push([x + nx * (d + rad) + tx * w, y + ny * (d + rad) + ty * w, 0])
    }
    for (let h = 0; h < H; h += 1.5) {
      const w = valueNoise(h * 0.15, seed + c + 50, 1211) * 2
      pts.push([x + nx * rad + tx * w, y + ny * rad + ty * w, h])
    }
    const [lx, ly] = pts[pts.length - 1]
    pts.push([lx, ly, H + rad * 0.3])
    const reach = 0.25 + 0.4 * r(c, 1213)
    for (let t = 0.08; t <= reach; t += 0.06) {
      const w = valueNoise(t * 9, seed + c + 90, 1215) * 1.5
      pts.push([lx + (centre[0] - lx) * t + tx * w, ly + (centre[1] - ly) * t + ty * w, H + rad * 0.6])
    }
    roots.push({ pts, radius: rad, delay: delay + 0.15 * r(c, 1217), seed: seed * 13 + c })
  }
  for (let band = 0; band < (H > 6 ? 2 : 1); band++) {
    const rad = 0.5 + 0.4 * r(20 + band, 1219)
    const ring = around(0.3 + rad, 2)
    const hb = H * (0.3 + 0.35 * band)
    const start = Math.floor(r(20 + band, 1221) * ring.length)
    const count = Math.max(4, Math.floor(ring.length * (0.6 + 0.4 * r(20 + band, 1223))))
    const pts = []
    for (let k = 0; k < count; k++) {
      const [x, y] = ring[(start + k) % ring.length]
      pts.push([x, y, hb + valueNoise(k * 0.25, seed + band, 1225) * 1.6])
    }
    roots.push({ pts, radius: rad, delay: delay + 0.3, seed: seed * 17 + band })
  }
  return roots
}

// world.consume: build(list of { index, delay }), setGrow(0..1.5), clear().
export function ConsumingRoots({ world, buildings }) {
  const group = useRef()
  useEffect(() => {
    const grow = { value: 0 }
    const material = rootMaterial(grow, 'consuming-roots')
    let mesh = null
    const clear = () => {
      if (!mesh) return
      group.current?.remove(mesh)
      mesh.geometry.dispose()
      mesh = null
    }
    world.consume = {
      build(list) {
        clear()
        const roots = list.flatMap(({ index, delay }) => consumingRoots(buildings[index], index, delay))
        if (!roots.length) return
        mesh = new THREE.Mesh(rootGeometry(roots), material)
        // They would cast the shadow of their full length before they have grown, so they cast none.
        mesh.receiveShadow = true
        mesh.frustumCulled = false
        group.current.add(mesh)
      },
      setGrow(v) {
        grow.value = v
      },
      clear,
      built: () => mesh !== null,
    }
    return () => {
      clear()
      material.dispose()
      world.consume = null
    }
  }, [world, buildings])
  return <group ref={group} />
}

// ---- diversion: roots that grow around a distant building, the last three kept ----

// Strands that follow the building's footprint just outside its walls, and climbers up the walls.
function rootsAround(building, seed) {
  const { around } = footprint(building)
  const roots = []
  for (let s = 0; s < 3; s++) {
    const pts = around(0.9 + 0.7 * s + 0.4 * hash2(seed, s, 801))
    if (pts.length < 4) continue
    const start = Math.floor(hash2(seed, s, 803) * pts.length)
    const count = Math.max(4, Math.floor(pts.length * (0.55 + 0.45 * hash2(seed, s, 805))))
    const strand = []
    for (let k = 0; k < count; k++) {
      const [x, y, nx, ny] = pts[(start + k) % pts.length]
      const w = valueNoise(k * 0.3, seed + s, 807) * 0.8
      strand.push([x + nx * w, y + ny * w, 0])
    }
    roots.push({ pts: strand, radius: 1.0 + 0.5 * hash2(seed, s, 809), delay: 0, seed: seed * 7 + s })
  }
  const base = around(0.45)
  const climbers = 4 + Math.floor(hash2(seed, 9, 811) * 4)
  for (let c = 0; c < climbers && base.length; c++) {
    const [x, y] = base[Math.floor(hash2(seed, c, 813) * base.length)]
    const top = building.height * (0.3 + 0.45 * hash2(seed, c, 815))
    const pts = []
    for (let h = 0; h <= top; h += 1.2) {
      const w = valueNoise(h * 0.25, seed + c, 817) * 0.7
      pts.push([x + w, y + w * 0.5, h])
    }
    if (pts.length > 2) roots.push({ pts, radius: 0.5 + 0.35 * hash2(seed, c, 819), delay: 0.25, seed: seed * 11 + c })
  }
  return roots
}

export function DiversionRoots({ world, buildings }) {
  const group = useRef()
  useEffect(() => {
    const live = []
    world.divert = {
      grow(index, now) {
        const geometry = rootGeometry(rootsAround(buildings[index], index))
        const grow = { value: 0 }
        const mesh = new THREE.Mesh(geometry, rootMaterial(grow, 'diversion-roots'))
        mesh.castShadow = mesh.receiveShadow = true
        group.current.add(mesh)
        live.push({ mesh, grow, t0: now })
        while (live.length > 3) {
          const old = live.shift()
          group.current.remove(old.mesh)
          old.mesh.geometry.dispose()
          old.mesh.material.dispose()
        }
      },
      update(now) {
        // Grow over eight seconds, then stay: the city remembers where it moved.
        for (const l of live) l.grow.value = Math.min((now - l.t0) / 8, 1) * 0.65
      },
    }
    return () => {
      world.divert = null
      live.forEach((l) => (l.mesh.geometry.dispose(), l.mesh.material.dispose()))
    }
  }, [world, buildings])
  useFrame((state) => world.divert?.update(state.clock.elapsedTime))
  return <group ref={group} />
}
