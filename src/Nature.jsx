import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MASS_EDGE, WORLD, hash2, valueNoise } from './nature.js'
import { widenLines } from './reach.js'
import { FACADE, GROUND, NATURE, STREETS, WILD } from './palette.js'
import { ENTITY, FOG_FRAGMENT_PARS, FOG_VERTEX_PARS, GLSL_ENTITY, GLSL_NOISE, extendMaterial, fogUniforms } from './shaders.js'

// The world is fixed at a hundred years after people; these are its numbers, as shader uniforms.
export function makeNatureUniforms(threshold) {
  return {
    uT: { value: threshold }, // growth threshold: places with a higher potential are green
    uHeight: { value: WORLD.height }, // how tall the masses have grown, 0..1
    uDecay: { value: WORLD.decay }, // how weathered the buildings are, 0..1
    uClimb: { value: WORLD.climb }, // how far vegetation climbs the walls
    uRoof: { value: WORLD.roof }, // how much of the selected roofs is green, 0..1
    uWild: { value: WORLD.wild }, // the strange new ecosystem, 0..1
    uRoots: { value: WORLD.roots }, // how far the roots have grown, 0..1
  }
}

const color = (hex) => ({ value: new THREE.Color(hex) })

// ---- ground: broken pavement, spreading ground cover, and the forest floor at the edges ----

