import ClipperLib from 'clipper-lib'

// The method, in one place. The panel and the README quote these numbers.
export const SPEED_M_PER_MIN = 80 // 4.8 km/h
export const MINUTES = [5, 10, 15]
export const BAND_M = 25 // band on each side of a reached street segment
export const SNAP_M = 100 // furthest a click may be from a walkable node

// Clipper works on whole numbers, so all metres are stored as centimetres.
const SCALE = 100
const EARTH_RADIUS_M = 6371008.8

// Longitude and latitude to metres east and north of the kit centre.
// Over 2 km a flat projection is off by far less than a metre.
export function makeProjection([lon0, lat0]) {
  const ky = (Math.PI / 180) * EARTH_RADIUS_M
  const kx = ky * Math.cos((lat0 * Math.PI) / 180)
  return ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]
}

const toPath = (ring) => ring.map(([x, y]) => new ClipperLib.IntPoint(Math.round(x * SCALE), Math.round(y * SCALE)))
const toMetres = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE])

function bboxOf(paths) {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  for (const path of paths)
    for (const p of path) {
      if (p.X < b[0]) b[0] = p.X
      if (p.Y < b[1]) b[1] = p.Y
      if (p.X > b[2]) b[2] = p.X
      if (p.Y > b[3]) b[3] = p.Y
    }
  return b
}

const areaOf = (paths) => Math.abs(paths.reduce((sum, p) => sum + ClipperLib.Clipper.Area(p), 0))

function intersect(subject, clip) {
  const c = new ClipperLib.Clipper()
  c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true)
  c.AddPaths(clip, ClipperLib.PolyType.ptClip, true)
  const out = new ClipperLib.Paths()
  c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  return out
}

// Turn the raw files into projected, ready-to-use data. Runs once after loading.
export function prepare({ kit, buildings, graph, zensus }) {
  const project = makeProjection(kit.center)

  const nodeIndex = new Map(graph.nodes.map((n, i) => [n.id, i]))
  const nodes = graph.nodes.map((n) => project([n.lon, n.lat]))
  const adjacency = nodes.map(() => [])
  const edges = graph.edges
    .filter((e) => e.walkable)
    .map((e) => {
      const edge = { from: nodeIndex.get(e.from), to: nodeIndex.get(e.to), length: e.length, points: e.coords.map(project) }
      adjacency[edge.from].push(edge)
      adjacency[edge.to].push(edge)
      return edge
    })
  const walkable = new Uint8Array(nodes.length)
  for (const e of edges) walkable[e.from] = walkable[e.to] = 1

  const blds = buildings.features.map((f) => {
    const rings = f.geometry.coordinates.map((ring) => ring.map(project))
    return { id: f.properties.id, use: f.properties.use ?? 'undefined', height: f.properties.height, floors: f.properties.floors || 1, rings, bbox: bboxOf([toPath(rings[0])]) }
  })

  const cells = zensus.features.map((f) => {
    const path = toPath(f.geometry.coordinates[0].map(project))
    return { population: f.properties.population, path, area: areaOf([path]), bbox: bboxOf([path]) }
  })

  return { project, bbox: kit.bbox, nodes, walkable, adjacency, edges, buildings: blds, cells }
}

// Shortest walking distance in metres from one node to every other node.
function walkDistances(data, start) {
  const n = data.nodes.length
  const dist = new Float64Array(n).fill(Infinity)
  const done = new Uint8Array(n)
  dist[start] = 0
  for (let k = 0; k < n; k++) {
    let u = -1
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i
    if (u < 0 || dist[u] === Infinity) break
    done[u] = 1
    for (const e of data.adjacency[u]) {
      const v = e.from === u ? e.to : e.from
      const d = dist[u] + e.length
      if (d < dist[v]) dist[v] = d
    }
  }
  return dist
}

// The piece of a polyline between two fractions (0 = start, 1 = end) of its length.
function slice(points, t0, t1) {
  const seg = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
    seg.push(l)
    total += l
  }
  const at = (t) => {
    let d = t * total
    for (let i = 0; i < seg.length; i++) {
      if (d <= seg[i] || i === seg.length - 1) {
        const f = seg[i] ? Math.min(d / seg[i], 1) : 0
        return [points[i][0] + (points[i + 1][0] - points[i][0]) * f, points[i][1] + (points[i + 1][1] - points[i][1]) * f]
      }
      d -= seg[i]
    }
  }
  const out = [at(t0)]
  let acc = 0
  for (let i = 0; i < seg.length - 1; i++) {
    acc += seg[i]
    if (acc / total > t0 && acc / total < t1) out.push(points[i + 1])
  }
  out.push(at(t1))
  return out
}

// The street pieces reachable within `budget` metres, including the reachable part of the last segment.
function reachedPieces(data, dist, budget) {
  const pieces = []
  for (const e of data.edges) {
    const a = Math.min(Math.max(budget - dist[e.from], 0), e.length) // walked in from the `from` end
    const b = Math.min(Math.max(budget - dist[e.to], 0), e.length) // walked in from the `to` end
    if (a + b >= e.length) pieces.push(e.points)
    else {
      if (a > 0) pieces.push(slice(e.points, 0, a / e.length))
      if (b > 0) pieces.push(slice(e.points, 1 - b / e.length, 1))
    }
  }
  return pieces
}

