import * as THREE from 'three'

// "Nature reclaims the city": one growth map for the whole kit, computed once.
//
// Every 2 m cell gets a growth potential p. High p means nature takes the spot early
// (parks, gardens, courtyards), low p late (pavement centres), and -1 never (inside buildings).
// Each stage of the timeline is a threshold on p, so the green grows outward as connected masses.

const CELL_M = 2 // ground map resolution
const MASS_STRIDE = 3 // vegetation mesh: one vertex every 3 cells (6 m)

// The stages. `cover` is the share of open ground that is green; the rest are the strength
// of each effect, 0 (none) to 1 (full). The last five (wild to mushrooms) only exist after
// year 50: the new ecosystem of year 100.
const LATE = { wild: 0, giants: 0, roots: 0, animals: 0, mushrooms: 0 }
export const STAGES = [
  { year: 0, title: 'Present-day Weimar', caption: 'The city as it stands today, with no added decay.', cover: 0, height: 0, decay: 0, climb: 0, roof: 0, trees: 0, ...LATE },
  { year: 5, title: 'Initial abandonment', caption: 'Small green patches take open spaces, gardens and the edges of streets.', cover: 0.07, height: 0.3, decay: 0.12, climb: 0, roof: 0, trees: 0, ...LATE },
  { year: 10, title: 'Expansion', caption: 'Green masses join across courtyards and streets and begin to surround buildings.', cover: 0.24, height: 0.5, decay: 0.3, climb: 0.25, roof: 0.15, trees: 0.45, ...LATE },
  { year: 25, title: 'Encroachment', caption: 'Vegetation covers much of the ground and climbs the walls. The buildings turn grey and weathered.', cover: 0.55, height: 0.78, decay: 0.62, climb: 0.6, roof: 0.45, trees: 0.8, ...LATE },
  { year: 50, title: 'Nature reclaims the city', caption: 'Connected green masses dominate. Streets are partly absorbed; the buildings remain, half covered.', cover: 0.8, height: 1, decay: 0.92, climb: 1, roof: 0.8, trees: 1, ...LATE },
  { year: 100, title: 'A new ecosystem', caption: 'Giant trees tower over the roofs, roots split the streets, and animals roam the blocks the forest has taken.', cover: 0.93, height: 1, decay: 1, climb: 1.35, roof: 1, trees: 1.2, wild: 1, giants: 1, roots: 1, animals: 1, mushrooms: 1 },
]

// How readily each land use turns green.
const LANDUSE_BASE = {
  recreation: 0.78,
  cemetery: 0.8,
  wasteland: 0.85,
  residential: 0.56,
  'mixed use': 0.46,
  'special functions': 0.48,
  'industrial and commercial': 0.5,
  square: 0.28,
  'flowing water': 0.42,
  'standing water': 0.42,
}
const NO_PLOT = 0.47 // street space and anything outside the plots

// ---- deterministic noise ----

function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1
}

// Fractal noise in -1..1; `scale` is the size of the largest blobs in metres.
function fbm(x, y, scale, seed, octaves = 4) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let f = 1 / scale
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f, y * f, seed + o * 17)
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return sum / norm
}

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

// ---- rasterising onto the grid ----

// Calls fill(index) for every cell whose centre lies inside the rings (even-odd rule).
function rasterize(rings, grid, fill) {
  const { x0, y0, W, H } = grid
  let minY = Infinity
  let maxY = -Infinity
  for (const ring of rings) for (const [, y] of ring) [minY, maxY] = [Math.min(minY, y), Math.max(maxY, y)]
  const r0 = Math.max(0, Math.floor((minY - y0) / CELL_M))
  const r1 = Math.min(H - 1, Math.ceil((maxY - y0) / CELL_M))
  for (let r = r0; r <= r1; r++) {
    const y = y0 + (r + 0.5) * CELL_M
    const xs = []
    for (const ring of rings)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xa, ya] = ring[i]
        const [xb, yb] = ring[j]
        if (ya > y !== yb > y) xs.push(xa + ((y - ya) / (yb - ya)) * (xb - xa))
      }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - x0) / CELL_M - 0.5))
      const c1 = Math.min(W - 1, Math.floor((xs[k + 1] - x0) / CELL_M - 0.5))
      for (let c = c0; c <= c1; c++) fill(r * W + c)
    }
  }
}

