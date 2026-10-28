import { useSyncExternalStore } from 'react'

// The one shared state between the entity (inside the 3D scene) and the interface around it.
// The entity writes it a few times a second; the panel reads it.

function createStore(initial) {
  let state = initial
  const listeners = new Set()
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch }
      listeners.forEach((l) => l())
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

export const entityStore = createStore({
  suspicion: 0, // 0..100, the human presence meter
  level: 'calm', // calm, noticed, responding, evading, confirmed
  falling: false, // suspicion is going down after having been high
  memory: 0, // how many times the city has confirmed a presence
  dwell: 0, // seconds of continuous observation of the current place
  focusLabel: '', // what is being observed, in words
  event: null, // { text, at } the last thing the entity really did
  history: [], // recent meter values, for the trace
  audio: { started: false, muted: false, volume: 0.7, failed: false },
})

export const useEntity = () => useSyncExternalStore(entityStore.subscribe, entityStore.get)
