import { useEffect, useMemo, useState } from 'react'
import City from './City.jsx'
import Panel from './Panel.jsx'
import { prepare } from './reach.js'
import { buildNature } from './nature.js'

const FILES = { kit: 'kit.json', buildings: 'buildings.geojson', graph: 'streets.graph.json', zensus: 'zensus.geojson', plots: 'plots.geojson' }

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

  useEffect(() => {
    loadKit().then(setKit, (e) => setError(e.message))
  }, [])

  const data = useMemo(() => kit && prepare(kit), [kit])
  const nature = useMemo(() => data && buildNature(data, kit.plots), [data, kit])

  return (
    <div className="app">
      {data ? <City data={data} nature={nature} /> : <p className="loading">{error ? `The city kit didn't load (${error}).` : 'The city is growing…'}</p>}
      {data && <Panel />}
      <footer className="attribution">{ATTRIBUTION}</footer>
    </div>
  )
}