export function NatureGround({ nature, uniforms, meshRef, rect }) {
  const material = useMemo(() => {
    const { x0, y0, W, H, cell } = nature.grid
    const m = new THREE.MeshLambertMaterial({ color: '#ffffff', polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
    return extendMaterial(m, 'nature-ground', {
      uniforms: {
        uT: uniforms.uT,
        uMap: { value: nature.groundMap },
        uRect: { value: new THREE.Vector4(x0, y0, W * cell, H * cell) },
        uBare: color(GROUND.bare),
        uFloor: color(GROUND.floor),
        uCover1: color(NATURE.cover[0]),
        uCover2: color(NATURE.cover[1]),
        uCover3: color(NATURE.cover[2]),
        uCoverWild: color(WILD.cover),
      },
      vertexPars: 'varying vec2 vXY;',
      vertex: 'vec4 gw = modelMatrix * vec4(transformed, 1.0); vXY = vec2(gw.x, -gw.z);',
      fragmentPars: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec4 uRect;
        uniform float uT;
        uniform vec3 uBare, uFloor, uCover1, uCover2, uCover3, uCoverWild;
        varying vec2 vXY;`,
      fragment: /* glsl */ `
        vec2 uv = (vXY - uRect.xy) / uRect.zw;
        vec3 col = uFloor;
        if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) {
          vec4 m = texture2D(uMap, uv);
          float p = m.r * 2.0 - 1.0;
          float cover = smoothstep(uT - 0.04, uT - 0.02, p);
          vec3 g = mix(uCover1, uCover2, smoothstep(0.4, 0.6, m.b));
          g = mix(g, uCover3, smoothstep(uT, uT + 0.2, p) * 0.7);
          g = mix(g, uCoverWild, 0.6);
          vec3 bare = uBare * (0.8 + 0.35 * vnoise(vXY * 0.35));
          col = mix(bare, g, cover);
          // Toward the edge of the modelled city, the ground becomes the surrounding forest floor.
          vec2 e = min(uv, 1.0 - uv) * uRect.zw;
          col = mix(uFloor, col, smoothstep(0.0, 80.0, min(e.x, e.y)));
        }
        // Leaf litter, moss and soil, at two scales.
        col *= 0.78 + 0.34 * fbm3(vXY * 0.07) + 0.1 * vnoise(vXY * 0.8);
        diffuseColor.rgb = col;`,
    })
  }, [nature, uniforms])
  const [w, h] = [rect[2] - rect[0], rect[3] - rect[1]]
  return (
    <mesh ref={meshRef} rotation-x={-Math.PI / 2} position={[(rect[0] + rect[2]) / 2, 0, -(rect[1] + rect[3]) / 2]} material={material} receiveShadow>
      <planeGeometry args={[w, h]} />
    </mesh>
  )
}

// ---- vegetation masses: one continuous canopy over the ground, swelling against the walls ----

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
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(positions.length).fill(0), 3))
    geometry.setAttribute('aP', new THREE.BufferAttribute(potential, 1))
    geometry.setAttribute('aH', new THREE.BufferAttribute(height, 1))
    geometry.setAttribute('aW', new THREE.BufferAttribute(wild, 1))
    geometry.setIndex(index)
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1500)
    const m = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true })
    const material = extendMaterial(m, 'vegetation-mass', {
      uniforms: {
        uT: uniforms.uT,
        uHeight: uniforms.uHeight,
        uWild: uniforms.uWild,
        uBands: { value: NATURE.cover.slice(0, 1).concat(WILD.mass.slice(1)).map((h) => new THREE.Color(h)) },
      },
      vertexPars: /* glsl */ `
        attribute float aP;
        attribute float aH;
        attribute float aW;
        uniform float uT, uHeight, uWild;
        varying vec3 vMP;
        varying float vAbove;`,
      vertex: /* glsl */ `
        // The mass swells from nothing at its edge to its full height further in.
        float g = clamp((aP - uT) / ${MASS_EDGE.toFixed(3)}, 0.0, 1.0);
        transformed.xz += (vec2(nHash(position.xz), nHash(position.zx + 3.1)) - 0.5) * 3.2;
        vec3 base = (modelMatrix * vec4(transformed, 1.0)).xyz;
        float h = mix(aH, aW, uWild) * uHeight * (0.08 + 0.92 * smoothstep(0.0, 1.0, g));
        // Billowing crowns rather than a smooth sheet.
        h += g * (1.8 * vnoise(base.xz * 0.11) + 0.9 * vnoise(base.xz * 0.37));
        // The entity: concealment and bursts swell the canopy, retreat sinks it, the wave lifts it,
        // and inside the upheaval it grows thicker.
        float k = 1.0 + 0.8 * uConcealA * fieldAt(uConceal, base) + 0.9 * uSurgeA * fieldAt(uSurge, base)
                - 0.6 * uRetreatA * fieldAt(uRetreat, base) + 0.6 * ripple(base) + 0.4 * swellAt(base);
        k += 0.15 * uAgitateA * fieldAt(uAgitate, base) * sin(uTime * 3.1 + base.x * 0.21 + base.z * 0.17);
        h = g > 0.0 ? h * min(k, 1.7) : -0.6;
        vAbove = h;
        // It rides on the risen land, so the canopy and the ground move as one.
        transformed.y = upheaval(base.xz) + h;
        vMP = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      fragmentPars: /* glsl */ `
        uniform vec3 uBands[4];
        varying vec3 vMP;
        varying float vAbove;`,
      fragment: /* glsl */ `
        if (vAbove < 0.15) discard;
        float hh = vAbove;
        vec3 col = mix(uBands[0], uBands[1], smoothstep(0.5, 5.0, hh));
        col = mix(col, uBands[2], smoothstep(4.0, 13.0, hh));
        col = mix(col, uBands[3], smoothstep(12.0, 28.0, hh) * 0.8);
        // Leaf clusters, gaps of shade between them, and sunlit, yellower patches.
        float leaf = fbm3(vMP.xz * 0.32 + vMP.y * 0.21);
        col *= 0.62 + 0.62 * leaf;
        col = mix(col, col * vec3(1.15, 1.12, 0.82), smoothstep(0.62, 0.85, vnoise(vMP.xz * 0.035)) * 0.6);
        diffuseColor.rgb = col;`,
      // A canopy is lit through and around itself: turn each facet halfway toward the sky, so the
      // sides away from the low sun are shaded, not black.
      normalFragment: 'normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.5));',
    })
    return { geometry, material }
  }, [nature, uniforms])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={material} frustumCulled={false} receiveShadow />
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

const STREET_FRAGMENT = /* glsl */ `
  vec4 sm = texture2D(uMap, (vXY - uRect.xy) / uRect.zw);
  float sp = sm.r * 2.0 - 1.0;
  // Where the ground cover has arrived the pavement is gone and the ground shows.
  if (smoothstep(uT - 0.04, uT - 0.02, sp) > uLimit) discard;
  // Patches of older and newer surface, stains, then weeds in the cracks.
  vec3 scol = uColor * (0.9 + 0.14 * vnoise(vXY * 0.045));
  scol = mix(scol, scol * 0.78, smoothstep(0.5, 0.75, vnoise(vXY * 0.16)));
  float cracks = 1.0 - smoothstep(0.0, 0.03, abs(vnoise(vXY * 0.5) - 0.5));
  scol = mix(scol, scol * 0.55, cracks * 0.7);
  float weeds = max(step(0.66, vnoise(vXY * 0.7 + sm.b * 4.0)), cracks * 0.8) * smoothstep(uT - 0.2, uT - 0.06, sp);
  scol = mix(scol, uWeed * (0.8 + 0.4 * vnoise(vXY * 2.3)), weeds * 0.9);`

const streetUniforms = (nature, uniforms, hex, limit) => {
  const { x0, y0, W, H, cell } = nature.grid
  return {
    uT: uniforms.uT,
    uMap: { value: nature.groundMap },
    uRect: { value: new THREE.Vector4(x0, y0, W * cell, H * cell) },
    uColor: color(hex),
    uWeed: color(STREETS.weeds),
    uLimit: { value: limit },
  }
}
const STREET_PARS = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec4 uRect;
  uniform float uT, uLimit;
  uniform vec3 uColor, uWeed;
  varying vec2 vXY;`

// Paved surfaces: lit, so the buildings' shadows fall across them.
function streetSurfaceMaterial(nature, uniforms, hex, limit, key) {
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff', depthWrite: false })
  return extendMaterial(m, key, {
    uniforms: streetUniforms(nature, uniforms, hex, limit),
    vertexPars: 'varying vec2 vXY;',
    vertex: 'vec4 sw = modelMatrix * vec4(transformed, 1.0); vXY = vec2(sw.x, -sw.z);',
    fragmentPars: STREET_PARS,
    fragment: STREET_FRAGMENT + '\n diffuseColor.rgb = scol;',
  })
}

// Kerb lines: thin, unlit, in the same haze.
function kerbMaterial(nature, uniforms, hex, limit) {
  return new THREE.ShaderMaterial({
    uniforms: { ...streetUniforms(nature, uniforms, hex, limit), ...fogUniforms() },
    fog: true,
    vertexShader: /* glsl */ `
      varying vec2 vXY;
      ${FOG_VERTEX_PARS}
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vXY = vec2(w.x, -w.z);
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${STREET_PARS}
      ${GLSL_NOISE}
      ${FOG_FRAGMENT_PARS}
      void main() {
        ${STREET_FRAGMENT}
        gl_FragColor = vec4(scol * 0.75, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
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
      sidewalk: { geometry: polygonsToGeometry(sidewalk), material: streetSurfaceMaterial(nature, uniforms, STREETS.sidewalk, 0.5, 'street-sidewalk') },
      road: { geometry: polygonsToGeometry(road), material: streetSurfaceMaterial(nature, uniforms, STREETS.road, 0.5, 'street-road') },
      kerb: { geometry: outlineGeometry(road), material: kerbMaterial(nature, uniforms, STREETS.kerb, 0.2) },
      edge: { geometry: outlineGeometry(sidewalk), material: kerbMaterial(nature, uniforms, STREETS.edge, 0.2) },
    }
  }, [edges, nature, uniforms])
  return (
    <group>
      <mesh geometry={parts.sidewalk.geometry} material={parts.sidewalk.material} position-y={0.03} renderOrder={1} receiveShadow />
      <mesh geometry={parts.road.geometry} material={parts.road.material} position-y={0.06} renderOrder={2} receiveShadow />
      <lineSegments geometry={parts.kerb.geometry} material={parts.kerb.material} position-y={0.09} renderOrder={3} />
      <lineSegments geometry={parts.edge.geometry} material={parts.edge.material} position-y={0.09} renderOrder={3} />
    </group>
  )
}

