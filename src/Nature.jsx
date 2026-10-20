import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { stageAt } from './nature.js'
import { widenLines } from './reach.js'
import { BACKGROUND, FACADE, GROUND, NATURE, STREETS, WILD } from './palette.js'

// All nature effects read the same few numbers, shared as shader uniforms.
export function makeNatureUniforms() {
  return {
    uT: { value: 2 }, // growth threshold: places with a higher potential are green
    uHeight: { value: 0 }, // how tall the masses have grown, 0..1
    uDecay: { value: 0 }, // how weathered the buildings are, 0..1
    uClimb: { value: 0 }, // how far vegetation climbs the walls, 0..1
    uRoof: { value: 0 }, // how much of the selected roofs is green, 0..1
    uWild: { value: 0 }, // year 100: the strange new ecosystem, 0..1
    uRoots: { value: 0 }, // how far the roots have grown, 0..1
  }
}

const color = (hex) => ({ value: new THREE.Color(hex) })

// Smoothly follows the slider, then writes the stage's numbers into the uniforms.
export function TimeDriver({ stage, thresholds, uniforms, onChange }) {
  const { scene } = useThree()
  const sky = useMemo(() => [new THREE.Color(BACKGROUND), new THREE.Color(WILD.sky)], [])
  const current = useRef(stage)
  const last = useRef(-1)
  useFrame((_, dt) => {
    const diff = stage - current.current
    current.current = Math.abs(diff) < 0.002 ? stage : current.current + diff * Math.min(1, dt * 3.5)
    if (current.current === last.current) return
    last.current = current.current
    const s = stageAt(current.current, thresholds)
    uniforms.uT.value = s.threshold
    uniforms.uHeight.value = s.height
    uniforms.uDecay.value = s.decay
    uniforms.uClimb.value = s.climb
    uniforms.uRoof.value = s.roof
    uniforms.uWild.value = s.wild
    uniforms.uRoots.value = s.roots
    if (scene.background?.isColor) scene.background.lerpColors(sky[0], sky[1], s.wild)
    onChange(s)
  })
  return null
}

// ---- ground: base colour, pavement, and spreading ground cover ----