// Exact distance (in cells) to the nearest marked cell, Felzenszwalb & Huttenlocher.
function distanceTransform(mask, W, H) {
  const INF = 1e20
  const f = new Float64Array(Math.max(W, H))
  const d = new Float64Array(Math.max(W, H))
  const v = new Int32Array(Math.max(W, H))
  const z = new Float64Array(Math.max(W, H) + 1)
  const out = new Float64Array(W * H)
  for (let i = 0; i < W * H; i++) out[i] = mask[i] ? 0 : INF
  const pass = (n, get, set) => {
    for (let q = 0; q < n; q++) f[q] = get(q)
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
    }
    for (let q = 0; q < n; q++) set(q, d[q])
  }
  for (let x = 0; x < W; x++) pass(H, (y) => out[y * W + x], (y, val) => (out[y * W + x] = val))
  for (let y = 0; y < H; y++) pass(W, (x) => out[y * W + x], (x, val) => (out[y * W + x] = val))
  for (let i = 0; i < W * H; i++) out[i] = Math.sqrt(out[i])
  return out
}

// Average of the open cells within a square of (2r+1)² cells. Building cells get the
// average of the open ground around them, or -1 deep inside a large building.
function blurOpen(p, W, H, r) {
  const tmp = new Float32Array(W * H)
  const cnt = new Float32Array(W * H)
  const out = new Float32Array(W * H)
  const ok = (i) => p[i] > -1
  for (let y = 0; y < H; y++) {
    let s = 0
    let c = 0
    for (let x = -r; x < W + r; x++) {
      const a = y * W + x + r
      const b = y * W + x - r - 1
      if (x + r < W && ok(a)) [s, c] = [s + p[a], c + 1]
      if (x - r - 1 >= 0 && ok(b)) [s, c] = [s - p[b], c - 1]
      if (x >= 0 && x < W) [tmp[y * W + x], cnt[y * W + x]] = [s, c]
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0
    let c = 0
    for (let y = -r; y < H + r; y++) {
      const a = (y + r) * W + x
      const b = (y - r - 1) * W + x
      if (y + r < H) [s, c] = [s + tmp[a], c + cnt[a]]
      if (y - r - 1 >= 0) [s, c] = [s - tmp[b], c - cnt[b]]
      if (y >= 0 && y < H) out[y * W + x] = c > 0 ? s / c : -1
    }
  }
  return out
}

function quantile(values, q) {
  const s = Float32Array.from(values).sort()
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

// ---- the growth map ----

export function buildNature(data, plots) {
  const corners = [data.project([data.bbox[0], data.bbox[1]]), data.project([data.bbox[2], data.bbox[3]])]
  const [x0, y0] = corners[0]
  const W = Math.ceil((corners[1][0] - x0) / CELL_M)
  const H = Math.ceil((corners[1][1] - y0) / CELL_M)
  const grid = { x0, y0, W, H }
  const N = W * H
  const cx = (i) => x0 + ((i % W) + 0.5) * CELL_M
  const cy = (i) => y0 + (Math.floor(i / W) + 0.5) * CELL_M

  // Buildings, with the id of the building in each cell.
  const building = new Int32Array(N).fill(-1)
  data.buildings.forEach((b, k) => rasterize(b.rings, grid, (i) => (building[i] = k)))

  // Land use.
  const base = new Float32Array(N).fill(NO_PLOT)
  for (const f of plots.features) {
    const value = LANDUSE_BASE[f.properties.landuse] ?? NO_PLOT
    rasterize(f.geometry.coordinates.map((r) => r.map(data.project)), grid, (i) => (base[i] = value))
  }

  // Street centre lines.
  const street = new Uint8Array(N)
  for (const e of data.edges)
    for (let s = 1; s < e.points.length; s++) {
      const [a, b] = [e.points[s - 1], e.points[s]]
      const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL_M / 2))
      for (let t = 0; t <= steps; t++) {
        const c = Math.floor((a[0] + ((b[0] - a[0]) * t) / steps - x0) / CELL_M)
        const r = Math.floor((a[1] + ((b[1] - a[1]) * t) / steps - y0) / CELL_M)
        if (c >= 0 && c < W && r >= 0 && r < H) street[r * W + c] = 1
      }
    }

  const toBuilding = distanceTransform(Uint8Array.from(building, (b) => (b >= 0 ? 1 : 0)), W, H)
  const toStreet = distanceTransform(street, W, H)

  const p = new Float32Array(N)
  const pavement = new Float32Array(N) // 1 on the street surface, fading out at its edge
  const tone = new Float32Array(N) // a second, independent noise for colour variation
  const open = []
  for (let i = 0; i < N; i++) {
    const x = cx(i)
    const y = cy(i)
    tone[i] = fbm(x, y, 35, 7, 3)
    if (building[i] >= 0) {
      p[i] = -1
      continue
    }
    const dB = toBuilding[i] * CELL_M
    const dS = toStreet[i] * CELL_M
    const pave = 1 - smoothstep(2.5, 5, dS)
    pavement[i] = pave
    let v = base[i]
    v += 0.14 * smoothstep(3, 22, dB) // open ground away from walls
    v += 0.07 * (1 - smoothstep(0, 3, dB)) // debris and moisture at the base of walls
    v += 0.1 * smoothstep(4, 6, dS) * (1 - smoothstep(6, 11, dS)) // verges along the streets
    v -= 0.05 * pave * (1 - 0.5 * smoothstep(1, 4.5, dS)) // the pavement, its centre the last to go
    v += 0.24 * fbm(x, y, 90, 1) + 0.08 * fbm(x, y, 14, 3, 2) // large organic masses, ragged edges
    p[i] = v
    open.push(v)
  }

  // Thresholds that give each stage its share of green ground.
  const thresholds = STAGES.map((s) => (s.cover > 0 ? quantile(open, 1 - s.cover) : 2))

  // Ground map texture: R = potential, G = pavement, B = tone.
  const texture = new Uint8Array(N * 4)
  for (let i = 0; i < N; i++) {
    texture[i * 4] = Math.round(Math.min(Math.max((p[i] + 1) / 2, 0), 1) * 255)
    texture[i * 4 + 1] = Math.round(pavement[i] * 255)
    texture[i * 4 + 2] = Math.round(((tone[i] + 1) / 2) * 255)
    texture[i * 4 + 3] = 255
  }

  // Vegetation mass: a coarser, smoothed height field. aH is the full-grown height of the mass there.
  const smooth = blurOpen(p, W, H, 4) // over 18 m, so masses swell instead of bristling
  const MW = Math.floor((W - 1) / MASS_STRIDE) + 1
  const MH = Math.floor((H - 1) / MASS_STRIDE) + 1
  const mass = { MW, MH, positions: new Float32Array(MW * MH * 3), potential: new Float32Array(MW * MH), height: new Float32Array(MW * MH), wild: new Float32Array(MW * MH) }
  for (let r = 0; r < MH; r++)
    for (let c = 0; c < MW; c++) {
      const i = r * MASS_STRIDE * W + c * MASS_STRIDE
      const k = r * MW + c
      const x = cx(i)
      const y = cy(i)
      mass.positions.set([x, 0, -y], k * 3)
      // The mass keeps clear of the pavement centre, and of the buildings themselves.
      mass.potential[k] = smooth[i] - 0.12 * pavement[i]
      const lift = fbm(x, y, 60, 11, 3) // which masses grow tall
      const dB = toBuilding[i] * CELL_M
      let h = 4 + 18 * smoothstep(-0.35, 0.55, lift)
      h *= 0.35 + 0.65 * smoothstep(5, 24, dB) // tall in open ground, lower in narrow courtyards
      h *= 1 - 0.65 * pavement[i] // low growth over streets
      if (base[i] === LANDUSE_BASE.recreation || base[i] === LANDUSE_BASE.cemetery) h *= 1.25
      h += 5 * (1 - smoothstep(0, 8, dB)) * smoothstep(-0.2, 0.4, lift) // heaped against walls
      // Inside a building the mass runs on, hidden by the walls, but stays below the roof,
      // so it seems to lean against the building rather than pierce it.
      if (building[i] >= 0) h = Math.min(Math.max(h, 3), data.buildings[building[i]].height * 0.75)
      mass.height[k] = h
      // Year 100: masses swell over whole blocks, and in places engulf the buildings, roof included.
      if (building[i] < 0) mass.wild[k] = h * 1.6
      else mass.wild[k] = fbm(x, y, 45, 23, 3) > 0.05 ? data.buildings[building[i]].height * 1.08 + 2 : h
    }

  // Soften the year 100 heights a little, so the engulfing masses swell rather than splinter.
  const w = Float32Array.from(mass.wild)
  for (let r = 1; r < MH - 1; r++)
    for (let c = 1; c < MW - 1; c++) {
      let sum = 0
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) sum += w[(r + dr) * MW + c + dc]
      mass.wild[r * MW + c] = 0.5 * w[r * MW + c] + 0.5 * (sum / 9)
    }

  // A few distinctive trees, rising from the tallest, earliest masses. At least 34 m apart.
  const trees = []
  const taken = new Set()
  const treeMin = quantile(open, 0.7)
  for (let r = 2; r < H - 2; r += 4)
    for (let c = 2; c < W - 2; c += 4) {
      const i = r * W + c
      if (p[i] < treeMin || pavement[i] > 0.05 || toBuilding[i] * CELL_M < 6) continue
      const x = cx(i)
      const y = cy(i)
      if (fbm(x, y, 60, 11, 3) < 0.15 || hash2(c, r, 41) > 0.12) continue
      const key = (gx, gy) => gx + ',' + gy
      const gx = Math.floor(x / 34)
      const gy = Math.floor(y / 34)
      let crowded = false
      for (let dx = -1; dx <= 1 && !crowded; dx++) for (let dy = -1; dy <= 1; dy++) if (taken.has(key(gx + dx, gy + dy))) crowded = true
      if (crowded) continue
      taken.add(key(gx, gy))
      const lift = fbm(x, y, 60, 11, 3)
      trees.push({
        x,
        y,
        p: p[i],
        ground: 4 + 18 * smoothstep(-0.35, 0.55, lift), // the mass height around it
        kind: ['column', 'round', 'wide'][Math.floor(hash2(c, r, 43) * 3)],
        size: 0.8 + 0.7 * hash2(c, r, 47),
        turn: hash2(c, r, 53) * Math.PI * 2,
        shade: Math.floor(hash2(c, r, 59) * 3),
      })
    }

  const wild = buildWild({ data, grid, p, smooth, pavement, building, toBuilding, open, thresholds, trees, cx, cy, mass })

  const groundMap = new THREE.DataTexture(texture, W, H, THREE.RGBAFormat)
  groundMap.magFilter = groundMap.minFilter = THREE.LinearFilter
  groundMap.needsUpdate = true

  return { grid: { x0, y0, W, H, cell: CELL_M }, groundMap, thresholds, mass, trees, ...wild, sample: (x, y) => sampleP(p, grid, x, y) }
}

