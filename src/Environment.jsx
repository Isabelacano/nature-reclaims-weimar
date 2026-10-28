import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { fbm, hash2 } from './nature.js'
import { ATMOSPHERE, GROUND } from './palette.js'
import { ENTITY, GLSL_NOISE, extendMaterial } from './shaders.js'

// The world around the modelled city: sky, haze, sun, the hills and the forest that took the region.

const SUN_DIR = new THREE.Vector3(-0.55, 0.5, 0.42).normalize()
const FOG_DENSITY = 0.00014
const TERRAIN_HALF_M = 13000

// Distance in metres from a point to the rectangle [x0, y0, x1, y1] (0 inside).
const outside = ([x0, y0, x1, y1], x, y) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1))

// The land: flat where the city stands, rising into a ring of low wooded hills.
export function terrainHeight(kit, x, y) {
  const d = outside(kit, x, y)
  const rise = THREE.MathUtils.smoothstep(d, 300, 3600)
  const hills = 70 + 170 * (0.5 + 0.5 * fbm(x, y, 2600, 3, 4))
  const roll = 10 * fbm(x, y, 420, 9, 3) * THREE.MathUtils.smoothstep(d, 120, 900)
  return rise * hills + roll
}

function Sky() {
  const { camera, scene } = useThree()
  const ref = useRef()
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: ENTITY.uTime,
          uAware: ENTITY.uAware,
          uSun: { value: SUN_DIR },
          uHorizon: { value: new THREE.Color(ATMOSPHERE.horizon) },
          uZenith: { value: new THREE.Color(ATMOSPHERE.zenith) },
          uAHorizon: { value: new THREE.Color(ATMOSPHERE.awareHorizon) },
          uAZenith: { value: new THREE.Color(ATMOSPHERE.awareZenith) },
          uSunColor: { value: new THREE.Color(ATMOSPHERE.sun) },
          uCloud: { value: new THREE.Color(ATMOSPHERE.cloud) },
          uCloudShade: { value: new THREE.Color(ATMOSPHERE.cloudShade) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uAware;
          uniform vec3 uSun, uHorizon, uZenith, uAHorizon, uAZenith, uSunColor, uCloud, uCloudShade;
          varying vec3 vDir;
          ${GLSL_NOISE}
          void main() {
            vec3 d = normalize(vDir);
            float up = clamp(d.y, 0.0, 1.0);
            vec3 horizon = mix(uHorizon, uAHorizon, uAware * 0.8);
            vec3 zenith = mix(uZenith, uAZenith, uAware * 0.8);
            vec3 col = mix(horizon, zenith, pow(up, 0.55));
            // A low, veiled sun.
            float s = max(dot(d, uSun), 0.0);
            col += uSunColor * (pow(s, 8.0) * 0.22 + pow(s, 200.0) * 0.5) * (1.0 - uAware * 0.5);
            // Clouds on a high plane: soft, layered, drifting; they thicken as the city grows uneasy.
            if (d.y > 0.0) {
              vec2 p = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015) * (1.0 + uAware * 2.0);
              float c = fbm3(p * 0.9) * 0.7 + fbm3(p * 3.1 + 4.0) * 0.3;
              float cover = smoothstep(0.5 - uAware * 0.08, 0.78, c);
              vec3 cc = mix(uCloudShade, uCloud, smoothstep(0.5, 0.9, c) * (0.6 + 0.4 * s));
              col = mix(col, cc, cover * smoothstep(0.0, 0.18, d.y) * 0.85);
            }
            // Below the horizon: the haze itself.
            col = mix(col, horizon, smoothstep(0.02, -0.05, d.y));
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    [],
  )
  // Haze in the same colour as the horizon, darkening a little with the entity's awareness.
  const fogColor = useMemo(() => [new THREE.Color(ATMOSPHERE.horizon), new THREE.Color(ATMOSPHERE.awareHorizon)], [])
  useEffect(() => {
    scene.fog = new THREE.FogExp2(ATMOSPHERE.horizon, FOG_DENSITY)
    scene.background = null
    return () => (scene.fog = null)
  }, [scene])
  useFrame(() => {
    ref.current.position.copy(camera.position)
    if (scene.fog) {
      scene.fog.color.lerpColors(fogColor[0], fogColor[1], ENTITY.uAware.value * 0.8)
      scene.fog.density = FOG_DENSITY * (1 + 0.35 * ENTITY.uAware.value)
    }
  })
  return (
    <mesh ref={ref} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[14000, 48, 24]} />
    </mesh>
  )
}