export function NatureGround({ size, nature, uniforms, meshRef }) {
  const material = useMemo(() => {
    const { x0, y0, W, H, cell } = nature.grid
    const map = nature.groundMap
    return new THREE.ShaderMaterial({
      uniforms: {
        uT: uniforms.uT,
        uWild: uniforms.uWild,
        uCoverWild: color(WILD.cover),
        uMap: { value: map },
        uRect: { value: new THREE.Vector4(x0, y0, W * cell, H * cell) },
        uGround: color(GROUND),
        uCover1: color(NATURE.cover[0]),
        uCover2: color(NATURE.cover[1]),
        uCover3: color(NATURE.cover[2]),
      },
      vertexShader: /* glsl */ `
        varying vec2 vXY;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vXY = vec2(w.x, -w.z);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec4 uRect;
        uniform float uT, uWild;
        uniform vec3 uGround, uCover1, uCover2, uCover3, uCoverWild;
        varying vec2 vXY;
        void main() {
          vec2 uv = (vXY - uRect.xy) / uRect.zw;
          vec3 col = uGround;
          if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) {
            vec4 m = texture2D(uMap, uv);
            float p = m.r * 2.0 - 1.0;
            // Ground cover runs slightly ahead of the masses; deeper inside it is darker.
            float cover = smoothstep(uT - 0.04, uT - 0.02, p);
            vec3 g = mix(uCover1, uCover2, smoothstep(0.4, 0.6, m.b));
            g = mix(g, uCover3, smoothstep(uT, uT + 0.2, p) * 0.7);
            g = mix(g, uCoverWild, uWild * 0.85);
            col = mix(col, g, cover);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })
  }, [nature, uniforms])
  return (
    <mesh ref={meshRef} rotation-x={-Math.PI / 2} material={material}>
      <planeGeometry args={[size[0] + 400, size[1] + 400]} />
    </mesh>
  )
}

// ---- vegetation masses: one continuous height field, faceted, banded like contours ----

export function VegetationMass({ nature, uniforms }) {
  const { geometry, material } = useMemo(() => {
    const { MW, MH, positions, potential, height, wild } = nature.mass
    const index = []
    for (let r = 0; r < MH - 1; r++)
      for (let c = 0; c < MW - 1; c++) {
        const a = r * MW + c
        const b = a + 1
        const d = a + MW
        const e = d + 1
        // Alternate the diagonal so the facets don't line up in stripes.
        if ((r + c) % 2) index.push(a, d, b, b, d, e)
        else index.push(a, d, e, a, e, b)
      }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aP', new THREE.BufferAttribute(potential, 1))
    geometry.setAttribute('aH', new THREE.BufferAttribute(height, 1))
    geometry.setAttribute('aW', new THREE.BufferAttribute(wild, 1))
    geometry.setIndex(index)
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1500)
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uT: uniforms.uT,
        uHeight: uniforms.uHeight,
        uWild: uniforms.uWild,
        uBands: { value: NATURE.mass.map((h) => new THREE.Color(h)) },
        uBandsWild: { value: WILD.mass.map((h) => new THREE.Color(h)) },
      },
      vertexShader: /* glsl */ `
        attribute float aP;
        attribute float aH;
        attribute float aW;
        uniform float uT, uHeight, uWild;
        varying vec3 vW;
        varying float vG;
        void main() {
          // The mass swells from nothing at its edge to its full height further in.
          float g = clamp((aP - uT) / 0.1, 0.0, 1.0);
          float h = g > 0.0 ? mix(aH, aW, uWild) * uHeight * (0.08 + 0.92 * smoothstep(0.0, 1.0, g)) : -0.6;
          vec4 w = modelMatrix * vec4(position.x, h, position.z, 1.0);
          vW = w.xyz;
          vG = g;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uBands[4], uBandsWild[4];
        uniform float uWild;
        varying vec3 vW;
        varying float vG;
        void main() {
          if (vW.y < 0.15) discard;
          vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
          if (n.y < 0.0) n = -n;
          float light = 0.62 + 0.38 * max(dot(n, normalize(vec3(-0.45, 1.0, 0.3))), 0.0);
          // Height bands: a layered, diagrammatic reading of the mass.
          float h = vW.y;
          int band = h < 2.5 ? 0 : h < 6.0 ? 1 : h < 11.0 ? 2 : 3;
          vec3 col = mix(uBands[band], uBandsWild[band], uWild);
          float edge = min(min(abs(h - 2.5), abs(h - 6.0)), abs(h - 11.0));
          col *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.22, edge));
          gl_FragColor = vec4(col * light, 1.0);
          #include <colorspace_fragment>
        }`,
    })
    return { geometry, material }
  }, [nature, uniforms])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}

// ---- a few distinctive trees, rising out of the masses ----

// Crown proportions: a tall poplar-like column, a round crown, a wide spreading one.
const CROWN = { column: [3.2, 10, 3.2], round: [7, 6, 7], wide: [10, 4.5, 9] }

export function Trees({ nature, params }) {
  const crowns = useRef()
  const trunks = useRef()
  const { trees } = nature
  const crownGeometry = useMemo(() => new THREE.IcosahedronGeometry(1, 1), [])
  const trunkGeometry = useMemo(() => new THREE.CylinderGeometry(0.35, 0.6, 1, 5).translate(0, 0.5, 0), [])

  useEffect(() => {
    const shades = NATURE.trees.map((h) => new THREE.Color(h))
    trees.forEach((t, i) => crowns.current.setColorAt(i, shades[t.shade]))
    crowns.current.instanceColor.needsUpdate = true
  }, [trees])

  useEffect(() => {
    if (!params) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    trees.forEach((t, i) => {
      const g = Math.min(Math.max((t.p - params.threshold) / 0.12, 0), 1) * params.trees
      const s = g * t.size
      q.setFromAxisAngle(up, t.turn)
      const [rx, ry, rz] = CROWN[t.kind]
      const trunk = (t.ground * params.height * 0.75 + 3) * g
      m.compose(new THREE.Vector3(t.x, trunk + ry * s * 0.7, -t.y), q, new THREE.Vector3(rx * s, ry * s, rz * s))
      crowns.current.setMatrixAt(i, m)
      m.compose(new THREE.Vector3(t.x, 0, -t.y), q, new THREE.Vector3(s + 0.001, trunk + 0.001, s + 0.001))
      trunks.current.setMatrixAt(i, m)
    })
    crowns.current.instanceMatrix.needsUpdate = true
    trunks.current.instanceMatrix.needsUpdate = true
  }, [trees, params])

  return (
    <group>
      <instancedMesh ref={crowns} args={[crownGeometry, null, trees.length]} frustumCulled={false}>
        <meshLambertMaterial flatShading />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[trunkGeometry, null, trees.length]} frustumCulled={false}>
        <meshLambertMaterial color={NATURE.trunk} />
      </instancedMesh>
    </group>
  )
}

// ---- streets: carriageway, sidewalks and kerbs, which weeds and then the green take over ----

const ROAD_HALF_M = 3.2
const SIDEWALK_HALF_M = 5.4

function polygonsToGeometry(polygons) {
  const shapes = polygons.map((p) => {
    const sh = new THREE.Shape(p.outer.map(([x, y]) => new THREE.Vector2(x, y)))
    sh.holes = p.holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
    return sh
  })
  return new THREE.ShapeGeometry(shapes).rotateX(-Math.PI / 2)
}

function outlineGeometry(polygons) {
  const pos = []
  for (const p of polygons)
    for (const ring of [p.outer, ...p.holes])
      for (let i = 0; i < ring.length; i++) {
        const [a, b] = [ring[i], ring[(i + 1) % ring.length]]
        pos.push(a[0], 0, -a[1], b[0], 0, -b[1])
      }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
}

function streetMaterial(nature, uniforms, hex, limit) {
  const { x0, y0, W, H, cell } = nature.grid
  return new THREE.ShaderMaterial({
    uniforms: {
      uT: uniforms.uT,
      uDecay: uniforms.uDecay,
      uMap: { value: nature.groundMap },
      uRect: { value: new THREE.Vector4(x0, y0, W * cell, H * cell) },
      uColor: color(hex),
      uWeed: color(STREETS.weeds),
      uLimit: { value: limit },
    },
    vertexShader: /* glsl */ `
      varying vec2 vXY;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vXY = vec2(w.x, -w.z);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec4 uRect;
      uniform float uT, uDecay, uLimit;
      uniform vec3 uColor, uWeed;
      varying vec2 vXY;
      ${GLSL_NOISE}
      void main() {
        vec4 m = texture2D(uMap, (vXY - uRect.xy) / uRect.zw);
        float p = m.r * 2.0 - 1.0;
        // Where the ground cover has arrived the pavement is gone and the ground shows.
        if (smoothstep(uT - 0.04, uT - 0.02, p) > uLimit) discard;
        // Quiet patches of older and newer surface, then stains with age.
        vec3 col = uColor * (0.965 + 0.06 * vnoise(vXY * 0.045));
        col = mix(col, col * 0.9, uDecay * smoothstep(0.55, 0.75, vnoise(vXY * 0.16)));
        // Weeds in the cracks, a little ahead of the cover.
        float weeds = step(0.7, vnoise(vXY * 0.7 + m.b * 4.0)) * smoothstep(uT - 0.17, uT - 0.06, p);
        col = mix(col, uWeed, weeds * 0.9);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    depthWrite: false,
  })
}

export function StreetSurface({ edges, nature, uniforms }) {
  const parts = useMemo(() => {
    const lines = edges.map((e) => e.points)
    const road = widenLines(lines, ROAD_HALF_M)
    const sidewalk = widenLines(lines, SIDEWALK_HALF_M)
    return {
      sidewalk: { geometry: polygonsToGeometry(sidewalk), material: streetMaterial(nature, uniforms, STREETS.sidewalk, 0.5) },
      road: { geometry: polygonsToGeometry(road), material: streetMaterial(nature, uniforms, STREETS.road, 0.5) },
      kerb: { geometry: outlineGeometry(road), material: streetMaterial(nature, uniforms, STREETS.kerb, 0.2) },
      edge: { geometry: outlineGeometry(sidewalk), material: streetMaterial(nature, uniforms, STREETS.edge, 0.2) },
    }
  }, [edges, nature, uniforms])
  return (
    <group>
      <mesh geometry={parts.sidewalk.geometry} material={parts.sidewalk.material} position-y={0.03} renderOrder={1} />
      <mesh geometry={parts.road.geometry} material={parts.road.material} position-y={0.06} renderOrder={2} />
      <lineSegments geometry={parts.kerb.geometry} material={parts.kerb.material} position-y={0.09} renderOrder={3} />
      <lineSegments geometry={parts.edge.geometry} material={parts.edge.material} position-y={0.09} renderOrder={3} />
    </group>
  )
}

// ---- year 100: giant trees, roots, mushrooms and animals ----

const prep = (g) => {
  const out = g.index ? g.toNonIndexed() : g
  out.deleteAttribute('uv')
  return out
}
const paint = (g, hex) => {
  const c = new THREE.Color(hex)
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}
const grown = (value, order, span) => {
  const t = Math.min(Math.max((value - order) / span, 0), 1)
  return t * t * (3 - 2 * t)
}

// One giant: a tall tapering trunk carrying stacked, flattened canopy layers.
function giantGeometry(g, k) {
  const parts = []
  const trunkH = g.height * 0.82
  parts.push(paint(prep(new THREE.CylinderGeometry(0.45, 1, 1, 7).scale(g.trunk, trunkH, g.trunk).translate(0, trunkH / 2, 0)), WILD.giantTrunk))
  // Buttresses flaring into the roots.
  for (let b = 0; b < 5; b++) {
    const a = g.turn + (b / 5) * Math.PI * 2
    const fin = new THREE.ConeGeometry(1, 1, 4).scale(g.trunk * 0.9, g.trunk * 5, g.trunk * 0.9).rotateZ(0.5).rotateY(-a).translate(Math.cos(a) * g.trunk * 0.9, g.trunk * 2, -Math.sin(a) * g.trunk * 0.9)
    parts.push(paint(prep(fin), WILD.giantTrunk))
  }
  for (let t = 0; t < g.tiers; t++) {
    const r = g.crown * (1 - 0.2 * t)
    const y = g.height * (0.5 + (0.5 / g.tiers) * (t + 0.6))
    const a = g.turn + t * 2.1
    const off = g.crown * 0.12
    const tier = new THREE.IcosahedronGeometry(1, 1).scale(r, r * 0.34, r * 0.9).rotateY(a).translate(Math.cos(a) * off, y, Math.sin(a) * off)
    parts.push(paint(prep(tier), WILD.giantCrown[(t + k) % WILD.giantCrown.length]))
  }
  const merged = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  return merged
}

function Giants({ giants, params }) {
  const geometries = useMemo(() => giants.map(giantGeometry), [giants])
  const refs = useRef([])
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries])
  useEffect(() => {
    giants.forEach((g, i) => {
      const s = grown(params?.giants ?? 0, g.order * 0.5, 0.5)
      const m = refs.current[i]
      if (!m) return
      m.visible = s > 0.001
      m.scale.set(0.35 + 0.65 * s, s, 0.35 + 0.65 * s) // rises out of the ground, widening as it goes
    })
  }, [giants, params])
  return (
    <group>
      {giants.map((g, i) => (
        <mesh key={i} ref={(m) => (refs.current[i] = m)} geometry={geometries[i]} position={[g.x, 0, -g.y]} visible={false}>
          <meshLambertMaterial vertexColors flatShading />
        </mesh>
      ))}
    </group>
  )
}

