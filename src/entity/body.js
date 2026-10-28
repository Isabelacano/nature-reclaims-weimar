import { ENTITY } from '../shaders.js'

// The body: carries out the mind's decisions in the world, and says in words what it did.
//
// Each effect is an envelope (attack, hold, release) on one of the shader fields in ENTITY.
// There is at most one effect per field; a new one replaces the old. Growth comes from a
// fixed pool of clumps. So nothing can pile up, however long the entity stays agitated.

const FIELDS = ['still', 'retreat', 'conceal', 'agitate', 'surge', 'turn']
const UNIFORM = { still: 'uStill', retreat: 'uRetreat', conceal: 'uConceal', agitate: 'uAgitate', surge: 'uSurge' }

const ease = (t) => t * t * (3 - 2 * t)

function envelope(e, now) {
  const t = now - e.start
  if (t < 0) return 0
  if (t < e.attack) return ease(t / e.attack)
  if (t < e.attack + e.hold) return 1
  const r = (t - e.attack - e.hold) / e.release
  return r < 1 ? 1 - ease(r) : -1 // -1: finished
}

const COMPASS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east']
const direction = ([dx, dy]) => COMPASS[Math.round(((Math.atan2(dy, dx) / (Math.PI * 2)) * 8 + 8) % 8) % 8]

