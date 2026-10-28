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

// The world a century on: earthy greens, deep foliage, weathered stone, muted browns.
export const GROUND = {
  bare: '#8b8573', // dusty, broken ground where nothing has taken hold yet
  floor: '#4c5639', // forest floor around and beyond the city
}

export const NATURE = {
  cover: ['#7d9365', '#6f8a5a', '#5b7449'], // ground cover, light to dense
  trunk: '#5a5044',
  moss: '#6f7d4f',
  ivy: '#4f6a3a',
  roof: '#6c8450',
  // Crowns of the city's trees: three families, each with a light and a dark tone.
  crowns: [
    ['#4d6b3a', '#2f4a2a'],
    ['#5c7442', '#36502e'],
    ['#42603f', '#263f2b'],
    ['#66773f', '#3d4d2a'],
  ],
  bark: ['#4f463c', '#5d5246', '#433d36'],
}

// Streets: weathered cobbles and asphalt, kerbs, weeds in the cracks.
export const STREETS = {
  road: '#8a867c',
  sidewalk: '#9d988a',
  kerb: '#6f6b62',
  edge: '#858073',
  weeds: '#677e4c',
}

// Year 100: the deep green of the masses, weathered buildings, and the new inhabitants.
export const WILD = {
  cover: '#5f7650',
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

// Sky and haze. `aware` is the tint the air takes on as the city notices the observer.
export const ATMOSPHERE = {
  horizon: '#aab1a0',
  zenith: '#687a82',
  sun: '#f1e3c2',
  cloud: '#d9dccf',
  cloudShade: '#8d968c',
  awareHorizon: '#9aa07e',
  awareZenith: '#4f5f58',
  hills: '#3e4a34',
  forest: ['#33452d', '#2b3c29', '#3d4f31', '#26352a'],
}