// All roots in one mesh: tapering tubes, half sunk into the ground, that grow out from their tree.
function Roots({ roots, uniforms }) {
  const { geometry, material } = useMemo(() => {
    const SIDES = 6
    const pos = []
    const along = []
    const start = []
    const index = []
    for (const root of roots) {
      const { pts, radius, delay } = root
      const base = pos.length / 3
      const cum = [0]
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
      const total = cum[cum.length - 1]
      pts.forEach(([px, py], i) => {
        const [qa, qb] = [pts[Math.max(i - 1, 0)], pts[Math.min(i + 1, pts.length - 1)]]
        const l = Math.hypot(qb[0] - qa[0], qb[1] - qa[1]) || 1
        const [lx, ly] = [-(qb[1] - qa[1]) / l, (qb[0] - qa[0]) / l]
        const t = cum[i] / total
        const r = radius * (1 - 0.8 * t) * (i === 0 ? 1.4 : 1)
        for (let k = 0; k < SIDES; k++) {
          const th = (k / SIDES) * Math.PI * 2
          pos.push(px + lx * Math.cos(th) * r, r * 0.15 + Math.sin(th) * r, -(py + ly * Math.cos(th) * r))
          along.push(t)
          start.push(delay * 0.6)
        }
      })
      for (let i = 0; i < pts.length - 1; i++)
        for (let k = 0; k < SIDES; k++) {
          const a = base + i * SIDES + k
          const b = base + i * SIDES + ((k + 1) % SIDES)
          index.push(a, b, a + SIDES, b, b + SIDES, a + SIDES)
        }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1))
    geometry.setAttribute('aStart', new THREE.Float32BufferAttribute(start, 1))
    geometry.setIndex(index)
    const material = new THREE.ShaderMaterial({
      uniforms: { uRoots: uniforms.uRoots, uColor: color(WILD.root), uMoss: color(WILD.rootMoss) },
      vertexShader: /* glsl */ `
        attribute float aAlong;
        attribute float aStart;
        varying float vAlong, vStart;
        varying vec3 vW;
        void main() {
          vAlong = aAlong;
          vStart = aStart;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uRoots;
        uniform vec3 uColor, uMoss;
        varying float vAlong, vStart;
        varying vec3 vW;
        void main() {
          if (vAlong > clamp((uRoots - vStart) / 0.4, 0.0, 1.0) || vW.y < 0.0) discard;
          vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
          if (n.y < 0.0) n = -n;
          float light = 0.6 + 0.4 * max(dot(n, normalize(vec3(-0.45, 1.0, 0.3))), 0.0);
          vec3 col = mix(uColor, uMoss, smoothstep(0.8, 0.95, n.y) * 0.45);
          gl_FragColor = vec4(col * light, 1.0);
          #include <colorspace_fragment>
        }`,
    })
    return { geometry, material }
  }, [roots, uniforms])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}