// ---- roots: knotted, flattened tubes that flare from the trunk, dip into the soil and climb walls ----

const ROOT_SIDES = 9

// One mesh for many roots. Each root is { pts: [[x, y, h], ...], radius, delay, seed }.
export function rootGeometry(roots) {
  const pos = []
  const along = []
  const start = []
  const tone = []
  const index = []
  const T = new THREE.Vector3()
  const N = new THREE.Vector3()
  const B = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  for (const root of roots) {
    const { pts, radius, delay = 0, seed = 0 } = root
    const base = pos.length / 3
    const centres = pts.map(([x, y, h]) => new THREE.Vector3(x, h, -y))
    const cum = [0]
    for (let i = 1; i < centres.length; i++) cum.push(cum[i - 1] + centres[i].distanceTo(centres[i - 1]))
    const total = cum[cum.length - 1] || 1
    const tn = hash2(seed, 1, 331)
    centres.forEach((c, i) => {
      const t = cum[i] / total
      const flare = 1 + 0.8 * Math.exp(-cum[i] / (radius * 2.5)) // a wide foot where it leaves the trunk
      const knot = 0.8 + 0.4 * (valueNoise(cum[i] * 0.18, seed, 337) * 0.5 + 0.5) // swellings and knots
      const r = radius * Math.pow(1 - 0.85 * t, 1.2) * flare * knot
      const onGround = pts[i][2] < 0.01
      // On the ground a root is wider than tall, and it dips in and out of the soil.
      const w = onGround ? r * 1.15 : r
      const hgt = onGround ? r * 0.85 : r
      const lift = onGround ? hgt * (valueNoise(cum[i] * 0.06, seed, 347) * 0.75 + 0.1) : 0
      T.subVectors(centres[Math.min(i + 1, centres.length - 1)], centres[Math.max(i - 1, 0)]).normalize()
      if (i === 0) {
        N.crossVectors(T, up)
        if (N.lengthSq() < 1e-4) N.set(1, 0, 0)
        N.normalize()
      } else {
        N.addScaledVector(T, -N.dot(T)).normalize() // carry the frame along the curve
      }
      B.crossVectors(N, T).normalize()
      for (let k = 0; k < ROOT_SIDES; k++) {
        const th = (k / ROOT_SIDES) * Math.PI * 2
        const [cw, sh] = [Math.cos(th) * w, Math.sin(th) * hgt]
        pos.push(c.x + N.x * cw + B.x * sh, c.y + N.y * cw + B.y * sh + lift, c.z + N.z * cw + B.z * sh)
        along.push(t)
        start.push(delay * 0.6)
        tone.push(tn)
      }
    })
    for (let i = 0; i < centres.length - 1; i++)
      for (let k = 0; k < ROOT_SIDES; k++) {
        const a = base + i * ROOT_SIDES + k
        const b = base + i * ROOT_SIDES + ((k + 1) % ROOT_SIDES)
        index.push(a, b, a + ROOT_SIDES, b, b + ROOT_SIDES, a + ROOT_SIDES)
      }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3))
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1))
  geometry.setAttribute('aStart', new THREE.Float32BufferAttribute(start, 1))
  geometry.setAttribute('aTone', new THREE.Float32BufferAttribute(tone, 1))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