// The reached street pieces as single straight segments, filed in a grid so that
// "which segments are near this building?" is quick.
const GRID_M = 50
function segmentIndex(pieces) {
  const grid = new Map()
  const segments = []
  for (const piece of pieces)
    for (let i = 1; i < piece.length; i++) {
      const s = [piece[i - 1], piece[i]]
      const k = segments.push(s) - 1
      const [x0, x1] = [Math.min(s[0][0], s[1][0]), Math.max(s[0][0], s[1][0])]
      const [y0, y1] = [Math.min(s[0][1], s[1][1]), Math.max(s[0][1], s[1][1])]
      for (let gx = Math.floor(x0 / GRID_M); gx <= Math.floor(x1 / GRID_M); gx++)
        for (let gy = Math.floor(y0 / GRID_M); gy <= Math.floor(y1 / GRID_M); gy++) {
          const key = gx + ',' + gy
          if (!grid.has(key)) grid.set(key, [])
          grid.get(key).push(k)
        }
    }
  // Segments that come within `margin` metres of a box [west, south, east, north].
  const near = ([w, s, e, n], margin) => {
    const found = new Set()
    for (let gx = Math.floor((w - margin) / GRID_M); gx <= Math.floor((e + margin) / GRID_M); gx++)
      for (let gy = Math.floor((s - margin) / GRID_M); gy <= Math.floor((n + margin) / GRID_M); gy++)
        for (const k of grid.get(gx + ',' + gy) ?? []) found.add(k)
    return [...found].map((k) => segments[k])
  }
  return { near }
}

function pointSegmentDistance([px, py], [[ax, ay], [bx, by]]) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

function segmentsCross([a, b], [c, d]) {
  const side = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)
}

function insideRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// A footprint touches an area when some reached segment comes within the band width of it.
function touches(ring, segments, band) {
  for (const s of segments) {
    if (insideRing(s[0], ring)) return true
    for (let i = 1; i < ring.length; i++) {
      const edge = [ring[i - 1], ring[i]]
      if (segmentsCross(edge, s)) return true
      if (pointSegmentDistance(edge[0], s) <= band || pointSegmentDistance(s[0], edge) <= band || pointSegmentDistance(s[1], edge) <= band) return true
    }
  }
  return false
}

// The bands of the given segments, joined into one shape, as Clipper paths or a tree.
function bands(segments, out, halfWidth = BAND_M) {
  const offset = new ClipperLib.ClipperOffset(2, 0.25 * SCALE) // round ends and joins, 25 cm tolerance
  offset.AddPaths(segments.map(toPath), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound)
  offset.Execute(out, halfWidth * SCALE)
  return out
}

// A Clipper tree of outer rings and holes, as plain polygons in metres for drawing.
function treeToPolygons(tree) {
  const polygons = []
  const visit = (node) => {
    for (const outer of node.Childs()) {
      const polygon = { outer: toMetres(outer.Contour()), holes: [] }
      for (const hole of outer.Childs()) {
        polygon.holes.push(toMetres(hole.Contour()))
        visit(hole)
      }
      polygons.push(polygon)
    }
  }
  visit(tree)
  return polygons
}

// Lines widened by halfWidth metres on each side and joined, as polygons in metres.
export function widenLines(lines, halfWidth) {
  return treeToPolygons(bands(lines, new ClipperLib.PolyTree(), halfWidth))
}

export function nearestWalkableNode(data, [x, y]) {
  let best = -1
  let bestD = Infinity
  data.nodes.forEach(([nx, ny], i) => {
    if (!data.walkable[i]) return
    const d = Math.hypot(nx - x, ny - y)
    if (d < bestD) [best, bestD] = [i, d]
  })
  return { node: best, distance: bestD }
}

// Everything the page shows for one click at (x, y) metres.
export function computeReach(data, point) {
  const { node, distance } = nearestWalkableNode(data, point)
  if (node < 0 || distance > SNAP_M) return { tooFar: true, distance }

  const dist = walkDistances(data, node)

  // Largest area first, so each smaller one only needs to look at what the larger one found.
  const areas = []
  let candidates = data.buildings.map((_, i) => i)
  const tier = new Int8Array(data.buildings.length).fill(-1) // index into MINUTES of the smallest area touched
  for (let m = MINUTES.length - 1; m >= 0; m--) {
    const pieces = reachedPieces(data, dist, MINUTES[m] * SPEED_M_PER_MIN)
    const tree = bands(pieces, new ClipperLib.PolyTree()) // the whole area, for drawing
    const index = segmentIndex(pieces)

    candidates = candidates.filter((i) => {
      const b = data.buildings[i]
      const nearby = index.near(b.bbox.map((v) => v / SCALE), BAND_M)
      return nearby.length > 0 && touches(b.rings[0], nearby, BAND_M)
    })
    for (const i of candidates) tier[i] = m

    // Only the streets near a cell can put any of the area inside it, so build just those bands.
    let residents = 0
    let cellsWithoutFigure = 0
    for (const cell of data.cells) {
      const nearby = index.near(cell.bbox.map((v) => v / SCALE), BAND_M)
      if (!nearby.length) continue
      const inside = areaOf(intersect([cell.path], bands(nearby, new ClipperLib.Paths())))
      if (inside <= 0) continue
      if (cell.population == null) cellsWithoutFigure++
      else residents += cell.population * (inside / cell.area)
    }

    areas[m] = {
      minutes: MINUTES[m],
      polygons: treeToPolygons(tree),
      buildings: candidates.length,
      residents: Math.round(residents / 10) * 10,
      cellsWithoutFigure,
    }
  }

  return { start: data.nodes[node], snapDistance: distance, areas, tier }
}