// Terrain outside the city's ground plane (`hole`): forest floor near, a canopy texture far.
function Terrain({ kit, hole }) {
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(TERRAIN_HALF_M * 2, TERRAIN_HALF_M * 2, 260, 260).rotateX(-Math.PI / 2)
    const p = geometry.attributes.position
    for (let i = 0; i < p.count; i++) p.setY(i, terrainHeight(kit, p.getX(i), -p.getZ(i)))
    geometry.computeVertexNormals()
    const m = new THREE.MeshLambertMaterial({ color: '#ffffff' })
    const material = extendMaterial(m, 'terrain', {
      uniforms: {
        uHole: { value: new THREE.Vector4(...hole) },
        uKit: { value: new THREE.Vector4(...kit) },
        uFloor: { value: new THREE.Color(GROUND.floor) },
        uHills: { value: new THREE.Color(ATMOSPHERE.hills) },
        uCanopy: { value: new THREE.Color(ATMOSPHERE.forest[1]) },
        uMeadow: { value: new THREE.Color('#6d7552') },
      },
      vertexPars: 'varying vec3 vTP;',
      vertex: 'vTP = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      fragmentPars: /* glsl */ `
        uniform vec4 uHole, uKit;
        uniform vec3 uFloor, uHills, uCanopy, uMeadow;
        varying vec3 vTP;`,
      fragment: /* glsl */ `
        vec2 xy = vec2(vTP.x, -vTP.z);
        if (xy.x > uHole.x && xy.x < uHole.z && xy.y > uHole.y && xy.y < uHole.w) discard;
        vec2 q = max(max(uKit.xy - xy, xy - uKit.zw), vec2(0.0));
        float d = length(q);
        // Near the city the forest floor continues; further out the land is one canopy,
        // broken by meadows that were once fields, still faintly in strips.
        float canopy = fbm3(xy * 0.004);
        float strips = smoothstep(0.45, 0.5, fract((xy.x * 0.8 + xy.y * 0.6) * 0.004 + vnoise(xy * 0.0007) * 2.0));
        float meadow = smoothstep(0.58, 0.7, fbm3(xy * 0.0012 + 3.0)) * (0.6 + 0.4 * strips);
        vec3 far = mix(uCanopy, uHills, 0.4 + 0.6 * canopy);
        far = mix(far, uMeadow, meadow * 0.7);
        far *= 0.75 + 0.45 * vnoise(xy * 0.05);
        vec3 col = mix(uFloor * (0.8 + 0.3 * fbm3(xy * 0.07)), far, smoothstep(250.0, 1400.0, d));
        diffuseColor.rgb = col;`,
    })
    return { geometry, material }
  }, [kit, hole])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={material} receiveShadow />
}

// The forest beyond the modelled city: rounded crowns on the terrain, denser near the edge.
const REACH_M = 3400

// band: [spacing, from, to, seed, detail]. The near band is finer and denser than the far one.
function Forest({ kit, band, blocked }) {
  const ref = useRef()
  const { geometry, items } = useMemo(() => {
    const [step, from, to, seed, detail] = band
    const geometry = new THREE.IcosahedronGeometry(1, detail)
    const items = []
    const [x0, y0, x1, y1] = kit
    const reach = REACH_M
    {
      for (let y = y0 - to; y <= y1 + to; y += step)
        for (let x = x0 - to; x <= x1 + to; x += step) {
          const ix = Math.round(x / step)
          const iy = Math.round(y / step)
          const jx = x + (hash2(ix, iy, 900 + seed) - 0.5) * step
          const jy = y + (hash2(ix, iy, 910 + seed) - 0.5) * step
          // Signed: negative inside the modelled city, where the forest reaches in between the buildings.
          const d = outside(kit, jx, jy) || -Math.min(jx - x0, x1 - jx, jy - y0, y1 - jy)
          if (d < from || d > to || (d < 0 && blocked(jx, jy))) continue
          // Clearings and thinning with distance.
          if (fbm(jx, jy, 700, 31, 3) > 0.3 || hash2(ix, iy, 920 + seed) < d / (reach * 1.6)) continue
          const r = (seed === 1 ? 8 : 14) + (seed === 1 ? 9 : 14) * hash2(ix, iy, 930 + seed)
          items.push({ x: jx, y: jy, r, h: r * (0.7 + 0.45 * hash2(ix, iy, 940 + seed)), c: Math.floor(hash2(ix, iy, 950 + seed) * ATMOSPHERE.forest.length), k: hash2(ix, iy, 960 + seed) })
        }
    }
    return { geometry, items }
  }, [kit, band, blocked])
  useEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const colors = ATMOSPHERE.forest.map((h) => new THREE.Color(h))
    const c = new THREE.Color()
    items.forEach((t, i) => {
      const ground = terrainHeight(kit, t.x, t.y)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.k * 6.28)
      m.compose(new THREE.Vector3(t.x, ground + t.h * 0.75, -t.y), q, new THREE.Vector3(t.r, t.h, t.r))
      ref.current.setMatrixAt(i, m)
      ref.current.setColorAt(i, c.copy(colors[t.c]).multiplyScalar(0.85 + 0.3 * t.k))
    })
    ref.current.instanceMatrix.needsUpdate = true
    ref.current.instanceColor.needsUpdate = true
  }, [items, kit])
  return (
    <instancedMesh ref={ref} args={[geometry, null, items.length]} frustumCulled={false} receiveShadow>
      <meshLambertMaterial flatShading />
    </instancedMesh>
  )
}

function Sun({ kit }) {
  const ref = useRef()
  const { scene } = useThree()
  const [cx, cy] = [(kit[0] + kit[2]) / 2, (kit[1] + kit[3]) / 2]
  useEffect(() => {
    const light = ref.current
    light.target.position.set(cx, 0, -cy)
    scene.add(light.target)
    const cam = light.shadow.camera
    Object.assign(cam, { left: -1500, right: 1500, top: 1500, bottom: -1500, near: 200, far: 7000 })
    cam.updateProjectionMatrix()
    return () => scene.remove(light.target)
  }, [scene, cx, cy])
  const pos = SUN_DIR.clone().multiplyScalar(3500).add(new THREE.Vector3(cx, 0, -cy))
  return (
    <directionalLight
      ref={ref}
      position={pos.toArray()}
      color={ATMOSPHERE.sun}
      intensity={2.3}
      castShadow
      shadow-mapSize={[4096, 4096]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.8}
    />
  )
}

export default function Environment({ kit, hole, blocked }) {
  return (
    <>
      <Sky />
      <hemisphereLight args={['#b9c2bb', '#4b4636', 1.25]} />
      <Sun kit={kit} />
      <Terrain kit={kit} hole={hole} />
      <Forest kit={kit} band={NEAR} blocked={blocked} />
      <Forest kit={kit} band={FAR} blocked={blocked} />
    </>
  )
}

const NEAR = [26, -80, 520, 1, 1]
const FAR = [60, 520, REACH_M, 2, 0]
