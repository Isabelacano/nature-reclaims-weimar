// Facades: the plaster tones of Weimar's streets, stone for public buildings, tile and slate roofs.
export const FACADE = {
  plaster: ['#efe9dc', '#e9ddc6', '#e6d2b0', '#ddd9cf', '#ecdfd5', '#dccbb0', '#f3f0e8', '#e4cdbd', '#d9d3c4'],
  stone: ['#ddd5c4', '#d2c9b6'],
  roofs: ['#9d6a58', '#8f6152', '#a77967', '#6b6e73', '#7a7873'],
  glass: '#46505b',
  frame: '#f4f1ea',
}

// Ground floors with shop windows.
export const SHOP_USES = ['retail', 'food_and_drink', 'entertainment', 'service', 'office', 'accommodation']
// Public buildings in stone.
export const STONE_USES = ['civic', 'culture', 'education', 'health']

// One accent, three shades: darkest for 5 minutes, lightest for 15.
export const REACH_COLORS = ['#2a5aa8', '#6b93d6', '#b4caee']

export const BACKGROUND = '#f6f4ef'
export const GROUND = '#efece5'
export const STREET = '#8d8a83'

// One coherent green family for everything that grows, from pale ground cover to dark crowns.
export const NATURE = {
  cover: ['#d6e1bd', '#c8d9a9', '#a9c58a'], // ground cover, light to dense
  mass: ['#adc98c', '#93b876', '#7aa462', '#638f52'], // height bands of the masses, low to high
  trees: ['#3f6d3d', '#4a7a42', '#35603a'],
  trunk: '#7a7465',
  moss: '#97a77a',
  ivy: '#6f9658',
  roof: '#8fb06e',
}

// Streets: a schematic pavement, darker carriageway, lighter sidewalks, fine kerb lines.
export const STREETS = {
  road: '#cbc7bf',
  sidewalk: '#dfdbd3',
  kerb: '#a9a59d',
  edge: '#c6c2b9',
  weeds: '#a3b884',
}

// Year 100: a darker, stranger green, bleached buildings, and the new inhabitants.
export const WILD = {
  sky: '#dde1d6',
  cover: '#7f9b6c',
  mass: ['#6a8a5a', '#4f714b', '#3a5b3d', '#284431'],
  bleached: '#d8d6cf',
  giantCrown: ['#2c4b34', '#365a3c', '#25412e'],
  giantTrunk: '#4a433a',
  root: '#51493e',
  rootMoss: '#6c8152',
  mushroomStem: '#ebe6d8',
  mushroomCap: '#a8745a',
  deer: '#8b6b4e',
  boar: '#3f3833',
  fox: '#b0693a',
}