function Mushrooms({ mushrooms, params }) {
  const stems = useRef()
  const caps = useRef()
  const stemGeometry = useMemo(() => new THREE.CylinderGeometry(0.55, 1, 1, 9).translate(0, 0.5, 0), [])
  const capGeometry = useMemo(() => new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), [])
  useEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    mushrooms.forEach((f, i) => {
      const s = grown(params?.mushrooms ?? 0, f.order * 0.6, 0.4)
      q.setFromEuler(new THREE.Euler(f.tilt, 0, f.tilt * 0.6))
      const h = f.height * s
      m.compose(new THREE.Vector3(f.x, 0, -f.y), q, new THREE.Vector3(f.cap * 0.16 * s + 1e-4, h + 1e-4, f.cap * 0.16 * s + 1e-4))
      stems.current.setMatrixAt(i, m)
      const top = new THREE.Vector3(0, h, 0).applyQuaternion(q)
      m.compose(new THREE.Vector3(f.x + top.x, top.y - f.cap * 0.1 * s, -f.y + top.z), q, new THREE.Vector3(f.cap * s + 1e-4, f.cap * 0.55 * s + 1e-4, f.cap * s + 1e-4))
      caps.current.setMatrixAt(i, m)
    })
    stems.current.instanceMatrix.needsUpdate = true
    caps.current.instanceMatrix.needsUpdate = true
  }, [mushrooms, params])
  return (
    <group>
      <instancedMesh ref={stems} args={[stemGeometry, null, mushrooms.length]} frustumCulled={false}>
        <meshLambertMaterial color={WILD.mushroomStem} flatShading />
      </instancedMesh>
      <instancedMesh ref={caps} args={[capGeometry, null, mushrooms.length]} frustumCulled={false}>
        <meshLambertMaterial color={WILD.mushroomCap} flatShading />
      </instancedMesh>
    </group>
  )
}