export function createBody({ data, nature, world, random = Math.random }) {
  const fx = {}
  let pulse = null
  const buildings = data.buildings
  const centroid = buildings.map((b) => {
    const ring = b.rings[0]
    let [x, y] = [0, 0]
    for (const [px, py] of ring) [x, y] = [x + px, y + py]
    return [x / ring.length, y / ring.length]
  })
  const extent = buildings.map((b, i) => Math.max(...b.rings[0].map(([x, y]) => Math.hypot(x - centroid[i][0], y - centroid[i][1]))))

  // How much stronger every reaction is as suspicion rises: up to 2.8 times at 100.
  let suspicion = 0
  const boost = () => 1 + 1.8 * (suspicion / 100) ** 2

  const start = (field, at, radius, amount, attack, hold, release, now, path) => {
    fx[field] = { at, radius, amount, attack, hold, release, start: now, path }
  }

  // The walls of building `b` that face the camera, as [x, y, nx, ny] points every 2 m.
  function facingWall(b, eye) {
    const ring = buildings[b].rings[0].slice(0, -1)
    let area = 0
    for (let i = 0; i < ring.length; i++) area += ring[i][0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * ring[i][1]
    const sign = area > 0 ? 1 : -1
    const pts = []
    for (let i = 0; i < ring.length; i++) {
      const [a, c] = [ring[i], ring[(i + 1) % ring.length]]
      const len = Math.hypot(c[0] - a[0], c[1] - a[1])
      if (len < 1) continue
      const [nx, ny] = [(sign * (c[1] - a[1])) / len, (-sign * (c[0] - a[0])) / len]
      const [mx, my] = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]
      if (nx * (eye[0] - mx) + ny * (eye[1] - my) <= 0) continue
      for (let d = 0; d < len; d += 2) pts.push([a[0] + ((c[0] - a[0]) * d) / len, a[1] + ((c[1] - a[1]) * d) / len, nx, ny])
    }
    return pts
  }

  // The side of a building facing the eye, in words: "the western facade".
  const facadeName = (b, eye) => {
    const [cx, cy] = centroid[b]
    const d = direction([eye[0] - cx, eye[1] - cy])
    const adj = { east: 'eastern', west: 'western', north: 'northern', south: 'southern', 'north-east': 'north-eastern', 'north-west': 'north-western', 'south-east': 'south-eastern', 'south-west': 'south-western' }
    return `the ${adj[d]} facade`
  }

  // A building some distance from `from`, preferably visible from where the observer stands.
  function distantBuilding(from, visible) {
    let best = -1
    let score = -Infinity
    for (let k = 0; k < 60; k++) {
      const b = Math.floor(random() * buildings.length)
      const d = Math.hypot(centroid[b][0] - from[0], centroid[b][1] - from[1])
      if (d < 220 || d > 750 || buildings[b].height < 7) continue
      const s = (visible(centroid[b]) ? 2 : 0) + buildings[b].height / 30 + random()
      if (s > score) [best, score] = [b, s]
    }
    return best
  }

  // Ground spots near a point that are not inside a building.
  function openSpots(at, radius, n) {
    const out = []
    for (let k = 0; k < n * 4 && out.length < n; k++) {
      const a = random() * Math.PI * 2
      const r = radius * Math.sqrt(random())
      const [x, y] = [at[0] + Math.cos(a) * r, at[1] + Math.sin(a) * r]
      if (nature.buildingAt(x, y) < 0) out.push([x, y])
    }
    return out
  }

  // The n buildings higher than 4 m nearest to a point, within maxD metres.
  function nearestBuildings(at, n, maxD) {
    const near = []
    centroid.forEach(([x, y], i) => {
      const d = Math.hypot(x - at[0], y - at[1])
      if (d < maxD && buildings[i].height > 4) near.push([d, i])
    })
    return near
      .sort((a, c) => a[0] - c[0])
      .slice(0, n)
      .map(([, i]) => i)
  }

  // Vine curtains hanging from the cornice over the walls of building b that face the eye.
  // Each curtain is turned so its leaves face out along the wall's normal.
  function coverWithVines(b, eye, share, delay, intensity) {
    const wall = facingWall(b, eye)
    const h = buildings[b].height
    const items = []
    const n = Math.min(40, Math.ceil(((wall.length * 2) / 5) * share * boost()))
    for (let k = 0; k < n && wall.length; k++) {
      const [x, y, nx, ny] = wall[Math.floor(random() * wall.length)]
      const w = 5 + 4 * random()
      const len = Math.min(h * 0.97, w * (1 + 0.8 * random() * intensity))
      items.push({ kind: 'vine', x: x + nx * 0.5, y: y + ny * 0.5, z: h + 0.3, sx: w, sy: len, sz: w * 0.6, turn: Math.atan2(nx, -ny), delay: delay + random() * 2.5, life: 26, grow: 4 })
    }
    return items
  }

  // Leafy shrubs on open ground near a point (they ride up with the upheaval in the shader).
  function sprigsAround(at, radius, n, size, spread, life) {
    return openSpots(at, radius, n).map(([x, y]) => {
      const s = size * (0.6 + 0.8 * random())
      return { kind: 'sprig', x, y, z: nature.massTop(x, y) * 0.9, sx: s * 1.2, sy: s * (0.8 + 0.6 * random()), sz: s * 1.2, turn: random() * 6.28, delay: random() * spread, life: life + random() * 6, grow: 2.6 }
    })
  }

  // ---- the upheaval: under prolonged observation the land rises around the observed place ----
  // Its amount follows the suspicion, slowly at first and then faster and faster; it rises over
  // about 4 s toward that target and sinks back over about 10 s when the observer looks away.
  const swell = { at: null, amount: 0, roots: false, said: {}, creep: 0 }
  function updateSwell(dt, per, S, watching, now) {
    suspicion = S
    // It grows only while you watch near its centre; it moves to a new place only once it has all but settled.
    const settled = !swell.at || swell.amount < 0.02
    const near = watching && per.point && per.inCity && (settled || Math.hypot(per.point[0] - swell.at[0], per.point[1] - swell.at[1]) < 160 + 200 * swell.amount)
    const target = near ? Math.pow(Math.min(Math.max((S - 25) / 75, 0), 1), 1.7) : 0
    if (target > 0 && settled) {
      swell.at = [...per.point]
      world.upheaval?.place(swell.at)
    }
    const before = swell.amount
    const tau = target > swell.amount ? 4 : 10
    swell.amount += (target - swell.amount) * (1 - Math.exp(-dt / tau))
    if (swell.amount < 0.001 && target === 0) swell.amount = 0
    const a = swell.amount
    const R = 160 + 240 * a
    const at = swell.at ?? [0, 0]
    ENTITY.uSwell.value.set(at[0], 0, -at[1], R)
    ENTITY.uSwellA.value = a

    const events = []
    // Great roots rise around the nearest buildings, the closest first.
    if (a > 0.12 && !swell.roots && swell.at) {
      const list = nearestBuildings(swell.at, 16, 320).map((i) => ({ index: i, delay: (1.4 * Math.hypot(centroid[i][0] - at[0], centroid[i][1] - at[1])) / 320 }))
      world.consume?.build(list)
      swell.roots = true
      events.push('Roots are rising out of the ground and climbing the buildings around you.')
    }
    world.consume?.setGrow(a * 1.5)
    if (a < 0.03 && swell.roots) {
      world.consume?.clear()
      swell.roots = false
    }
    // New growth creeps over the risen land, faster and faster.
    swell.creep += 20 * a * a * dt
    if (swell.creep >= 1 && swell.at) {
      const n = Math.floor(swell.creep)
      swell.creep -= n
      world.growth?.spawn(sprigsAround(at, R * 0.85, n, 3 + 3 * a, 0.5, 14 + 10 * a), now)
    }
    // Say what happens, once each time.
    const say = (key, text, when) => {
      if (when && !swell.said[key]) {
        swell.said[key] = true
        events.push(text)
      }
    }
    say('rise', 'The ground is rising around the observed area.', a > 0.08 && a > before)
    say('bury', 'The land is closing over the streets and burying the buildings.', a > 0.55 && a > before)
    say('settle', 'The ground is slowly settling back.', swell.said.rise && target === 0 && a < before && a > 0.05)
    if (a < 0.03) swell.said = {}
    return events
  }

  // Carry out one decision. Returns { text, point } or null if it could not be done here.
  function act(type, intensity, per, eye, now, visible) {
    const at = per.point
    const b = per.building
    const thing = b >= 0 ? 'the observed structure' : 'the observed ground'
    const R = (45 + 45 * intensity) * boost()
    switch (type) {
      case 'flicker':
        start('agitate', at, 40, 0.5 * intensity + 0.2, 0.6, 1.8, 1.6, now)
        return { text: `Leaves stirred near ${thing}.`, point: at, sound: 'rustle' }
      case 'stillness':
        start('still', at, R + 30, 1, 1.5, 8, 3, now)
        return { text: `The vegetation around ${thing} has gone unusually still.`, point: at, sound: 'hush' }
      case 'retreat':
        start('retreat', b >= 0 ? centroid[b] : at, b >= 0 ? extent[b] + 25 : R, 0.6 + 0.4 * intensity, 2.5, 7, 6, now)
        return { text: b >= 0 ? `Vines are withdrawing from ${facadeName(b, eye)}.` : 'Leaves are drawing back from where you look.', point: at, sound: 'rustle' }
      case 'concealment': {
        if (b < 0) return null
        // Vines pour over the facade that faces you; at high suspicion over the neighbours' too.
        const around = nearestBuildings(centroid[b], 1 + Math.round(4 * Math.min(Math.max((suspicion - 30) / 60, 0), 1)), 90).filter((n) => n !== b)
        around.unshift(b)
        const reach = Math.max(...around.map((n) => Math.hypot(centroid[n][0] - centroid[b][0], centroid[n][1] - centroid[b][1]) + extent[n]))
        start('conceal', centroid[b], reach + 20, 0.7 + 0.3 * intensity, 4, 16, 10, now)
        world.growth?.spawn(around.flatMap((n, j) => coverWithVines(n, eye, j === 0 ? 1 : 0.6, j * 1.2, intensity)), now)
        const more = around.length > 1 ? ' and the buildings beside it' : ''
        return { text: `Vegetation is obscuring ${facadeName(b, eye)}${more}.`, point: centroid[b], sound: 'growth' }
      }
      case 'expansion': {
        start('surge', at, R + 20, 1, 0.8, 3, 7, now)
        start('agitate', at, R + 20, 0.9, 0.3, 2, 2.5, now)
        world.growth?.spawn(sprigsAround(at, R + 15, Math.round((30 + 30 * intensity) * boost()), 2.5 + 3 * intensity, 1.4, 18), now)
        return { text: `A sudden burst of growth near ${thing}.`, point: at, sound: 'growth' }
      }
      case 'diversion': {
        const target = distantBuilding(at, visible)
        if (target < 0) return null
        world.divert?.grow(target, now)
        world.growth?.spawn(sprigsAround(centroid[target], extent[target] + 30, Math.round(14 * boost()), 3, 2, 20), now)
        start('agitate', centroid[target], extent[target] + 60, 1, 1, 8, 4, now)
        const dir = direction([centroid[target][0] - at[0], centroid[target][1] - at[1]])
        return { text: `Movement detected near a building to the ${dir}.`, point: centroid[target], sound: 'rustle', soundAt: centroid[target] }
      }
      case 'evasion': {
        const a = random() * Math.PI * 2
        const d = 320 + 260 * random()
        const to = [at[0] + Math.cos(a) * d, at[1] + Math.sin(a) * d]
        start('still', at, R + 40, 1, 1.5, 11, 4, now)
        start('agitate', at, 110, 1, 1, 12, 4, now, [at, to])
        return { text: `The entity has shifted its activity toward the ${direction([to[0] - at[0], to[1] - at[1]])}.`, point: to, sound: 'rustle', soundAt: to }
      }
    }
    return null
  }

  // The recognition: a wave from where you look, every tree turning toward you, growth closing in.
  function confirm(per, eye, now) {
    pulse = { at: per.point, start: now }
    start('turn', per.point, 1, 1, 2.5, 6, 5, now)
    start('agitate', per.point, 260, 1, 0.5, 4, 4, now)
    if (per.building >= 0) {
      const b = per.building
      start('conceal', centroid[b], extent[b] + 30, 1, 3, 14, 10, now)
      world.growth?.spawn(nearestBuildings(centroid[b], 5, 120).flatMap((n, j) => coverWithVines(n, eye, 1, 0.5 + j * 0.6, 1)), now)
    }
    start('surge', per.point, 220, 1, 1, 6, 6, now)
    world.growth?.spawn(sprigsAround(per.point, 200, 160, 5, 4, 26), now)
    return { text: 'The city has turned toward you.', point: per.point }
  }

  // Every frame: write the envelopes into the shader fields.
  function update(now, aware) {
    for (const f of FIELDS) {
      const e = fx[f]
      let a = 0
      if (e) {
        a = envelope(e, now)
        if (a < 0) {
          delete fx[f]
          a = 0
        } else {
          a *= e.amount
          let at = e.at
          if (e.path) {
            const t = ease(Math.min((now - e.start) / (e.attack + e.hold), 1))
            at = [e.path[0][0] + (e.path[1][0] - e.path[0][0]) * t, e.path[0][1] + (e.path[1][1] - e.path[0][1]) * t]
            e.current = at
          }
          if (UNIFORM[f]) ENTITY[UNIFORM[f]].value.set(at[0], 0, -at[1], e.radius)
        }
      }
      if (f === 'turn') ENTITY.uTurnA.value = a
      else ENTITY[UNIFORM[f] + 'A'].value = a
    }
    if (pulse) {
      const t = now - pulse.start
      ENTITY.uPulse.value.set(pulse.at[0], 0, -pulse.at[1], 1)
      ENTITY.uPulseT.value = t
      if (t > 16) [pulse, ENTITY.uPulseT.value] = [null, -1]
    }
    ENTITY.uAware.value += (aware - ENTITY.uAware.value) * 0.03
    ENTITY.uWind.value = 1 + 0.4 * ENTITY.uAware.value
  }

  // Where the entity is active right now (for following, and for the sound's direction).
  const activeAt = () => (fx.agitate ? fx.agitate.current ?? fx.agitate.at : null)

  return { act, confirm, update, updateSwell, activeAt, centroid, swell }
}
