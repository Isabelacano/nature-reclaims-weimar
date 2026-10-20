# Weimar: nature reclaims the city

A schematic 3D model of central Weimar (about 1.3 × 2 km, west of and including the Markt) and a timeline that shows the city 0, 5, 10, 25, 50 and 100 years after people leave. The only interface is the timeline; orbit, pan and zoom with the mouse.

The project started as a walking-reach tool (how far you can walk in 5, 10 and 15 minutes, and how many people live there). Its panel and the land-use legend have been removed and clicking no longer starts a walk, but the calculation is still in `src/reach.js` and described under "Method" below.

## Nature reclaims the city

A timeline at the top left shows the same city 0, 5, 10, 25, 50 and 100 years after people leave. Year 0 is the city as it is. Then:

- **Ground cover** spreads from parks, gardens, courtyards and street verges across the open ground, and later into the streets.
- **Vegetation masses** rise as one continuous, faceted surface, coloured in height bands like contours. They grow taller in open ground, stay lower in narrow courtyards, and heap up against the buildings without rising above their roofs.
- **A few trees**, about a hundred, stand out of the tallest masses from year 10 on.
- **Facades.** Each building has a plaster tone typical of Weimar (stone for public buildings), a darker plinth and cornice, and one row of windows per floor, using the floor count in the data, spaced evenly between the corners of every wall. Shops, cafés and offices have shop windows on the ground floor; roofs are tile or slate. The facades are painted in the buildings' existing material, without extra geometry, and blend to an even tone far away so they don't flicker. With the years the panes break and darken; in year 100 they are empty dark openings in bleached walls.
- **Buildings** keep their shape but fade to a darker, desaturated grey, gather stains and moss, and, on a selection of them, ivy climbs the walls and green spreads across the roof.
- **Streets** are drawn as a darker carriageway (6.4 m) with lighter sidewalks on both sides and fine kerb lines, along the existing network. Weeds appear in the cracks first, then the green takes the pavement over. By year 50 about 40 % of the street surface is green, so the network stays partly legible.
- **Year 100, a new ecosystem** is a different world, not just more of year 50: sixteen giant trees, 95–145 m tall, with stacked flat canopies, tower over the bleached, pale building blocks; thick roots spread from them across the streets and slide along building walls; dark green masses swell over whole blocks and engulf parts of buildings; oversized mushrooms grow in the giants' shade; deer stand in clearings and boars and foxes walk the former streets. The sky turns a pale, hazy green. Animals are close to life size, so zoom in to find them.

This is a designed sequence, not a growth simulation. One growth map is computed once when the page loads: every 2 m of ground gets a value for how early nature takes it, from the land use in `plots.geojson`, the distance to buildings and streets, and fixed noise for organic shapes. Each year is a threshold on that map, so the stages follow one another coherently and look the same every time. Add `?year=25` (or 0, 5, 10, 50, 100) to the address to open a stage directly.

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
```

Drag with the left mouse button to orbit, with the right button to pan, and scroll to zoom. GitHub Pages publishes the app on every push to `main` (see `.github/workflows/`).

## Method

- **Start.** The walk starts at the walkable node of `streets.graph.json` nearest to the click. If none is within 100 m, the app says so and draws nothing.
- **Walking.** Shortest paths along the walkable edges, using each edge's `length` in metres, at 4.8 km/h, which is 80 m per minute: 400 m in 5 minutes, 800 m in 10, 1200 m in 15. Edges can be walked both ways.
- **Areas.** Each area is the street segments reached in that time, including the reachable part of the last segment, with a band of 25 m on each side (rounded at the ends), joined into one shape. It is not a circle and not a convex hull, and can have holes, for example inside large blocks.
- **Buildings.** A building is counted and highlighted when its footprint touches the area. It is shaded in the colour of the smallest area it touches.
- **Residents.** From the 100 m cells of the Zensus 2022 grid: every cell that overlaps the area adds its population times the share of the cell's area that lies inside. The sum is rounded to the nearest 10.
- **Cells without a figure.** Where the census published no resident count (`population` is `null`), the cell is not zero. It is left out of the sum, and the panel shows how many such cells overlap the area.

## Limits

- The network is a drawing of the pedestrian network, not every path; walking time ignores slopes, crossings, traffic lights and doors.
- The 25 m band is a simple stand-in for "close to the street". A building set back further, or reached only through a courtyard, is missed.
- Residents are spread evenly over each 100 m cell, although in reality they live in the buildings. The census also changes small counts slightly at random to protect privacy, so the figures are approximate.
- The data covers only the kit area. Near its edges the walk stops where the network ends, so the counts there are too low.
- One building has no recorded use; it is shown as "use not known", like the buildings whose use is `undefined`.

## Data and credit

All data is in `public/data/`; `SOURCES.md` there lists every file, its source, licence and fields.

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).

## How this was made

1. Tools: Claude Code, with the model Claude Opus 5.5.
2. I decided:
3. The agent did: read the city kit, then wrote the 3D view, the walking and resident calculation, the "nature reclaims the city" timeline with its year 100 ecosystem and street surfaces, and this README, and checked each stage in screenshots and that it builds for localhost and GitHub Pages.
4. I checked:
