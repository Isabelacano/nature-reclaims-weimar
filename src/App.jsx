import { useEffect, useMemo, useState } from 'react'
import City from './City.jsx'
import { prepare } from './reach.js'
import { STAGES, buildNature } from './nature.js'

const FILES = { kit: 'kit.json', buildings: 'buildings.geojson', graph: 'streets.graph.json', zensus: 'zensus.geojson', plots: 'plots.geojson' }

// Open a stage directly with ?year=25 in the address.
function initialStage() {
  const year = Number(new URLSearchParams(window.location.search).get('year'))
  return Math.max(0, STAGES.findIndex((s) => s.year === year))
}

const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

async function loadKit() {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, file]) => {
      const r = await fetch(`${import.meta.env.BASE_URL}data/${file}`)
      if (!r.ok) throw new Error(`data/${file}: ${r.status}`)
      return [key, await r.json()]
    }),
  )
  return Object.fromEntries(entries)
}

export default function App() {
  const [kit, setKit] = useState(null)
  const [error, setError] = useState(null)
  const [stage, setStage] = useState(initialStage)

  useEffect(() => {
    loadKit().then(setKit, (e) => setError(e.message))
  }, [])

  const data = useMemo(() => kit && prepare(kit), [kit])
  const nature = useMemo(() => data && buildNature(data, kit.plots), [data, kit])

  return (
    <div className="app">
      {data ? (
        <City data={data} nature={nature} size={kit.kit.size_m} stage={stage} />
      ) : (
        <p className="loading">{error ? `The city kit didn't load (${error}).` : 'Loading the city kit…'}</p>
      )}

      <section className="timeline" aria-label="Timeline">
        <h1 className="project-title">WEIMAR: NATURE RECLAIMS THE CITY</h1>
        <p className="subtitle">An interactive exploration of Weimar’s transformation after human disappearance, as nature gradually overtakes the built environment.</p>
        <div className="timeline-head">
          <span className="year">Year {STAGES[stage].year}</span>
          <span className="stage-title">{STAGES[stage].title}</span>
        </div>
        <input type="range" min={0} max={STAGES.length - 1} step={1} value={stage} onChange={(e) => setStage(Number(e.target.value))} aria-label="Years after people leave" />
        <div className="ticks">
          {STAGES.map((s, i) => (
            <button key={s.year} className={i === stage ? 'on' : ''} onClick={() => setStage(i)}>
              {s.year}
            </button>
          ))}
        </div>
        <p className="caption">{STAGES[stage].caption}</p>
      </section>

      <footer className="attribution">{ATTRIBUTION}</footer>
    </div>
  )
}