// Bark: dark, streaked along the root, greener with moss on top. `grow` reveals it from the trunk out.
export function rootMaterial(grow, key) {
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, side: THREE.DoubleSide })
  return extendMaterial(m, key, {
    uniforms: { uGrow: grow, uBark: color(WILD.root), uBark2: color(NATURE.bark[1]), uMossR: color(WILD.rootMoss) },
    vertexPars: /* glsl */ `
      attribute float aAlong;
      attribute float aStart;
      attribute float aTone;
      varying float vAlong, vStart, vTone;
      varying vec3 vRP;`,
    vertex: /* glsl */ `
      vAlong = aAlong; vStart = aStart; vTone = aTone;
      vec3 rw = (modelMatrix * vec4(transformed, 1.0)).xyz;
      // Stirring roots writhe a little.
      float agit = uAgitateA * fieldAt(uAgitate, rw) + ripple(rw);
      transformed.y += agit * 0.35 * sin(uTime * 2.3 + aAlong * 18.0) * aAlong;
      // Where the land rises, roots on the ground ride on it; those up a wall stay, and come out of it.
      transformed.y += upheaval(rw.xz) * (1.0 - smoothstep(0.0, 3.0, rw.y));
      vRP = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    fragmentPars: /* glsl */ `
      uniform float uGrow;
      uniform vec3 uBark, uBark2, uMossR;
      varying float vAlong, vStart, vTone;
      varying vec3 vRP;`,
    fragment: /* glsl */ `
      if (vAlong > clamp((uGrow - vStart) / 0.4, 0.0, 1.0)) discard;
      vec3 fn = normalize(cross(dFdx(vRP), dFdy(vRP)));
      if (fn.y < 0.0) fn = -fn;
      vec3 bark = mix(uBark, uBark2, vTone);
      bark *= 0.72 + 0.45 * vnoise(vec2(vAlong * 60.0, vRP.y * 3.0 + vTone * 20.0));
      bark = mix(bark * 1.25, uMossR, smoothstep(0.55, 0.95, fn.y) * (0.35 + 0.45 * vnoise(vRP.xz * 0.4)));
      diffuseColor.rgb = bark;`,
  })
}

function Roots({ roots, uniforms }) {
  const geometry = useMemo(() => rootGeometry(roots), [roots])
  const material = useMemo(() => rootMaterial(uniforms.uRoots, 'roots'), [uniforms])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={material} frustumCulled={false} castShadow receiveShadow />
}

// ---- year 100 inhabitants: mushrooms and animals ----

const grown = (value, order, span) => {
  const t = Math.min(Math.max((value - order) / span, 0), 1)
  return t * t * (3 - 2 * t)
}

function Mushrooms({ mushrooms }) {
  const stems = useRef()
  const caps = useRef()
  const stemGeometry = useMemo(() => new THREE.CylinderGeometry(0.55, 1, 1, 9).translate(0, 0.5, 0), [])
  const capGeometry = useMemo(() => new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), [])
  useEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    mushrooms.forEach((f, i) => {
      const s = grown(WORLD.mushrooms, f.order * 0.6, 0.4)
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
  }, [mushrooms])
  return (
    <group>
      <instancedMesh ref={stems} args={[stemGeometry, null, mushrooms.length]} frustumCulled={false} castShadow>
        <meshLambertMaterial color={WILD.mushroomStem} flatShading />
      </instancedMesh>
      <instancedMesh ref={caps} args={[capGeometry, null, mushrooms.length]} frustumCulled={false} castShadow>
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

function Animals({ animals }) {
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
        const s = grown(WORLD.animals, a.order * 0.7, 0.3) * a.size * ANIMAL_SCALE + 1e-4
        q.setFromAxisAngle(up, a.turn)
        m.compose(new THREE.Vector3(a.x, 0, -a.y), q, new THREE.Vector3(s, s, s))
        mesh.setMatrixAt(i, m)
      })
      mesh.instanceMatrix.needsUpdate = true
    }
  }, [kinds])
  return (
    <group>
      {kinds.map(({ kind, geometry, list }) => (
        <instancedMesh key={kind} ref={(m) => (refs.current[kind] = m)} args={[geometry, null, list.length]} frustumCulled={false} castShadow>
          <meshLambertMaterial color={WILD[kind]} flatShading />
        </instancedMesh>
      ))}
    </group>
  )
}

export function Wild({ nature, uniforms }) {
  return (
    <group>
      <Roots roots={nature.roots} uniforms={uniforms} />
      <Mushrooms mushrooms={nature.mushrooms} />
      <Animals animals={nature.animals} />
    </group>
  )
}

// ---- the upheaval: land that rises around the observed place, over the streets and up the walls ----

// One finely divided sheet, 900 m across, moved to wherever the entity raises the ground. Its height
// comes from upheaval() in shaders.js, the same function that lifts the masses, trees and roots,
// so everything rests on one smooth, continuous surface with no seams or holes.
const UPHEAVAL_SIZE = 900
export function Upheaval({ world }) {
  const ref = useRef()
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(UPHEAVAL_SIZE, UPHEAVAL_SIZE, 180, 180).rotateX(-Math.PI / 2)
    const m = new THREE.MeshLambertMaterial({ color: '#ffffff' })
    const material = extendMaterial(m, 'upheaval', {
      uniforms: { uEarth: color('#5a4a38'), uMossU: color(NATURE.moss), uDeep: color(WILD.mass[3]), uCoverU: color(WILD.cover) },
      vertexPars: 'varying vec3 vUP; varying float vUH;',
      normal: /* glsl */ `
        vec3 uw = (modelMatrix * vec4(position, 1.0)).xyz;
        float e = 2.5;
        float hx = upheaval(uw.xz + vec2(e, 0.0)) - upheaval(uw.xz - vec2(e, 0.0));
        float hz = upheaval(uw.xz + vec2(0.0, e)) - upheaval(uw.xz - vec2(0.0, e));
        vec3 objectNormal = normalize(vec3(-hx, 2.0 * e, -hz));`,
      vertex: /* glsl */ `
        vUH = upheaval(uw.xz);
        transformed.y = vUH - 0.4; // its rim lies just under the old ground, so it rises out of it
        vUP = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      fragmentPars: /* glsl */ `
        uniform vec3 uEarth, uMossU, uDeep, uCoverU;
        varying vec3 vUP;
        varying float vUH;
        float veinGlow = 0.0;`,
      fragment: /* glsl */ `
        if (vUH < 0.3) discard;
        vec3 un = normalize(cross(dFdx(vUP), dFdy(vUP)));
        if (un.y < 0.0) un = -un;
        float slope = 1.0 - clamp(un.y, 0.0, 1.0);
        // Moss and ground cover on the gentle slopes, torn earth where the land rose steeply.
        float patchy = fbm3(vUP.xz * 0.09);
        vec3 col = mix(uCoverU, uMossU, smoothstep(0.35, 0.7, patchy));
        col = mix(col, uDeep, smoothstep(6.0, 22.0, vUH) * 0.6);
        col = mix(col, uEarth, smoothstep(0.25, 0.55, slope + 0.25 * vnoise(vUP.xz * 0.3)));
        col *= 0.7 + 0.45 * fbm3(vUP.xz * 0.6 + vUP.y * 0.2);
        // A network of roots shows through the new ground; it glows faintly as the city notices you.
        float vein = abs(vnoise(vUP.xz * 0.05) - 0.5) + 0.6 * abs(vnoise(vUP.xz * 0.13 + 4.0) - 0.5);
        float veins = (1.0 - smoothstep(0.015, 0.04, vein)) * smoothstep(1.5, 6.0, vUH);
        col = mix(col, col * 0.7, veins * 0.6);
        veinGlow = veins;
        diffuseColor.rgb = col;`,
      emissive: 'totalEmissiveRadiance += veinGlow * vec3(0.025, 0.06, 0.03) * uAware * uAware * (0.6 + 0.4 * sin(uTime * 1.3 + vUP.x * 0.02));',
    })
    return { geometry, material }
  }, [])
  useEffect(() => {
    world.upheaval = {
      place([x, y]) {
        ref.current.position.set(x, 0, -y)
      },
    }
    return () => {
      world.upheaval = null
      geometry.dispose()
      material.dispose()
    }
  }, [world, geometry, material])
  useFrame(() => {
    if (ref.current) ref.current.visible = ENTITY.uSwellA.value > 0.002
  })
  return <mesh ref={ref} geometry={geometry} material={material} visible={false} frustumCulled={false} receiveShadow />
}

