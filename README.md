# Nature Reclaims Weimar: the city that notices you

An interactive 3D exploration of central Weimar (about 1.3 × 2 km, west of and including the Markt) a hundred years after humanity disappeared. Nature has taken the city and believes it is alone. The longer you look at one place, the more the city realises that it is not.

Orbit, pan and zoom with the mouse. There is no timeline: the world is always year 100. The old timeline is kept in git, on the branch `slider-version`.

## The world

- **The city** keeps its streets, blocks and buildings from the data: every building extruded from its footprint to its measured height, with one row of windows per floor, shop fronts on the ground floor of shops and cafés, plaster tones of Weimar and stone for public buildings.
- **A century of weather.** Facades are faded, streaked by rain below sills and roof edges, darkened by damp rising from the ground, cracked in places and patched with moss. The empty windows are dark openings. Each building ages differently: about a quarter kept their facades, about a quarter are being consumed, with ivy, curtains of leafy vines hanging from their cornices and green roofs; shrubs grow at the foot of many others.
- **Vegetation.** Ground cover over almost all open ground, weeds and green through the cracked pavement, continuous canopy masses in courtyards and open spaces (their slopes limited so every edge is a continuous bank, with no holes or slivers), about 1,100 trees in courtyards, close to facades and in some streets (six tree types with branching limbs and uneven crowns, leaning away from the walls), and sixteen giant trees of 95–145 m with buttressed trunks and stacked canopies.
- **Roots** flare from the giants and the trees, knotted and flattened on the ground, dipping into the soil, forking, sliding along walls and in places climbing them.
- **Inhabitants.** Oversized mushrooms in the giants' shade, deer in clearings, boars and foxes on the former streets.
- **Around it.** A forest that reaches into the edge of the city and continues to wooded hills on the horizon, old field strips faintly visible as meadows, a sky with drifting clouds, haze, a low sun and shadows.

Everything that sways (trees, giants, growth) moves in a light wind.

## The entity

Nature behaves as one territorial being. It works in a loop of four steps, a few times a second, entirely in the browser. There is no AI service and no key: it is local logic in `src/entity/`.

1. **Perception** (`perception.js`). What the centre of the view rests on: a building or the ground, found by marching along the view ray through the building map. An observation continues as long as you keep looking at the same place, also when you orbit around it (the point you orbit around counts as well), and survives a glance away of up to 2.5 seconds. Looking at the sky or at the forest outside the city is not looking at the entity's ground.
2. **Evaluation** (`mind.js`). The human presence meter, 0–100. After about 10 seconds of observing one place it starts to rise, faster when you look closely and much faster when you watch the very place where the entity just acted. When you look away it falls steadily. After a confirmed encounter it never quite returns to zero, and rises faster the next time: it remembers.
3. **Decision** (`mind.js`). From time to time, more often as the meter rises, it picks a reaction by weighted chance: never the same twice in a row, each with its own cooldown, some only possible when you look at a building, the evasive ones more likely once it remembers you. At high awareness it sometimes combines two.
4. **Action** (`body.js`). The reaction happens in the world, at the place you look:
   - **Stirring**: the leaves near the observed place shiver.
   - **Stillness**: wind stops around the observed place; the air in the music goes quiet.
   - **Retreat**: vines pull back down the facade, the canopy sinks, trees lean away.
   - **Concealment**: ivy climbs over the facade that faces you and curtains of vines pour down it; at high suspicion over the neighbouring buildings too.
   - **Expansion**: a burst of leafy shrubs around the observed place.
   - **Diversion**: roots grow around a building 200–750 m away, preferably one you can see, and the trees there stir.
   - **Evasion**: the observed place goes still while the activity moves several hundred metres away.

   Every reaction grows stronger as the meter rises: at 100 its area and the amount of growth are almost three times what they are at the start.

   **The upheaval.** Above about 25 the land itself begins to rise around the place you watch, slowly at first and then faster and faster. It is one smooth surface, up to about 25 m high at its centre and up to 800 m across, carrying the canopy, the trees and new shrubs up with it, closing over the streets and burying the buildings until only their roofs show. Great roots rise out of the ground around the sixteen nearest buildings, the closest first, climb their walls, wrap around them and close over the roofs; the buildings darken and green over. A low rumble joins the music. When you look away, the land settles back over about half a minute and the roots withdraw.

   Above 96 the city **recognises** you: a wave runs outward from where you look, every tree leans toward you, the empty windows glow faintly as the wave passes, the air darkens, and a distinct sound plays. This happens once per crossing; the meter must fall below 40 before it can happen again.

The effects come from a fixed set of shader fields (one per kind of effect, and one for the upheaval) and fixed pools of 700 shrubs and 450 vine curtains, reused oldest first; diversion keeps its last three sets of roots, the upheaval one set. So nothing accumulates, however long you watch.

The panel only reports what really happened: the state follows the meter, and each event line is written by the reaction that has just been carried out, including the real direction ("a building to the north-east") and the side of the building facing you ("the western facade").

## Sound

The music is generated in the browser with the Web Audio API (`src/audio/soundscape.js`); there are no audio files. A low drone and wind in the leaves are always there, and a deep rumble while the ground rises; a soft chord, sparse falling notes, beating high tones and a slow double pulse join as the meter rises, and the notes turn more dissonant. Reactions add a rustle from their side of the view. The recognition is a low double pulse with a resonant swell; the music dips under it but keeps playing.

Browsers only allow sound after a click: press **Listen to the city** in the panel. Then mute or set the volume there; the entity carries on either way.

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
```

Drag with the left mouse button to orbit, with the right button to pan, and scroll to zoom. Hold the view on one building for a while to meet the entity. GitHub Pages publishes the app on every push to `main` (see `.github/workflows/`).

## How the world is made

One growth map is computed once when the page loads: every 2 m of ground gets a value for how readily nature takes it, from the land use in `plots.geojson`, the distance to buildings and streets, and fixed noise for organic shapes (`src/nature.js`). The year 100 world is a threshold on that map. Trees, giants, roots, mushrooms and animals are placed from it deterministically, so the city looks the same every time; only the entity's choices vary.

Code: `src/App.jsx` loads the data, `src/City.jsx` builds the scene, `src/Nature.jsx` ground, masses, streets, roots and facades, `src/Trees.jsx` trees, giants and the entity's growth, `src/Environment.jsx` sky, terrain, forest and light, `src/shaders.js` the shared shader pieces, `src/entity/` the entity, `src/Panel.jsx` the interface.

`src/reach.js` is left from the project's start as a walking-reach tool; the app uses its map projection and street outlines.

## Limits

- The narration is fiction, and the vegetation is designed, not simulated: it is placed to look a century old, not grown by an ecological model.
- The canopy masses are a height field on a 6 m grid. They slope down into the walls rather than meeting them exactly, where the grid cannot follow a wall.
- The risen land covers mushrooms and animals instead of lifting them, and the trees it lifts still cast their shadows from where they stood.
- The entity only knows where the camera looks, not what you see: a building hidden behind a giant tree's crown still counts as observed.
- The model covers only the kit area; the surrounding forest and hills are invented.

## Data and credit

All data is in `public/data/`; `SOURCES.md` there lists every file, its source, licence and fields.

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).

## How this was made

1. Tools: Claude Code, with the model Claude Opus 5.5.
2. I decided:
3. The agent did: read the city kit, then wrote the 3D view, the walking and resident calculation, the "nature reclaims the city" timeline, and later replaced the timeline with a permanent year 100 world, its landscape, vegetation and facades, the entity that notices the observer, its music and its panel, and this README, and checked each step in screenshots and test runs in the browser.
4. I checked:
