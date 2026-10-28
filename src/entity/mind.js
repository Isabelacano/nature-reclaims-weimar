// The mind: evaluation (how sure is the city that someone is there?) and decision (what to do).
//
// It does not act itself. Every tick it reads the perception, updates its suspicion, and
// sometimes returns a decision; the body carries it out and reports what really happened.

const SECONDS_BEFORE_SUSPICION = 10
const CONFIRM_AT = 96 // crossing this sets off the recognition event
const REARM_BELOW = 40 // the meter must fall this low before it can happen again
const CONFIRM_COOLDOWN_S = 45

export const LEVELS = [
  { key: 'calm', up: 0, down: 0 },
  { key: 'noticed', up: 14, down: 13 },
  { key: 'responding', up: 30, down: 25 },
  { key: 'evading', up: 60, down: 54 },
  { key: 'confirmed', up: CONFIRM_AT, down: 88 },
]

// The reactions. weight: per level (noticed, responding, evading); cooldown in seconds.
// `needsBuilding`: only when the observer is looking at a building.
export const REACTIONS = {
  flicker: { weight: [5, 1, 0], cooldown: 6 },
  stillness: { weight: [3, 3, 1.5], cooldown: 20 },
  retreat: { weight: [1, 3, 2], cooldown: 18 },
  concealment: { weight: [0, 3, 3], cooldown: 22, needsBuilding: true },
  expansion: { weight: [0, 1, 3], cooldown: 16 },
  diversion: { weight: [0, 2, 3], cooldown: 35, remembers: true },
  evasion: { weight: [0, 0.7, 3], cooldown: 40, remembers: true },
}
// How long the mind waits between decisions at each level.
const GAP_S = { noticed: 9, responding: 7, evading: 5, confirmed: 5 }

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

export function createMind(random = Math.random) {
  return {
    random,
    suspicion: 2,
    peak: 2,
    level: 'calm',
    memory: 0, // confirmed encounters
    armed: true,
    lastConfirm: -Infinity,
    nextDecision: 0,
    ready: {}, // reaction type -> time it is allowed again
    history: [], // last reaction types, newest last
    spots: [], // where the entity recently acted: [{ point, until }]
    lostTrack: false,
  }
}

const levelIndex = (key) => LEVELS.findIndex((l) => l.key === key)

// Returns { decisions: [{ type, intensity }], confirm: bool, events: [text] }.
export function think(mind, per, now, dt) {
  const out = { decisions: [], confirm: false, events: [] }

  // ---- evaluation ----
  mind.spots = mind.spots.filter((s) => s.until > now)
  const following = per.point && mind.spots.some((s) => Math.hypot(s.point[0] - per.point[0], s.point[1] - per.point[1]) < 150)
  // Only looking at the city counts: the forest beyond is not the entity's own ground.
  const looking = per.point && per.away < 0.6 && per.inCity
  const ramp = smooth(SECONDS_BEFORE_SUSPICION, SECONDS_BEFORE_SUSPICION + 4, per.dwell)
  let rise = 0
  if (looking && ramp > 0) rise = 1.7 * ramp * per.attention * (1 + 0.2 * Math.min(mind.memory, 3))
  // Watching the very place where the entity just acted: it grows suspicious faster.
  if (looking && following && per.dwell > 4) rise = Math.max(rise, 1.2 * per.attention) * 1.45
  const floor = Math.min(12, mind.memory * 4) // it remembers earlier encounters, below "noticed"
  let fall = 0
  if (rise === 0) fall = per.away > 4 || !per.inCity ? 2.4 : per.point && per.dwell < SECONDS_BEFORE_SUSPICION ? 1.3 : 0.6
  mind.suspicion = Math.min(100, Math.max(floor, mind.suspicion + (rise - fall) * dt))
  mind.peak = Math.max(mind.peak, mind.suspicion)

  // Level, with a little hysteresis so it does not flicker between two states.
  let li = levelIndex(mind.level)
  while (li < LEVELS.length - 1 && mind.suspicion >= LEVELS[li + 1].up) li++
  while (li > 0 && mind.suspicion < LEVELS[li].down) li--
  mind.level = LEVELS[li].key

  // ---- the recognition event: once per crossing, then it must calm down well below ----
  if (mind.armed && mind.suspicion >= CONFIRM_AT && now - mind.lastConfirm > CONFIRM_COOLDOWN_S) {
    mind.armed = false
    mind.lastConfirm = now
    mind.memory++
    out.confirm = true
    mind.nextDecision = now + 9 // let the event breathe
  }
  if (!mind.armed && mind.suspicion < REARM_BELOW) mind.armed = true

  // A real state change worth telling: it was suspicious and is losing track.
  if (mind.peak > 45 && mind.suspicion < 28 && !mind.lostTrack) {
    mind.lostTrack = true
    out.events.push(mind.memory ? 'The city is losing track of you. It will remember.' : 'The city is losing track of you.')
  }
  if (mind.suspicion > 45) [mind.lostTrack, mind.peak] = [false, mind.suspicion]
  if (mind.suspicion < 10) mind.peak = mind.suspicion

  // ---- decision ----
  if (li >= 1 && looking && now >= mind.nextDecision && !out.confirm) {
    const col = Math.min(li, 3) - 1 // weight column: noticed, responding, evading
    const type = choose(mind, per, now, col)
    if (type) {
      const intensity = [0.45, 0.75, 1][col]
      out.decisions.push({ type, intensity })
      // At high awareness, sometimes a second, coordinated reaction.
      if (col === 2 && mind.random() < 0.35) {
        const second = choose(mind, per, now, col)
        if (second) out.decisions.push({ type: second, intensity: 0.8 })
      }
    }
    mind.nextDecision = now + GAP_S[mind.level] * (0.8 + 0.5 * mind.random())
  }
  return out
}

// A weighted choice among the reactions allowed now: not the last one, not on cooldown,
// fewer of the recently used, more of the "evasive" ones once the city remembers you.
function choose(mind, per, now, col) {
  const last = mind.history[mind.history.length - 1]
  const recent = mind.history.slice(-4)
  const options = []
  for (const [type, r] of Object.entries(REACTIONS)) {
    let w = r.weight[col]
    if (!w || type === last || (mind.ready[type] ?? 0) > now) continue
    if (r.needsBuilding && per.building < 0) continue
    w *= recent.includes(type) ? 0.5 : 1
    if (mind.memory && r.remembers) w *= 1.5
    if (mind.memory && type === 'flicker') w *= 0.5
    options.push([type, w])
  }
  const total = options.reduce((s, [, w]) => s + w, 0)
  if (!total) return null
  let pick = mind.random() * total
  for (const [type, w] of options) {
    if ((pick -= w) <= 0) {
      mind.ready[type] = now + REACTIONS[type].cooldown
      mind.history.push(type)
      if (mind.history.length > 12) mind.history.shift()
      return type
    }
  }
  return null
}

// The body reports where it acted, so the mind can notice the observer following it.
export function remember(mind, point, now, seconds = 25) {
  mind.spots.push({ point, until: now + seconds })
  if (mind.spots.length > 8) mind.spots.shift()
}
