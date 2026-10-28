import * as THREE from 'three'

// Shared shader pieces: noise, and the "entity fields" that every growing thing reads.
//
// The entity acts on the world through a handful of uniforms. Each field is a circle on the
// ground (xyz centre, w radius) with an amount 0..1. The entity driver animates them;
// the shaders below make trees, masses, ivy and roots respond.

export const ENTITY = {
  uTime: { value: 0 },
  uWind: { value: 1 }, // the ordinary breeze
  uAware: { value: 0 }, // the meter, 0..1: tints sky, fog and the windows' glow
  uStill: { value: new THREE.Vector4(0, 0, 0, 1) }, // movement stops here
  uStillA: { value: 0 },
  uRetreat: { value: new THREE.Vector4(0, 0, 0, 1) }, // vines and leaves pull back from here
  uRetreatA: { value: 0 },
  uConceal: { value: new THREE.Vector4(0, 0, 0, 1) }, // growth closes over here
  uConcealA: { value: 0 },
  uAgitate: { value: new THREE.Vector4(0, 0, 0, 1) }, // the vegetation stirs here
  uAgitateA: { value: 0 },
  uSurge: { value: new THREE.Vector4(0, 0, 0, 1) }, // a burst of growth here
  uSurgeA: { value: 0 },
  uPulse: { value: new THREE.Vector4(0, 0, 0, 1) }, // centre of the recognition wave
  uPulseT: { value: -1 }, // seconds since the wave started, -1 when none
  uTurnA: { value: 0 }, // every tree leans toward the observer
  uEye: { value: new THREE.Vector3() }, // the camera position
  // The upheaval: under prolonged observation the land itself rises around the observed place,
  // carrying the vegetation up and burying the buildings. Centre and radius, amount 0..1, height in m.
  uSwell: { value: new THREE.Vector4(0, 0, 0, 300) },
  uSwellA: { value: 0 },
  uSwellH: { value: 14 },
}

export const GLSL_NOISE = /* glsl */ `
  float nHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(nHash(i), nHash(i + vec2(1, 0)), u.x), mix(nHash(i + vec2(0, 1)), nHash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm3(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.07 + 13.1) + 0.15 * vnoise(p * 4.13 + 7.7); }`

export const GLSL_ENTITY = /* glsl */ `
  uniform float uTime, uWind, uAware, uStillA, uRetreatA, uConcealA, uAgitateA, uSurgeA, uPulseT, uTurnA, uSwellA, uSwellH;
  uniform vec4 uStill, uRetreat, uConceal, uAgitate, uSurge, uPulse, uSwell;
  uniform vec3 uEye;
  float fieldAt(vec4 f, vec3 p) { return 1.0 - smoothstep(f.w * 0.5, f.w, distance(p.xz, f.xz)); }
  // Height of the risen land at a point, in metres: one smooth, continuous surface, flat at its rim
  // (zero slope there, so it grows out of the ground without an edge), ridged toward the centre.
  float upheaval(vec2 xz) {
    if (uSwellA <= 0.001) return 0.0;
    float t = distance(xz, uSwell.xz) / uSwell.w;
    if (t >= 1.0) return 0.0;
    float bell = 1.0 - t * t;
    bell *= bell;
    float n = 0.6 * vnoise(xz * 0.012) + 0.4 * vnoise(xz * 0.031 + 7.0);
    return uSwellH * uSwellA * bell * (0.45 + 0.8 * n + 0.5 * n * n);
  }
  // How strongly the upheaval acts here, 0..1 (for growth and consumption, not height).
  float swellAt(vec3 p) { return uSwellA * (1.0 - smoothstep(uSwell.w * 0.35, uSwell.w, distance(p.xz, uSwell.xz))); }
  // The recognition wave: a ring running outward from where the observer looked.
  float ripple(vec3 p) {
    if (uPulseT < 0.0) return 0.0;
    float d = distance(p.xz, uPulse.xz);
    float r = uPulseT * 150.0;
    return exp(-pow((d - r) / 38.0, 2.0)) * exp(-uPulseT * 0.22);
  }
  // How far a point on a plant moves: wind, stirring, stillness, retreat, and leaning toward the eye.
  // base: the plant's root in world space; bend: 0 at the base to 1 at the top; H: its height in metres.
  vec3 plantOffset(vec3 base, float bend, float H) {
    float still = uStillA * fieldAt(uStill, base);
    float agit = uAgitateA * fieldAt(uAgitate, base) + 0.8 * ripple(base);
    float phase = dot(base.xz, vec2(0.071, 0.053));
    float t = uTime;
    vec2 gust = vec2(sin(t * 0.83 + phase) + 0.55 * sin(t * 2.1 + phase * 1.7), 0.6 * cos(t * 0.67 + phase * 1.3));
    vec2 shiver = vec2(sin(t * 7.3 + phase * 5.0), cos(t * 6.1 + phase * 3.0));
    float k = bend * bend * min(H, 40.0);
    vec3 off = vec3(gust.x, 0.0, gust.y) * k * 0.018 * uWind * (1.0 - still);
    off.xz += shiver * k * 0.035 * agit;
    vec2 away = normalize(base.xz - uRetreat.xz + vec2(0.001));
    off.xz += away * k * 0.16 * uRetreatA * fieldAt(uRetreat, base);
    vec2 toEye = normalize(uEye.xz - base.xz + vec2(0.001));
    off.xz += toEye * k * 0.2 * uTurnA;
    off.y -= k * 0.05 * uTurnA;
    return off;
  }`

