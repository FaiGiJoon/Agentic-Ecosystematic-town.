// What Goldenrod says in Agent HQ. Same shape as the portfolio's content (start, intro,
// buildings, signs, npcs) so the copied engine runs it unchanged. Text uses only
// characters the Crystal font has.

const closed = (name) => ({ name, kind: 'closed' });

export default {
  title: 'AGENT HQ',
  start: { x: 22, y: 19, facing: 'up' },

  intro: [
    'Welcome to AGENT HQ!',
    'Tickets live in the POKéMON CENTER. CLAUDE works at the RADIO TOWER.',
  ],

  // Door tiles ("x,y"). Only two doors open; the rest are shut.
  buildings: {
    '15,27': { name: 'POKéMON CENTER', kind: 'board' },
    '5,15': { name: 'RADIO TOWER', kind: 'desk' },
    '24,7': closed('GOLDENROD GYM'),
    '9,13': closed('MAGNET TRAIN STATION'),
    '24,27': closed('GOLDENROD DEPT. STORE'),
    '14,21': closed('GAME CORNER'),
    '15,7': closed('NAME RATER'),
    '5,25': closed("BILL'S FAMILY'S HOUSE"),
    '31,21': closed('HAPPINESS RATER'),
    '29,29': closed('BIKE SHOP'),
    '29,5': closed('FLOWER SHOP'),
    '33,9': closed('POKéMON FAN CLUB'),
    '19,1': closed('ROUTE 35 GATE'),
    '9,5': closed('UNDERGROUND'),
    '11,29': closed('UNDERGROUND'),
  },

  signs: {
    '16,27': 'Walk in to add a ticket.',
    '4,17': 'RADIO TOWER. CLAUDE works here.',
    '22,18': 'AGENT HQ. Tickets in, answers out.',
  },

  // CLAUDE idles near home (its wander box never reaches a door-front tile); the browser sets `busy` while it walks between buildings.
  npcs: [
    { id: 'claude', name: 'CLAUDE', x: 18, y: 29, sprite: 'ELM', wander: [2, 1],
      text: 'CLAUDE: Hi! Add a ticket at the POKéMON CENTER.' },
  ],

  // Floor tiles beside the tile in front of each door, where CLAUDE stands facing the
  // building. The door-front tiles themselves (15,28 and 5,16) stay free for the player.
  spots: { board: { x: 16, y: 28 }, desk: { x: 6, y: 16 } },
};