// Animals from a few blocks each, facing +x, in metres.
const box = (w, h, d, x, y, z, rz = 0, rx = 0) => new THREE.BoxGeometry(w, h, d).rotateX(rx).rotateZ(rz).translate(x, y, z)
const legs = (dx, dz, h, t) => [-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(t, h, t, sx * dx, h / 2, sz * dz)))
const ANIMAL_PARTS = {
  deer: () => [box(1.5, 0.6, 0.45, 0, 1.1, 0), box(0.25, 0.7, 0.22, 0.7, 1.55, 0, -0.45), box(0.45, 0.24, 0.22, 0.98, 1.88, 0), box(0.05, 0.6, 0.05, 0.9, 2.25, 0.12, 0.2, -0.45), box(0.05, 0.6, 0.05, 0.9, 2.25, -0.12, 0.2, 0.45), ...legs(0.6, 0.15, 0.85, 0.11)],
  boar: () => [box(1.25, 0.62, 0.6, 0, 0.68, 0), box(0.9, 0.14, 0.14, -0.05, 1.03, 0), box(0.5, 0.42, 0.42, 0.78, 0.62, 0, 0.25), box(0.2, 0.2, 0.22, 1.08, 0.48, 0), ...legs(0.42, 0.18, 0.42, 0.13)],
  fox: () => [box(0.8, 0.3, 0.26, 0, 0.5, 0), box(0.3, 0.24, 0.22, 0.5, 0.64, 0), box(0.18, 0.1, 0.1, 0.7, 0.6, 0), box(0.06, 0.15, 0.06, 0.48, 0.82, 0.07), box(0.06, 0.15, 0.06, 0.48, 0.82, -0.07), box(0.62, 0.14, 0.14, -0.64, 0.5, 0, 0.35), ...legs(0.28, 0.09, 0.38, 0.07)],
}
const ANIMAL_SCALE = 1.8 // slightly larger than life, so they read at city scale

