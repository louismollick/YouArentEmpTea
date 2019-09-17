const Constants = require('../shared/constants.js');

function Player(){
	this.size = {w: Constants.TILE/2, h: Constants.TILE};
	this.loc = {x: (Constants.SIZE.tw-8)*Constants.TILE, y: (Constants.SIZE.th-2)*Constants.TILE};
	this.vel    = { x: 0, y: 0};
	this.left     = false;
	this.right    = false;
	this.up       = false;
	this.can_jump = true;
	this.jump_switch = 0;
	this.last_tile = null;
	this.holding = null;
}

Player.prototype.getRenderPack = function(){
    return {...this.loc, ...this.size, 'holding': this.holding};
}

Player.prototype.spawn = function(door){
    if (door === "left") this.loc = { x: (Constants.SIZE.tw-1)*Constants.TILE-this.size.w-1, y: (Constants.SIZE.th-2)*Constants.TILE};
    else if (door === "right") this.loc = { x: Constants.TILE+1, y: (Constants.SIZE.th-2)*Constants.TILE};
}

Player.prototype.immobilize = function(){
    this.left = false;
    this.right = false;
    this.up = false;
    this.vel = {x:0, y:0};
}

module.exports = Player;