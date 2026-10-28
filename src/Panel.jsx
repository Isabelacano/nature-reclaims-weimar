import { useEffect, useRef, useState } from 'react'
import { entityStore, useEntity } from './entity/store.js'
import { soundscape } from './audio/soundscape.js'

// The field instrument: title, the human presence meter, the entity's state, the last event,
// and the sound. Every line reflects the entity's actual state.

const READOUT = [
  [96, 'Presence confirmed.'],
  [60, 'Human presence suspected.'],
  [30, 'Something is watching.'],
  [8, 'Unusual observation detected.'],
  [0, 'No human life detected.'],
]

const STATE = {
  calm: 'The city is undisturbed.',
  noticed: 'A familiar pattern has been interrupted.',
  responding: 'The vegetation is responding.',
  evading: 'Something is avoiding your gaze.',
  confirmed: 'Human presence confirmed.',
}

const SEGMENTS = 32
const EVENT_SHOWN_MS = 14000

function Trace({ history, value }) {
  const ref = useRef()
  useEffect(() => {
    const c = ref.current
    const dpr = window.devicePixelRatio || 1
    const [w, h] = [c.clientWidth, c.clientHeight]
    c.width = w * dpr
    c.height = h * dpr
    const g = c.getContext('2d')
    g.scale(dpr, dpr)
    g.clearRect(0, 0, w, h)
    const css = getComputedStyle(c)
    g.strokeStyle = css.getPropertyValue('--trace-grid')
    g.lineWidth = 1
    for (const v of [30, 60, 96]) {
      const y = h - (v / 100) * (h - 4) - 2
      g.beginPath()
      g.setLineDash([2, 4])
      g.moveTo(0, y + 0.5)
      g.lineTo(w, y + 0.5)
      g.stroke()
    }
    g.setLineDash([])
    // The meter's recent history, with a fine tremor that grows with the signal.
    const n = 120
    g.beginPath()
    history.forEach((v, i) => {
      const x = w - ((history.length - 1 - i) / (n - 1)) * w
      const tremor = Math.sin(i * 2.7) * (v / 100) * 2.2
      const y = h - (v / 100) * (h - 4) - 2 + tremor
      i ? g.lineTo(x, y) : g.moveTo(x, y)
    })
    g.strokeStyle = css.getPropertyValue(value >= 96 ? '--signal-high' : '--signal')
    g.lineWidth = 1.4
    g.stroke()
  }, [history, value])
  return <canvas ref={ref} className="trace" aria-hidden="true" />
}

function Sound() {
  const { audio } = useEntity()
  const set = (patch) => entityStore.set({ audio: { ...entityStore.get().audio, ...patch } })
  const start = async () => {
    try {
      const ok = await soundscape.start()
      set({ started: ok, failed: !ok })
    } catch {
      set({ failed: true })
    }
  }
  if (!audio.started)
    return (
      <div className="sound">
        <button className="sound-start" onClick={start}>
          <span className="dot" aria-hidden="true" /> Listen to the city
        </button>
        {audio.failed && <span className="sound-note">This browser would not start the sound.</span>}
      </div>
    )
  return (
    <div className="sound">
      <button
        className="sound-mute"
        onClick={() => {
          soundscape.setMuted(!audio.muted)
          set({ muted: !audio.muted })
        }}
        aria-pressed={audio.muted}
      >
        {audio.muted ? 'Sound off' : 'Sound on'}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={audio.volume}
        aria-label="Volume"
        onChange={(e) => {
          const v = Number(e.target.value)
          soundscape.setVolume(v)
          set({ volume: v })
        }}
      />
    </div>
  )
}

export default function Panel() {
  const s = useEntity()
  const [now, setNow] = useState(Date.now())
  const [intro, setIntro] = useState(true)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const value = Math.round(s.suspicion)
  const lit = Math.round((s.suspicion / 100) * SEGMENTS)
  const readout = READOUT.find(([min]) => s.suspicion >= min)[1]
  const state = s.falling && s.level !== 'confirmed' && s.suspicion < 30 ? 'The city is losing track of you.' : s.level === 'calm' && s.memory ? 'The city has settled, but it remembers you.' : STATE[s.level]
  const event = s.event && now - s.event.at < EVENT_SHOWN_MS ? s.event : null

  return (
    <>
      <div className={`vignette level-${s.level}`} style={{ opacity: Math.min(1, s.suspicion / 110) }} aria-hidden="true" />
      <Reticle dwell={s.dwell} level={s.level} />
      <aside className={`panel level-${s.level}`} aria-label="Field instrument">
        <header>
          <p className="kicker">Field instrument · Weimar</p>
          <h1>Nature Reclaims Weimar</h1>
          <p className="subtitle">100 years after humanity</p>
          {intro && (
            <p className="intro">
              Humanity disappeared a century ago. Nature reclaimed the city. The silence was complete — until something began to watch.
              <button className="link" onClick={() => setIntro(false)}>
                Hide
              </button>
            </p>
          )}
        </header>

        <section className="meter" aria-live="polite">
          <div className="meter-head">
            <span className="label">{s.suspicion >= 96 ? 'Human presence confirmed' : 'Human presence detected'}</span>
            <span className="value">{String(value).padStart(2, '0')}</span>
          </div>
          <div className="segments" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label="Human presence">
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <span key={i} className={i < lit ? 'on' : ''} />
            ))}
          </div>
          <Trace history={s.history} value={s.suspicion} />
          <p className="readout">{readout}</p>
        </section>

        <section className="status">
          <p className="state">{state}</p>
          <p className="focus">
            {s.dwell > 1 ? (
              <>
                Observing {s.focusLabel} · <span className="num">{Math.floor(s.dwell)} s</span>
              </>
            ) : (
              <>Looking at {s.focusLabel || 'the city'}</>
            )}
          </p>
          <p className={`event ${event ? 'show' : ''}`} key={event?.at}>
            {event ? event.text : ' '}
          </p>
        </section>

        <footer>
          <Sound />
          <p className="hint">Drag to orbit · right-drag to pan · scroll to zoom</p>
        </footer>
      </aside>
    </>
  )
}

// A faint ring at the centre of the view, filling as one place is observed for ten seconds.
function Reticle({ dwell, level }) {
  const p = Math.min(dwell / 10, 1)
  const r = 13
  const c = 2 * Math.PI * r
  return (
    <svg className={`reticle level-${level}`} width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r={r} className="track" />
      <circle cx="20" cy="20" r={r} className="fill" strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform="rotate(-90 20 20)" />
      <circle cx="20" cy="20" r="1.4" className="pip" />
    </svg>
  )
}