// ---- buildings: a century of weather, moss, ivy and green roofs, each building differently ----

// Adds the decay effects to the buildings' existing material, keeping its lighting.
export function decayBuildings(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, ENTITY, {
      uClimb: uniforms.uClimb,
      uRoof: uniforms.uRoof,
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
        attribute float aTop;
        attribute float aFloors;
        attribute float aShop;
        attribute vec3 aRoofColor;
        attribute vec2 aSeg;
        varying float vSeed, vTop, vFloors, vShop;
        varying vec3 vWP, vWN, vRoofColor;
        varying vec2 vSeg;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);
        vSeed = aSeed; vTop = aTop;
        vFloors = aFloors; vShop = aShop; vRoofColor = aRoofColor; vSeg = aSeg;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uClimb, uRoof;
        uniform vec3 uMoss, uIvy, uRoofGreen, uBleach, uWildGreen, uGlass, uFrame;
        varying float vSeed, vTop, vFloors, vShop;
        varying vec3 vWP, vWN, vRoofColor;
        varying vec2 vSeg;
        vec3 windowGlow = vec3(0.0);
        ${GLSL_NOISE}
        ${GLSL_ENTITY}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float facadeWindow = 0.0; // how much of this pixel is an empty window opening
        float wall = 0.0;
        vec3 c = diffuseColor.rgb;
        // Each building ages in its own way: some kept their facades, others are being consumed.
        float preserved = 1.0 - smoothstep(0.24, 0.3, vSeed);
        float consumed = smoothstep(0.74, 0.8, vSeed);
        if (vWN.y > 0.5) {
          c = vRoofColor;
        } else if (abs(vWN.y) < 0.5 && vSeg.y > 0.0) {
          wall = 1.0;
          // ---- facade: plinth, cornice, one row of windows per floor, shop fronts ----
          float y = vWP.y;
          float floorH = clamp(vTop * 0.92 / vFloors, 2.6, 4.5);
          float row = floor(y / floorH);
          float fy = fract(y / floorH);
          float bays = max(1.0, floor(vSeg.y / 3.2));
          float bay = vSeg.y / bays;
          float fu = fract(vSeg.x / bay);
          bool shopRow = vShop > 0.5 && row < 0.5;
          vec2 lo = shopRow ? vec2(0.1, 0.08) : vec2(0.3, 0.32);
          vec2 hi = shopRow ? vec2(0.9, 0.8) : vec2(0.7, 0.8);
          float has = step(1.8, vSeg.y) * step(row + 1.0, vFloors + 0.5) * step((row + hi.y) * floorH, vTop - 0.5);
          vec2 fr = vec2(0.11 / bay, 0.1 / floorH);
          float win = has * step(lo.x, fu) * step(fu, hi.x) * step(lo.y, fy) * step(fy, hi.y);
          float frame = has * step(lo.x - fr.x, fu) * step(fu, hi.x + fr.x) * step(lo.y - fr.y, fy) * step(fy, hi.y + fr.y);
          float sill = has * step(lo.x - fr.x * 1.6, fu) * step(fu, hi.x + fr.x * 1.6) * step(lo.y - fr.y * 2.2, fy) * step(fy, lo.y - fr.y);
          float plinth = step(y, 0.6);
          float cornice = step(vTop - 0.45, y);
          float course = step(1.5, vFloors) * (1.0 - step(0.07, abs(y - floorH)));
          vec3 f = c;
          f = mix(f, c * 0.8, plinth);
          f = mix(f, c * 0.86, max(cornice, course));
          f = mix(f, c * 0.72, sill);
          f = mix(f, mix(c, uFrame, 0.45), frame - sill * frame);
          // Rain has run down from every sill: streaks below the windows.
          float below = has * step(lo.x, fu) * step(fu, hi.x) * step(fy, lo.y) * (1.0 - smoothstep(0.0, lo.y, lo.y - fy));
          f = mix(f, f * 0.74, below * vnoise(vec2(vSeg.x * 3.0, y * 0.5)) * 0.9);
          // Far away, windows shrink below a pixel: blend to the facade's average tone instead of flickering.
          float fw = max(fwidth(vSeg.x) / bay, fwidth(y) / floorH);
          float far = smoothstep(0.06, 0.22, fw);
          c = mix(f, mix(c, vec3(0.05), 0.16 * step(1.8, vSeg.y)), far);
          facadeWindow = win * (1.0 - far);
        }
        // ---- a century of weather ----
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(c, vec3(lum) * vec3(0.98, 0.95, 0.9), 0.5 + 0.2 * consumed - 0.2 * preserved); // faded, a trace of the old tone
        c = mix(c * 0.8, uBleach * 0.8, 0.2);
        c = mix(c, vec3(0.03, 0.035, 0.03), facadeWindow * 0.92); // empty openings
        float along = vSeg.x + vSeed * 37.0;
        // Long vertical runs of dirt from the roof edge.
        float streak = vnoise(vec2(along * 1.4, vWP.y * 0.06 + vSeed * 9.0)) * vnoise(vec2(along * 0.3, 2.0));
        c = mix(c, c * 0.7, smoothstep(0.3, 0.65, streak) * wall * 0.75);
        // Damp: a dark, greenish band rising unevenly from the ground.
        float damp = 1.0 - smoothstep(0.0, 1.0 + 2.6 * vnoise(vec2(along * 0.3, vSeed * 20.0)), vWP.y);
        c = mix(c, c * vec3(0.6, 0.67, 0.52), damp * wall);
        // Cracks in the plaster, only on some stretches of wall.
        float cr = abs(vnoise(vec2(along * 0.9, vWP.y * 0.55) + vSeed * 5.0) - 0.5);
        float crack = (1.0 - smoothstep(0.0, 0.016, cr)) * smoothstep(0.55, 0.8, vnoise(vec2(along * 0.1, vWP.y * 0.08) + vSeed * 3.0));
        c = mix(c, c * 0.45, crack * wall * (1.0 - 0.7 * preserved));
        // Stains in large patches, moss low on the walls and anywhere water collects.
        c = mix(c, c * 0.8, smoothstep(0.62, 0.82, vnoise(vWP.xz * 0.11 + vWP.y * 0.07)) * 0.8);
        float n2 = vnoise(vWP.xz * 0.3 + vec2(vWP.y * 0.25, vSeed * 30.0));
        float low = wall > 0.5 ? 0.35 + (1.0 - smoothstep(0.0, 6.0, vWP.y)) : 1.0;
        c = mix(c, uMoss, smoothstep(0.7, 0.88, n2) * low * 0.7 * (1.0 - 0.6 * preserved));
        float conceal = max(uConcealA * fieldAt(uConceal, vWP), smoothstep(0.15, 0.7, swellAt(vWP)));
        // Inside the upheaval the buildings are being consumed: darkened, green with moss.
        float swell = swellAt(vWP);
        c = mix(c, mix(c * 0.6, uMoss * 0.8, 0.5), swell * 0.8);
        float retreat = uRetreatA * fieldAt(uRetreat, vWP);
        if (vWN.y > 0.5) {
          // Roofs green over in irregular patches; the consumed buildings almost entirely.
          float rn = fbm3(vWP.xz * 0.09 + vSeed * 50.0);
          float limit = mix(0.72, 0.42, consumed) + 0.18 * preserved - 0.4 * conceal;
          vec3 g = mix(uRoofGreen, uWildGreen, 0.6) * (0.75 + 0.5 * vnoise(vWP.xz * 0.6));
          c = mix(c, g, smoothstep(limit - 0.06, limit + 0.06, rn) * uRoof);
        } else if (wall > 0.5 || abs(vWN.y) < 0.5) {
          // Ivy climbs in tendrils from the ground, and hangs from the cornice of the consumed buildings.
          float share = mix(mix(0.22, 0.6, step(0.3, vSeed)), 0.85, consumed);
          float tendril = 0.8 * vnoise(vec2(along * 0.4, vSeed * 40.0)) + 0.2 * vnoise(vec2(along * 0.9, 7.0));
          float level = uClimb * share * vTop * (0.12 + 0.88 * tendril);
          // The entity: concealment drives the ivy up and over the facade, retreat pulls it back.
          level = mix(level, vTop + 2.0, conceal) * (1.0 - 0.8 * retreat);
          float hang = (consumed * vTop * (0.05 + 0.4 * smoothstep(0.35, 0.8, vnoise(vec2(along * 0.6, vSeed * 13.0)))) * (1.0 - 0.8 * retreat)) + conceal * vTop * 0.6;
          float ivyMask = 1.0 - smoothstep(level - 0.6, level + 0.6, vWP.y);
          ivyMask = max(ivyMask, smoothstep(vTop - hang - 0.6, vTop - hang + 0.6, vWP.y) * step(0.05, hang));
          // A leafy, broken edge rather than a clean line; dark gaps between the leaves.
          float leaves = vnoise(vec2(vWP.x + vWP.z, vWP.y) * 1.3);
          ivyMask *= smoothstep(0.1, 0.35, leaves * 0.6 + ivyMask * 0.5);
          vec3 ivy = mix(uIvy, uWildGreen, 0.6) * (0.6 + 0.65 * leaves);
          c = mix(c, ivy, ivyMask);
          facadeWindow *= 1.0 - ivyMask;
        }
        // As the recognition wave passes, the empty windows glow faintly, like phosphorescent moss.
        float wave = ripple(vWP);
        float chosen = step(0.86, nHash(vec2(vSeed * 13.0, floor(vWP.y / 3.0) + floor(along / 3.0))));
        windowGlow = facadeWindow * vec3(0.16, 0.34, 0.18) * (wave * 2.2 + uAware * uAware * 0.5 * chosen);
        diffuseColor.rgb = c;`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += windowGlow;')
  }
  material.customProgramCacheKey = () => 'facade-decay-buildings-3'
}