// ---- year 100: giant trees, roots, mushrooms and animals, placed once and deterministically ----

function buildWild({ grid, p, pavement, building, toBuilding, open, thresholds, trees, cx, cy, mass }) {
  const { x0, y0, W, H } = grid
  const cellOf = (x, y) => {
    const c = Math.floor((x - x0) / CELL_M)
    const r = Math.floor((y - y0) / CELL_M)
    return c >= 0 && c < W && r >= 0 && r < H ? r * W + c : -1
  }
  const blocked = (x, y) => {
    const i = cellOf(x, y)
    return i < 0 || building[i] >= 0
  }
  // Is the ground here free of vegetation mass in year 100? (So an animal standing here is seen.)
  const T100 = thresholds[thresholds.length - 1]
  const clearing = (x, y) => {
    const c = Math.round((x - x0) / CELL_M / MASS_STRIDE)
    const r = Math.round((y - y0) / CELL_M / MASS_STRIDE)
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const k = (r + dr) * mass.MW + (c + dc)
        if (r + dr < 0 || r + dr >= mass.MH || c + dc < 0 || c + dc >= mass.MW || mass.potential[k] > T100 - 0.01) return false
      }
    return true
  }

  // Giant trees: in the largest, greenest open spaces, at least 150 m apart.
  const giantMin = quantile(open, 0.8)
  const candidates = []
  for (let r = 3; r < H - 3; r += 6)
    for (let c = 3; c < W - 3; c += 6) {
      const i = r * W + c
      if (p[i] > giantMin && toBuilding[i] * CELL_M > 14 && pavement[i] === 0) candidates.push({ i, c, r, order: hash2(c, r, 71) })
    }
  candidates.sort((a, b) => a.order - b.order)
  const giants = []
  for (const k of candidates) {
    const x = cx(k.i)
    const y = cy(k.i)
    if (giants.some((g) => Math.hypot(g.x - x, g.y - y) < 150)) continue
    const h = (s) => hash2(k.c, k.r, s)
    giants.push({ x, y, height: 95 + 50 * h(73), crown: 24 + 14 * h(79), trunk: 3.6 + 2.2 * h(83), tiers: 3 + Math.floor(h(89) * 2), turn: h(97) * Math.PI * 2, order: giants.length / 16 })
    if (giants.length >= 16) break
  }

  // Roots: random walks along the ground that slide along walls when they meet a building.
  const roots = []
  const grow = (x, y, angle, length, step, radius, seed, delay) => {
    const pts = [[x, y]]
    let a = angle
    const turn = seed % 2 ? 0.45 : -0.45 // each root keeps turning one way along a wall
    for (let d = step; d <= length; d += step) {
      a += valueNoise(d * 0.09, seed, 91) * 0.13 // meander, but keep heading outward
      let tries = 0
      let nx = x + Math.cos(a) * step
      let ny = y + Math.sin(a) * step
      while (blocked(nx, ny) && tries++ < 8) {
        a += turn
        nx = x + Math.cos(a) * step
        ny = y + Math.sin(a) * step
      }
      if (tries >= 8) break
      ;[x, y] = [nx, ny]
      pts.push([x, y])
    }
    if (pts.length > 2) roots.push({ pts, radius, delay })
  }
  giants.forEach((g, gi) => {
    const count = 7 + Math.floor(hash2(gi, 3, 101) * 4)
    for (let k = 0; k < count; k++) {
      const a = g.turn + (k / count) * Math.PI * 2 + hash2(gi, k, 103) * 0.5
      const start = g.trunk * 0.8
      grow(g.x + Math.cos(a) * start, g.y + Math.sin(a) * start, a, 70 + 100 * hash2(gi, k, 107), 3, 2 + 1.4 * hash2(gi, k, 109), gi * 31 + k, g.order)
    }
  })
  trees.forEach((t, ti) => {
    if (hash2(ti, 5, 113) > 0.6) return
    for (let k = 0; k < 3; k++) {
      const a = t.turn + (k / 3) * Math.PI * 2
      grow(t.x, t.y, a, 16 + 26 * hash2(ti, k, 127), 2.5, 0.7 + 0.4 * hash2(ti, k, 131), 5000 + ti * 7 + k, 0.3 + 0.5 * hash2(ti, k, 137))
    }
  })

  // Oversized mushrooms: a few clusters near the giants, in their shade.
  const mushrooms = []
  giants.slice(0, 7).forEach((g, gi) => {
    const a = hash2(gi, 9, 139) * Math.PI * 2
    const [mx, my] = [g.x + Math.cos(a) * 34, g.y + Math.sin(a) * 34]
    const count = 3 + Math.floor(hash2(gi, 9, 149) * 3)
    for (let k = 0; k < count; k++) {
      const b = hash2(gi, k, 151) * Math.PI * 2
      const d = 2 + 9 * hash2(gi, k, 157)
      const [x, y] = [mx + Math.cos(b) * d, my + Math.sin(b) * d]
      if (blocked(x, y)) continue
      mushrooms.push({ x, y, height: 5 + 9 * hash2(gi, k, 163), cap: 3 + 4.5 * hash2(gi, k, 167), tilt: (hash2(gi, k, 173) - 0.5) * 0.35, order: 0.2 + 0.7 * hash2(gi, k, 179) })
    }
  })

  // Animals: deer herds in clearings, boars and foxes on the former streets.
  const animals = []
  const place = (kind, groups, size, test, seedBase) => {
    const spots = []
    for (let r = 4; r < H - 4; r += 5)
      for (let c = 4; c < W - 4; c += 5) {
        const i = r * W + c
        if (test(i) && clearing(cx(i), cy(i))) spots.push({ i, order: hash2(c, r, seedBase) })
      }
    spots.sort((a, b) => a.order - b.order)
    const chosen = []
    for (const s of spots) {
      const [x, y] = [cx(s.i), cy(s.i)]
      if ([...chosen, ...animals].some((o) => Math.hypot(o.x - x, o.y - y) < 120)) continue
      chosen.push({ x, y })
      for (let k = 0; k < size; k++) {
        const h = (q) => hash2(chosen.length * 13 + k, seedBase, q)
        const [ax, ay] = k === 0 ? [x, y] : [x + (h(181) - 0.5) * 14, y + (h(191) - 0.5) * 14]
        if (blocked(ax, ay) || animals.some((o) => Math.hypot(o.x - ax, o.y - ay) < 3.5)) continue
        animals.push({ kind, x: ax, y: ay, turn: h(193) * Math.PI * 2, size: 0.9 + 0.25 * h(197), order: 0.15 + 0.8 * h(199) })
      }
      if (chosen.length >= groups) break
    }
  }
  const deerSpot = (i) => pavement[i] === 0 && toBuilding[i] * CELL_M > 10 && p[i] > T100
  const streetSpot = (i) => pavement[i] > 0.8
  place('deer', 3, 4, deerSpot, 211)
  place('boar', 3, 3, streetSpot, 223)
  place('fox', 6, 1, streetSpot, 227)

  return { giants, roots, mushrooms, animals }
}

function sampleP(p, { x0, y0, W, H }, x, y) {
  const c = Math.floor((x - x0) / CELL_M)
  const r = Math.floor((y - y0) / CELL_M)
  return c >= 0 && c < W && r >= 0 && r < H ? p[r * W + c] : -1
}

// The look at a point on the slider (0 to 5, fractional while it moves), interpolated between stages.
export function stageAt(s, thresholds) {
  const k = Math.min(Math.floor(s), STAGES.length - 2)
  const t = Math.min(Math.max(s - k, 0), 1)
  const mix = (a, b) => a + (b - a) * t
  const [a, b] = [STAGES[k], STAGES[k + 1]]
  const out = { threshold: mix(thresholds[k], thresholds[k + 1]) }
  for (const key of ['height', 'decay', 'climb', 'roof', 'trees', 'wild', 'giants', 'roots', 'animals', 'mushrooms']) out[key] = mix(a[key], b[key])
  return out
}