// Adds lines of GLSL to a built-in material (Lambert here), keeping its lighting, shadows and fog.
// parts: uniforms, vertexPars, normal (replaces beginnormal_vertex), vertex (after begin_vertex),
// project (replaces project_vertex), fragmentPars, fragment (after color_fragment),
// normalFragment (after normal_fragment_begin), emissive (after emissivemap_fragment).
export function extendMaterial(material, key, parts) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, ENTITY, parts.uniforms ?? {})
    let vs = shader.vertexShader.replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${GLSL_ENTITY}\n${parts.vertexPars ?? ''}`)
    if (parts.normal) vs = vs.replace('#include <beginnormal_vertex>', parts.normal)
    if (parts.vertex) vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\n${parts.vertex}`)
    if (parts.project) vs = vs.replace('#include <project_vertex>', parts.project)
    shader.vertexShader = vs
    let fs = shader.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${GLSL_ENTITY}\n${parts.fragmentPars ?? ''}`)
    if (parts.fragment) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n${parts.fragment}`)
    if (parts.normalFragment) fs = fs.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${parts.normalFragment}`)
    if (parts.emissive) fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${parts.emissive}`)
    shader.fragmentShader = fs
  }
  material.customProgramCacheKey = () => key
  return material
}

// The vertex step for anything that sways: trees, the giants, growth.
// The geometry carries aBend (0 at the base, 1 at the top) and aTreeH (height in metres before
// instance scaling). uLift (per material, 0 or 1): whether the plant rides up on the upheaval
// and grows larger there. Vines fixed to walls do not.
export const SWAY_VERTEX = {
  vertexPars: /* glsl */ `
    attribute float aBend;
    attribute float aTreeH;
    uniform float uLift;
    varying vec3 vSW;
    varying float vBend;`,
  project: /* glsl */ `
    vec4 wp = vec4(transformed, 1.0);
    vec4 root = vec4(0.0, 0.0, 0.0, 1.0);
    float scaleY = 1.0;
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
      root = instanceMatrix * root;
      scaleY = length(instanceMatrix[1].xyz);
    #endif
    wp = modelMatrix * wp;
    root = modelMatrix * root;
    // Inside the upheaval plants swell to half again their size and ride up on the risen land.
    wp.xyz = root.xyz + (wp.xyz - root.xyz) * (1.0 + 0.5 * swellAt(root.xyz) * uLift);
    float lift = upheaval(root.xz) * uLift;
    wp.y += lift;
    root.y += lift;
    wp.xyz += plantOffset(root.xyz, aBend, aTreeH * scaleY);
    vSW = wp.xyz;
    vBend = aBend;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;`,
  // Leaves rather than smooth facets: clusters of light and shade over the crowns, streaks on bark.
  fragmentPars: /* glsl */ `
    varying vec3 vSW;
    varying float vBend;`,
  fragment: /* glsl */ `
    float leafy = vnoise(vSW.xz * 1.3 + vSW.y * 1.1) * 0.6 + vnoise(vSW.xz * 4.1 - vSW.y * 3.7) * 0.4;
    diffuseColor.rgb *= 0.66 + 0.62 * leafy;`,
}

// Fog for the few hand-written ShaderMaterials (sky excepted), so they sit in the same haze.
export const FOG_VERTEX_PARS = '#include <fog_pars_vertex>'
export const FOG_FRAGMENT_PARS = '#include <fog_pars_fragment>'
export const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog)
