import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ENTITY } from '../shaders.js'
import { soundscape } from '../audio/soundscape.js'
import { createPerception, observing, perceive } from './perception.js'
import { createMind, remember, think } from './mind.js'
import { createBody } from './body.js'
import { entityStore } from './store.js'

// The entity's loop, inside the 3D scene: perceive → evaluate and decide → act, a few times a second.

const TICK_S = 0.15

const USE_WORDS = {
  residential: 'a residential building',
  service: 'a building of services',
  education: 'a school building',
  civic: 'a civic building',
  entertainment: 'a former place of entertainment',
  retail: 'a building of shops',
  food_and_drink: 'a former café or restaurant',
  office: 'an office building',
  health: 'a building of care',
  accommodation: 'a former hotel',
  culture: 'a cultural building',
  sport: 'a sports building',
  transport: 'a transport building',
  light_industrial: 'a workshop',
}

// What the centre of the view hits: march along the ray through the building grid, else the ground.
function lookAt(camera, controls, nature, buildings, kit, ray) {
  camera.getWorldDirection(ray)
  const o = camera.position
  const anchor = controls ? [controls.target.x, -controls.target.z] : [o.x, -o.z]
  if (ray.y > -0.01) return { point: null, anchor, building: -1, distance: 0, inCity: false }
  const tGround = -o.y / ray.y
  const MAX_H = 90
  let t = o.y > MAX_H ? (o.y - MAX_H) / -ray.y : 0
  for (; t < tGround; t += 1.5) {
    const [x, y, z] = [o.x + ray.x * t, o.y + ray.y * t, o.z + ray.z * t]
    const b = nature.buildingAt(x, -z)
    if (b >= 0 && y <= buildings[b].height) return { point: [x, -z], anchor, building: b, distance: t, inCity: true }
  }
  const [x, y] = [o.x + ray.x * tGround, -(o.z + ray.z * tGround)]
  const inCity = x > kit[0] && x < kit[2] && y > kit[1] && y < kit[3]
  return { point: [x, y], anchor, building: -1, distance: tGround, inCity }
}

export default function EntityDriver({ data, nature, world, kit }) {
  const { camera, controls, scene } = useThree()
  const state = useMemo(
    () => ({
      per: createPerception(),
      mind: createMind(),
      body: createBody({ data, nature, world }),
      ray: new THREE.Vector3(),
      acc: 0,
      lastPublish: 0,
      history: [],
      lastHistory: 0,
      swellEvents: [],
    }),
    [data, nature, world],
  )
  const frustum = useRef(new THREE.Frustum())
  const m = useRef(new THREE.Matrix4())

  // In development only, a handle for testing from the browser console.
  useEffect(() => {
    if (import.meta.env.DEV) window.__entity = { ...state, store: entityStore, soundscape, camera, controls, scene, ENTITY }
  }, [state, camera, controls, scene])

  useFrame((three, dt) => {
    const now = three.clock.elapsedTime
    ENTITY.uTime.value = now
    ENTITY.uEye.value.copy(camera.position)
    const { per, mind, body } = state
    state.acc += Math.min(dt, 0.1)
    // The land itself rises under prolonged observation and settles when you look away (every frame, so it moves smoothly).
    state.swellEvents.push(...body.updateSwell(Math.min(dt, 0.1), per, mind.suspicion, !!observing(per), now))

    if (state.acc >= TICK_S) {
      const step = state.acc
      state.acc = 0
      // Perception.
      const look = lookAt(camera, controls, nature, data.buildings, kit, state.ray)
      perceive(per, look, step)
      // Evaluation and decision.
      const out = think(mind, per, now, step)
      const eye = [camera.position.x, -camera.position.z]
      m.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.current.setFromProjectionMatrix(m.current)
      const visible = ([x, y]) => frustum.current.containsPoint(new THREE.Vector3(x, 10, -y))
      // Left or right of the view, for the sound.
      const panOf = (p) => {
        if (!p) return 0
        const v = new THREE.Vector3(p[0], 5, -p[1]).project(camera)
        return Math.max(-1, Math.min(1, v.x))
      }
      let event = null
      // Action.
      if (out.confirm) {
        const done = body.confirm(per, eye, now)
        remember(mind, done.point, now, 30)
        soundscape.confirm()
        event = done.text
      }
      for (const d of out.decisions) {
        const done = body.act(d.type, d.intensity, per, eye, now, visible)
        if (!done) continue
        remember(mind, done.point, now)
        if (done.sound) soundscape.react(done.sound, panOf(done.soundAt ?? done.point))
        event = done.text
      }
      // The entity's moving activity counts as a place it acted, while it moves.
      const moving = body.activeAt()
      if (moving) remember(mind, moving, now, 2)
      if (!event && state.swellEvents.length) event = state.swellEvents[state.swellEvents.length - 1]
      state.swellEvents = []
      if (!event && out.events.length) event = out.events[0]
      soundscape.update(mind.suspicion / 100, body.swell.amount)

      // Publish to the interface: a few times a second, or at once when something happened.
      if (now - state.lastHistory > 0.5) {
        state.history = [...state.history.slice(-119), mind.suspicion]
        state.lastHistory = now
      }
      if (event || now - state.lastPublish > 0.25) {
        state.lastPublish = now
        const b = per.building
        const label = !per.point
          ? 'the sky'
          : b >= 0
            ? `${USE_WORDS[data.buildings[b].use] ?? 'a building'}, ${data.buildings[b].floors} floor${data.buildings[b].floors === 1 ? '' : 's'}`
            : look.inCity
              ? 'overgrown ground'
              : 'the forest beyond the city'
        entityStore.set({
          suspicion: mind.suspicion,
          level: mind.level,
          falling: mind.lostTrack,
          memory: mind.memory,
          dwell: per.point && per.away < 2.5 ? per.dwell : 0,
          focusLabel: label,
          history: state.history,
          ...(event ? { event: { text: event, at: Date.now() } } : {}),
        })
      }
    }
    body.update(now, mind.suspicion / 100)
  })
  return null
}
