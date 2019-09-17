const c = {};
c.BLOCK_NAMES = { VOID: 0, DOOR: 1, BEDROCK: 2, AUTHOR:3, PLATFORM: 4, NPC: 5, KEY: 6},
c.BLOCK_INFO = [
    {id: c.BLOCK_NAMES.VOID, solid:0, remove:1},
    {id: c.BLOCK_NAMES.DOOR, solid:0},
    {id: c.BLOCK_NAMES.BEDROCK, solid: 1},
    {id: c.BLOCK_NAMES.AUTHOR, solid: 0, edit:1, remove: 0, talk:1},
    {id: c.BLOCK_NAMES.PLATFORM, solid: 1, edit:1, remove: 1},
    {id: c.BLOCK_NAMES.NPC, solid: 0, edit:1, remove: 1, talk:1},
    {id: c.BLOCK_NAMES.KEY, solid: 0, edit:1, remove: 1, pickup: 1},
];
c.BLANK_ROOM0 = [ 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2 ],
c.SIZE = {tw: 19, th: 8},
c.TILE = 10,
c.LIMITS = {
    x: 40,
    y: 160,
},
c.SPEEDS = {
    gravity: 3,
    jump: 90,
    left: 8,
    right: 8,
};

module.exports = Object.freeze(c);