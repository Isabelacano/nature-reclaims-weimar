// The soundscape, made in the browser with the Web Audio API: no files, no external service.
//
// Layers fade in with the entity's awareness: a low drone and the air are always there;
// a pad, sparse falling notes, a beating high tension and a slow pulse join as it rises.
// Reactions add a rustle; the recognition has its own sound. Muting silences the output
// only; the entity goes on.

const D_MINOR = [293.66, 349.23, 392.0, 440.0, 523.25] // D F G A C: calm, open
const UNEASY = [293.66, 311.13, 392.0, 415.3, 523.25] // with E flat and A flat: something is off

function createImpulse(ctx, seconds, decay) {
  const n = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay)
  }
  return buf
}

function createNoise(ctx, seconds = 4) {
  const n = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let b = 0
  for (let i = 0; i < n; i++) {
    b = 0.97 * b + 0.03 * (Math.random() * 2 - 1) // a softer, browner noise
    d[i] = b * 6
  }
  return buf
}

export function createSoundscape() {
  let ctx = null
  let nodes = null
  let volume = 0.7
  let muted = false
  let aware = 0
  let timers = []

  const smooth = (param, value, seconds = 2) => param.setTargetAtTime(value, ctx.currentTime, seconds / 3)

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    const master = ctx.createGain()
    master.gain.value = 0
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 3
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    master.connect(comp).connect(analyser).connect(ctx.destination)
    const music = ctx.createGain()
    music.gain.value = 0.9
    music.connect(master)
    const sfx = ctx.createGain()
    sfx.gain.value = 1
    sfx.connect(master)
    const reverb = ctx.createConvolver()
    reverb.buffer = createImpulse(ctx, 5, 2.6)
    const wet = ctx.createGain()
    wet.gain.value = 0.55
    reverb.connect(wet).connect(master)
    const noise = createNoise(ctx)

    const osc = (type, freq, detune = 0) => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = freq
      o.detune.value = detune
      o.start()
      return o
    }
    const gain = (v) => {
      const g = ctx.createGain()
      g.gain.value = v
      return g
    }
    const lfo = (freq, depth, target) => {
      const o = osc('sine', freq)
      const g = gain(depth)
      o.connect(g).connect(target)
    }

    // Drone: two low, slightly detuned tones under a slowly breathing filter.
    const droneFilter = ctx.createBiquadFilter()
    droneFilter.type = 'lowpass'
    droneFilter.frequency.value = 360
    lfo(0.03, 140, droneFilter.frequency)
    const drone = gain(0.12)
    for (const [t, f, d, v] of [
      ['sine', 55, 0, 0.9],
      ['triangle', 82.41, 5, 0.45],
      ['sine', 110, -4, 0.25],
    ]) {
      const g = gain(v)
      osc(t, f, d).connect(g).connect(droneFilter)
    }
    droneFilter.connect(drone).connect(music)
    drone.connect(reverb)

    // Air: wind through leaves, panning slowly.
    const airSrc = ctx.createBufferSource()
    airSrc.buffer = noise
    airSrc.loop = true
    airSrc.start()
    const airFilter = ctx.createBiquadFilter()
    airFilter.type = 'bandpass'
    airFilter.frequency.value = 900
    airFilter.Q.value = 0.6
    lfo(0.05, 450, airFilter.frequency)
    const airPan = ctx.createStereoPanner()
    lfo(0.023, 0.6, airPan.pan)
    const air = gain(0.05)
    airSrc.connect(airFilter).connect(airPan).connect(air).connect(music)

    // Pad: a soft open chord that appears as the city takes notice.
    const padFilter = ctx.createBiquadFilter()
    padFilter.type = 'lowpass'
    padFilter.frequency.value = 900
    const pad = gain(0)
    for (const [f, d] of [
      [146.83, 0],
      [220, 6],
      [329.63, -5],
      [349.23, 3],
    ]) {
      const g = gain(0.22)
      osc('triangle', f, d).connect(g).connect(padFilter)
      lfo(0.07 + Math.random() * 0.05, 0.08, g.gain)
    }
    padFilter.connect(pad).connect(music)
    pad.connect(reverb)

    // Tension: two close high tones beating against each other, and a thin shimmer.
    const tension = gain(0)
    const tf = ctx.createBiquadFilter()
    tf.type = 'lowpass'
    tf.frequency.value = 2400
    for (const [f, v] of [
      [587.33, 0.35],
      [593.1, 0.35],
      [880.5, 0.12],
    ]) {
      const g = gain(v)
      osc('sine', f).connect(g).connect(tf)
    }
    const shimmerSrc = ctx.createBufferSource()
    shimmerSrc.buffer = noise
    shimmerSrc.loop = true
    shimmerSrc.start()
    const shimmer = ctx.createBiquadFilter()
    shimmer.type = 'bandpass'
    shimmer.frequency.value = 3600
    shimmer.Q.value = 5
    const sg = gain(0.12)
    shimmerSrc.connect(shimmer).connect(sg).connect(tf)
    tf.connect(tension).connect(music)
    tension.connect(reverb)

    // Rumble: the ground moving, a deep filtered roar and a slow sub tone, heard only while the land rises.
    const rumbleSrc = ctx.createBufferSource()
    rumbleSrc.buffer = noise
    rumbleSrc.loop = true
    rumbleSrc.start()
    const rumbleFilter = ctx.createBiquadFilter()
    rumbleFilter.type = 'lowpass'
    rumbleFilter.frequency.value = 140
    rumbleFilter.Q.value = 0.9
    lfo(0.11, 40, rumbleFilter.frequency)
    const rumble = gain(0)
    rumbleSrc.connect(rumbleFilter).connect(rumble)
    const sub = gain(0.5)
    osc('sine', 31).connect(sub).connect(rumble)
    lfo(0.17, 0.25, sub.gain)
    rumble.connect(music)
    rumble.connect(reverb)

    nodes = { master, music, sfx, reverb, analyser, noise, drone, droneFilter, air, airFilter, pad, padFilter, tension, rumble, pulse: gain(0) }
    nodes.pulse.connect(music)
    schedule()
  }

  // Sparse, delicate events in time: a falling note now and then, and a slow pulse when uneasy.
  function schedule() {
    const note = () => {
      if (!ctx) return
      const set = aware > 0.55 ? UNEASY : D_MINOR
      const f = set[Math.floor(Math.random() * set.length)] * (Math.random() < 0.3 ? 0.5 : 1)
      const t = ctx.currentTime
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      o.detune.value = aware > 0.75 ? (Math.random() - 0.5) * 60 : 0
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.05, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3)
      const pan = ctx.createStereoPanner()
      pan.pan.value = Math.random() * 1.4 - 0.7
      o.connect(g).connect(pan)
      pan.connect(nodes.music)
      pan.connect(nodes.reverb)
      o.start(t)
      o.stop(t + 3.1)
      timers.push(setTimeout(note, (5 + Math.random() * 9 - aware * 3) * 1000))
    }
    const beat = () => {
      if (!ctx) return
      if (aware > 0.6) {
        const t = ctx.currentTime
        for (const [dt, v] of [
          [0, 1],
          [0.32, 0.55],
        ]) {
          const o = ctx.createOscillator()
          o.frequency.setValueAtTime(62, t + dt)
          o.frequency.exponentialRampToValueAtTime(40, t + dt + 0.5)
          const g = ctx.createGain()
          g.gain.setValueAtTime(0, t + dt)
          g.gain.linearRampToValueAtTime(0.32 * v, t + dt + 0.03)
          g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.7)
          o.connect(g).connect(nodes.pulse)
          o.start(t + dt)
          o.stop(t + dt + 0.8)
        }
      }
      timers.push(setTimeout(beat, (2.6 - aware * 1.1) * 1000))
    }
    timers.push(setTimeout(note, 2500))
    timers.push(setTimeout(beat, 3000))
  }

  // A burst of noise through a moving filter: leaves, branches, growth.
  function rustle({ level = 0.14, from = 700, to = 2200, attack = 0.4, release = 1.8, pan = 0 } = {}) {
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = nodes.noise
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 0.9
    f.frequency.setValueAtTime(from, t)
    f.frequency.exponentialRampToValueAtTime(to, t + attack + release)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release)
    const p = ctx.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, pan))
    src.connect(f).connect(g).connect(p)
    p.connect(nodes.sfx)
    p.connect(nodes.reverb)
    src.start(t, Math.random() * 2)
    src.stop(t + attack + release + 0.1)
  }

  return {
    // Must be called from a click: browsers only allow sound after the user asks for it.
    async start() {
      if (!ctx) build()
      if (ctx.state !== 'running') await ctx.resume()
      smooth(nodes.master.gain, muted ? 0 : volume, 3)
      return ctx.state === 'running'
    },
    get started() {
      return !!ctx && ctx.state === 'running'
    },
    setMuted(m) {
      muted = m
      if (ctx) smooth(nodes.master.gain, muted ? 0 : volume, 0.6)
    },
    setVolume(v) {
      volume = v
      if (ctx && !muted) smooth(nodes.master.gain, volume, 0.3)
    },
    // Awareness 0..1: the layers follow it slowly; nothing jumps. swell 0..1: the rising ground.
    update(a, swell = 0) {
      aware = a
      if (!ctx) return
      smooth(nodes.rumble.gain, 0.32 * swell, 2)
      const s = (lo, hi) => Math.min(Math.max((a - lo) / (hi - lo), 0), 1)
      smooth(nodes.drone.gain, 0.12 + 0.05 * a, 4)
      smooth(nodes.droneFilter.frequency, 360 + 300 * a, 4)
      smooth(nodes.pad.gain, 0.07 * s(0.12, 0.5), 5)
      smooth(nodes.padFilter.frequency, 700 + 900 * a, 5)
      smooth(nodes.tension.gain, 0.045 * s(0.45, 0.9), 5)
      smooth(nodes.pulse.gain, s(0.6, 0.9), 3)
    },
    // A reaction's sound. pan: -1 left .. 1 right.
    react(kind, pan = 0) {
      if (!ctx) return
      if (kind === 'rustle') rustle({ pan })
      else if (kind === 'growth') rustle({ level: 0.18, from: 300, to: 1400, attack: 0.9, release: 2.6, pan })
      else if (kind === 'hush') {
        // The air itself goes quiet for a while, then returns.
        smooth(nodes.air.gain, 0.008, 1.5)
        timers.push(setTimeout(() => ctx && smooth(nodes.air.gain, 0.05, 4), 9000))
      }
    },
    // The recognition: a low double pulse, a slow resonant swell and the whole city breathing in.
    // The music dips under it but keeps playing.
    confirm() {
      if (!ctx) return false
      const t = ctx.currentTime
      const out = ctx.createGain()
      out.gain.value = 0.9
      out.connect(nodes.sfx)
      out.connect(nodes.reverb)
      for (const [dt, v] of [
        [0, 1],
        [0.9, 0.7],
      ]) {
        const o = ctx.createOscillator()
        o.frequency.setValueAtTime(36, t + dt)
        o.frequency.exponentialRampToValueAtTime(58, t + dt + 1.2)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t + dt)
        g.gain.linearRampToValueAtTime(0.5 * v, t + dt + 0.06)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 3.5)
        o.connect(g).connect(out)
        o.start(t + dt)
        o.stop(t + dt + 3.6)
      }
      const swellFilter = ctx.createBiquadFilter()
      swellFilter.type = 'lowpass'
      swellFilter.Q.value = 6
      swellFilter.frequency.setValueAtTime(260, t)
      swellFilter.frequency.exponentialRampToValueAtTime(2200, t + 2.2)
      swellFilter.frequency.exponentialRampToValueAtTime(500, t + 6.5)
      const swell = ctx.createGain()
      swell.gain.setValueAtTime(0, t)
      swell.gain.linearRampToValueAtTime(0.16, t + 1.6)
      swell.gain.exponentialRampToValueAtTime(0.0001, t + 7)
      for (const [f, d] of [
        [73.42, 0],
        [110, 4],
        [146.83, -3],
        [329.63, 7],
        [415.3, -6],
      ]) {
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = f
        o.detune.value = d
        o.connect(swellFilter)
        o.start(t)
        o.stop(t + 7.1)
      }
      swellFilter.connect(swell).connect(out)
      rustle({ level: 0.2, from: 350, to: 3200, attack: 1.6, release: 2.8 })
      nodes.music.gain.cancelScheduledValues(t)
      nodes.music.gain.setTargetAtTime(0.55, t, 0.4)
      nodes.music.gain.setTargetAtTime(0.9, t + 4, 1.5)
      return true
    },
    // How loud the output is right now (0..1), to check that sound is really playing.
    level() {
      if (!ctx) return 0
      const a = new Float32Array(nodes.analyser.fftSize)
      nodes.analyser.getFloatTimeDomainData(a)
      return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)
    },
    get state() {
      return ctx ? ctx.state : 'not started'
    },
  }
}

export const soundscape = createSoundscape()