function Animals({ animals, params }) {
  const kinds = useMemo(
    () =>
      Object.keys(ANIMAL_PARTS).map((kind) => {
        const parts = ANIMAL_PARTS[kind]()
        const geometry = mergeGeometries(parts)
        parts.forEach((p) => p.dispose())
        return { kind, geometry, list: animals.filter((a) => a.kind === kind) }
      }),
    [animals],
  )
  const refs = useRef({})
  useEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    for (const { kind, list } of kinds) {
      const mesh = refs.current[kind]
      if (!mesh) continue
      list.forEach((a, i) => {
        const s = grown(params?.animals ?? 0, a.order * 0.7, 0.3) * a.size * ANIMAL_SCALE + 1e-4
        q.setFromAxisAngle(up, a.turn)
        m.compose(new THREE.Vector3(a.x, 0, -a.y), q, new THREE.Vector3(s, s, s))
        mesh.setMatrixAt(i, m)
      })
      mesh.instanceMatrix.needsUpdate = true
    }
  }, [kinds, params])
  return (
    <group>
      {kinds.map(({ kind, geometry, list }) => (
        <instancedMesh key={kind} ref={(m) => (refs.current[kind] = m)} args={[geometry, null, list.length]} frustumCulled={false}>
          <meshLambertMaterial color={WILD[kind]} flatShading />
        </instancedMesh>
      ))}
    </group>
  )
}

