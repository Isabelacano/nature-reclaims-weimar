// Perception: where the observer is looking, and for how long.
//
// Two clues are combined. `point` is what the centre of the view actually hits (a building or
// the ground). `anchor` is the point the camera orbits around. Orbiting a building changes the
// first but not the second, so circling a place still counts as looking at it. A short glance
// elsewhere is tolerated; only a longer absence starts a new observation.

const TOLERANCE_S = 2.5 // how long the gaze may wander before the observation is over

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function createPerception() {
  return {
    point: null, // [x, y] in metres east and north: what is being looked at
    anchor: null, // the orbit point when this observation began
    building: -1, // the building most looked at in this observation, or -1
    seen: new Map(), // seconds per building within this observation
    dwell: 0, // seconds of continuous observation
    away: 0, // seconds the gaze has been elsewhere
    attention: 1, // how close and deliberate the looking is, 0.3..1.3
    distance: 0, // camera to the observed point, metres
    started: 0, // counts observations, so the mind knows a new one began
    inCity: false, // whether the gaze rests on the modelled city, not the forest beyond
  }
}

// look: { point, anchor, building, distance, inCity } — point is null when looking at the sky.
export function perceive(per, look, dt) {
  if (!look.point) {
    per.away += dt
  } else {
    const R = Math.min(Math.max(look.distance * 0.08, 35), 140)
    const same =
      per.point &&
      ((look.building >= 0 && per.seen.has(look.building) && per.seen.get(look.building) > 1) ||
        dist(look.point, per.point) < R ||
        (per.anchor && dist(look.anchor, per.anchor) < R * 0.8))
    if (same) {
      per.dwell += dt
      per.away = Math.max(0, per.away - dt * 2)
      // Follow the gaze slowly, so the reaction happens where the observer actually looks.
      per.point = [per.point[0] + (look.point[0] - per.point[0]) * 0.08, per.point[1] + (look.point[1] - per.point[1]) * 0.08]
      if (look.building >= 0) per.seen.set(look.building, (per.seen.get(look.building) ?? 0) + dt)
    } else {
      per.away += dt
      if (!per.point || per.away > TOLERANCE_S) {
        per.point = look.point
        per.anchor = look.anchor
        per.seen = new Map(look.building >= 0 ? [[look.building, dt]] : [])
        per.dwell = 0
        per.away = 0
        per.started++
      }
    }
    // Close, deliberate looking counts for more than a distant overview.
    per.distance = look.distance
    per.inCity = look.inCity
    per.attention = Math.min(Math.max(1.55 - look.distance / 2400, 0.35), 1.3)
  }
  if (!look.point) per.inCity = false
  // The building looked at longest in this observation.
  let best = -1
  let most = 0.8
  for (const [b, s] of per.seen) if (s > most) [best, most] = [b, s]
  per.building = best
  return per
}

export const observing = (per) => per.point && per.away < TOLERANCE_S