export function Wild({ nature, params, uniforms }) {
  return (
    <group>
      <Giants giants={nature.giants} params={params} />
      <Roots roots={nature.roots} uniforms={uniforms} />
      <Mushrooms mushrooms={nature.mushrooms} params={params} />
      <Animals animals={nature.animals} params={params} />
    </group>
  )
}

// ---- buildings: weathering, moss, ivy on the walls and green on selected roofs ----

const GLSL_NOISE = /* glsl */ `
  float nHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(nHash(i), nHash(i + vec2(1, 0)), u.x), mix(nHash(i + vec2(0, 1)), nHash(i + vec2(1, 1)), u.x), u.y);
  }`

// Adds the decay effects to the buildings' existing material, keeping its lighting.
export function decayBuildings(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uDecay: uniforms.uDecay,
      uClimb: uniforms.uClimb,
      uRoof: uniforms.uRoof,
      uWild: uniforms.uWild,
      uBleach: color(WILD.bleached),
      uWildGreen: color(WILD.mass[2]),
      uMoss: color(NATURE.moss),
      uIvy: color(NATURE.ivy),
      uRoofGreen: color(NATURE.roof),
      uGlass: color(FACADE.glass),
      uFrame: color(FACADE.frame),
    })
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aSeed;
        attribute float aHl;
        attribute float aTop;
        attribute float aFloors;
        attribute float aShop;
        attribute vec3 aRoofColor;
        attribute vec2 aSeg;
        varying float vSeed, vHl, vTop, vFloors, vShop;
        varying vec3 vWP, vWN, vRoofColor;
        varying vec2 vSeg;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);
        vSeed = aSeed; vHl = aHl; vTop = aTop;
        vFloors = aFloors; vShop = aShop; vRoofColor = aRoofColor; vSeg = aSeg;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uDecay, uClimb, uRoof, uWild;
        uniform vec3 uMoss, uIvy, uRoofGreen, uBleach, uWildGreen, uGlass, uFrame;
        varying float vSeed, vHl, vTop, vFloors, vShop;
        varying vec3 vWP, vWN, vRoofColor;
        varying vec2 vSeg;
        ${GLSL_NOISE}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float facadeWindow = 0.0; // how much of this pixel is window, for the decay below
        if (vHl < 0.5) {
          vec3 c = diffuseColor.rgb;
          if (vWN.y > 0.5) {
            c = vRoofColor;
          } else if (abs(vWN.y) < 0.5 && vSeg.y > 0.0) {
            // ---- facade: plinth, cornice, one row of windows per floor, shop fronts ----
            float y = vWP.y;
            float floorH = clamp(vTop * 0.92 / vFloors, 2.6, 4.5);
            float row = floor(y / floorH);
            float fy = fract(y / floorH);
            float bays = max(1.0, floor(vSeg.y / 3.2));
            float bay = vSeg.y / bays;
            float fu = fract(vSeg.x / bay);
            float bayIndex = floor(vSeg.x / bay);
            bool shopRow = vShop > 0.5 && row < 0.5;
            vec2 lo = shopRow ? vec2(0.1, 0.08) : vec2(0.3, 0.32);
            vec2 hi = shopRow ? vec2(0.9, 0.8) : vec2(0.7, 0.8);
            // Windows only on walls long enough, on real floors, and below the cornice.
            float has = step(1.8, vSeg.y) * step(row + 1.0, vFloors + 0.5) * step((row + hi.y) * floorH, vTop - 0.5);
            vec2 fr = vec2(0.11 / bay, 0.1 / floorH);
            float win = has * step(lo.x, fu) * step(fu, hi.x) * step(lo.y, fy) * step(fy, hi.y);
            float frame = has * step(lo.x - fr.x, fu) * step(fu, hi.x + fr.x) * step(lo.y - fr.y, fy) * step(fy, hi.y + fr.y);
            float sill = has * step(lo.x - fr.x * 1.6, fu) * step(fu, hi.x + fr.x * 1.6) * step(lo.y - fr.y * 2.2, fy) * step(fy, lo.y - fr.y);
            float plinth = step(y, 0.6);
            float cornice = step(vTop - 0.45, y);
            float course = step(1.5, vFloors) * (1.0 - step(0.07, abs(y - floorH)));
            // Each pane a little different; with the years more and more are broken and dark.
            float h = nHash(vec2(bayIndex, row) + vSeed * 91.0);
            vec3 glass = uGlass * (0.85 + 0.5 * h);
            glass = mix(glass, vec3(0.05, 0.05, 0.05), uDecay * step(1.0 - uDecay, h));
            vec3 f = c;
            f = mix(f, c * 0.8, plinth);
            f = mix(f, c * 0.86, max(cornice, course));
            f = mix(f, c * 0.72, sill);
            f = mix(f, mix(c, uFrame, 0.7), frame - sill * frame);
            f = mix(f, glass, win);
            // Far away, windows shrink below a pixel: blend to the facade's average tone instead of flickering.
            float fw = max(fwidth(vSeg.x) / bay, fwidth(y) / floorH);
            vec3 average = mix(c, uGlass, 0.16 * step(1.8, vSeg.y));
            float far = smoothstep(0.06, 0.22, fw);
            c = mix(f, average, far);
            facadeWindow = win * (1.0 - far);
          }
          diffuseColor.rgb = c;
        }
        if (vHl < 0.5 && uDecay > 0.0) {
          vec3 c = diffuseColor.rgb;
          // Fade towards a slightly darker, desaturated grey.
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(c, vec3(lum) * vec3(0.95, 0.96, 0.93), uDecay * 0.9);
          c *= 1.0 - 0.3 * uDecay;
          c = mix(c, uBleach, uWild * 0.7);
          c = mix(c, vec3(0.06, 0.065, 0.06), facadeWindow * uWild * 0.9); // empty, dark window openings
          // Weathering stains, then moss.
          float n1 = vnoise(vWP.xz * 0.11 + vWP.y * 0.07);
          float n2 = vnoise(vWP.xz * 0.3 + vec2(vWP.y * 0.25, vSeed * 30.0));
          c = mix(c, c * 0.8, smoothstep(0.62, 0.8, n1) * uDecay);
          c = mix(c, uMoss, smoothstep(0.74, 0.88, n2) * smoothstep(0.4, 1.0, uDecay) * 0.75);
          if (vWN.y > 0.5) {
            // Green on selected roofs, in irregular patches.
            if (vSeed < 0.55 * uRoof) {
              float rn = vnoise(vWP.xz * 0.09 + vSeed * 50.0);
              float limit = 1.0 - 0.85 * uRoof;
              c = mix(c, mix(uRoofGreen, uWildGreen, uWild * 0.8), smoothstep(limit - 0.06, limit + 0.06, rn));
            }
          } else if (uClimb > 0.0) {
            // Ivy rising up the walls: high on selected buildings, a low fringe on the others.
            float share = vSeed < 0.6 * uClimb ? 1.0 : 0.22;
            float along = vnoise(vec2((vWP.x + vWP.z) * 0.13, vSeed * 40.0));
            float level = uClimb * share * vTop * (0.2 + 0.8 * along);
            c = mix(c, mix(uIvy, uWildGreen, uWild * 0.8), 1.0 - smoothstep(level - 0.5, level + 0.5, vWP.y));
          }
          diffuseColor.rgb = c;
        }`,
      )
  }
  material.customProgramCacheKey = () => 'facade-decay-buildings'
}
