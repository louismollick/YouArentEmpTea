const Constants = require('../shared/constants.js');

function tformula(tx,ty,tw=Constants.SIZE.tw){ return tx + (ty*tw)} // tile to array index
function floor_p2t(p){ return Math.floor(p/Constants.TILE);} // point to tile, for click
function round_p2t(p){ return Math.round(p/Constants.TILE);} // point to tile, for block drop

function Game(build,id,name,authorid,secret,map){
	this.id = id;
	this.build = build;
	this.mapname = name;
	this.authorid = authorid;
	this.secret = secret;
    this.map_data = map;
    this.messageQueue = [];

	this.count = 0;
	this.win = false;
	this.editing = null;

	// Pointer to current room of map (editing this edits data). First room is blank, until player wins
	if(!this.build) this.map = Constants.BLANK_ROOM0;
    else this.map = this.map_data[this.count];
}

Game.prototype.getBlock = function (tx,ty) {return this.map[tformula(tx,ty)];}
Game.prototype.getBlockInfo = function(tx,ty){
    let t = this.getBlock(tx,ty);
    if (typeof t === 'object' && t !== null) return Constants.BLOCK_INFO[t.id];
    return Constants.BLOCK_INFO[t];
}

Game.prototype.onClick = function(mx,my,b){
    let x = floor_p2t(mx);
    let y = floor_p2t(my);
    let tile = this.getBlockInfo(x,y);
    
    // If no block there, add block, or deselect
    if (!tile.id) {
        this.placeBlock(x,y,b);
        this.editing = {x:x,y:y};
    }
    
    // Otherwise check if editable, then select it. But deselect if already selected
    else if (tile.edit){
        if (this.editing && x == this.editing.x && y == this.editing.y) this.editing = null;
        else this.editing = {x:x,y:y};
    }
}

Game.prototype.onInteract = function(player){
    let binfo = this.getBlockInfo(round_p2t(player.loc.x),round_p2t(player.loc.y));

    // Place block (is the square void?)
    if(player.holding && !binfo.id){
        this.placeBlock(round_p2t(player.loc.x),round_p2t(player.loc.y), player.holding);
        player.holding = null;
    }
    // Pick up block
    else if (!player.holding && binfo.pickup){
        player.holding = this.getBlock(round_p2t(player.loc.x),round_p2t(player.loc.y));
        this.placeBlock(round_p2t(player.loc.x),round_p2t(player.loc.y), Constants.BLOCK_NAMES.VOID);
    }
    // Talk to NPC
    else if (binfo.talk && !binfo.pickup){
        let b = this.getBlock(round_p2t(player.loc.x),round_p2t(player.loc.y));
        let m = b.message;
        if(b.id == Constants.BLOCK_NAMES.AUTHOR && player.holding){
            if(player.holding.type == this.secret[this.count]){
                this.secret[this.count] = null;
                player.holding = null;
                m = "AYAYA";
                // Win check!!!
                if(this.secret.every((val,i,arr) => val===arr[0])){
                    this.messageQueue.push("YOU WIN, go back to your home you stupid bitch");
                    this.win = true;
                }
            } else{
                m = "NOT TODAY BOYO HEHE";
            }
        }
        if(m != ""){
            this.messageQueue.unshift(m); // unshift to put in front of win message
            player.immobilize(); // Stop player input state
        }
    }
}

Game.prototype.placeBlock = function(x,y,b){
    let tile = this.getBlockInfo(x,y);
    if(tile.remove) this.map[tformula(x,y)] = b;
}

Game.prototype.deleteBlock = function(){
    if(this.getBlockInfo(this.editing.x,this.editing.y).remove){
        this.map[tformula(this.editing.x,this.editing.y)] = Constants.BLOCK_NAMES.VOID;
        this.editing = null;
    }
}

Game.prototype.roomChange = function(player, dir){
    if((dir == "left" || dir == "right")&&((this.count==0 && dir=="right") || 0<this.count<3 || (this.count==3 && dir=="left"))){
        // Get direction, change room count
        if(dir == "left" && this.count) this.count--; 
        else if(dir == "right" && this.count<3) this.count++;

        // Update current map from map data -- if player hasnt won, make first room empty
        if(this.count === 0 && !(this.build || this.win)){
            this.map = Constants.BLANK_ROOM0;
        } 
        else this.map = this.map_data[this.count];

        // Remove editing
        this.editing = null;

        player.spawn(dir); // Respawn character at door entrance
    }
}

Game.prototype.editSecret = function(data){
    this.secret[this.count] = data;
}

Game.prototype.editBlockAttribute = function(att,data){
    let b = this.getBlock(this.editing.x,this.editing.y);
	if (b.hasOwnProperty(att)) b[att] = data;
}

Game.prototype.updatePlayer = function (dt, player){
    // Update velocity from player input
    if (player.left && player.vel.x > -Constants.LIMITS.x) player.vel.x -= Constants.SPEEDS.left;
    if (player.up && player.can_jump && player.vel.y > -Constants.LIMITS.y) player.vel.y -= Constants.SPEEDS.jump;
    if (player.right && player.vel.x < Constants.LIMITS.x) player.vel.x += Constants.SPEEDS.left;
    
    // Update player movement 
    player.vel.y += Constants.SPEEDS.gravity; // gravity
    player.vel.x *= .83; // friction

    player.vel.x = Math.min(Math.max(player.vel.x, -Constants.LIMITS.x), Constants.LIMITS.x); // Cap velocities
    player.vel.y = Math.min(Math.max(player.vel.y, -Constants.LIMITS.y), Constants.LIMITS.y);

    player.loc.x += dt*player.vel.x; // Update location
    player.loc.y += dt*player.vel.y;

    // Get tile locations of all probe points on player object
    let left = Math.floor((player.loc.x)/Constants.TILE);
    let leftYcol = Math.floor((player.loc.x + player.size.w/4)/Constants.TILE);
    let right = Math.floor((player.loc.x + player.size.w)/Constants.TILE);
    let rightYcol = Math.floor((player.loc.x + player.size.w*3/4)/Constants.TILE);
    let up = Math.floor((player.loc.y)/Constants.TILE);
    let upXcol = Math.floor((player.loc.y + player.size.h/4)/Constants.TILE);
    let down = Math.floor((player.loc.y + player.size.h)/Constants.TILE);
    let downXcol = Math.floor((player.loc.y + player.size.h*3/4)/Constants.TILE);

    // Get block type of each block touching a probe point (see diagram in readme)
    let bTopLeft    = this.getBlockInfo(leftYcol, up);
    let bTopRight   = this.getBlockInfo(rightYcol, up);
    let bDownLeft = this.getBlockInfo(leftYcol, down);
    let bDownRight = this.getBlockInfo(rightYcol, down);
    let bLeftUp   = this.getBlockInfo(left, upXcol);
    let bLeftDown   = this.getBlockInfo(left, downXcol);
    let bRightUp  = this.getBlockInfo(right, upXcol);
    let bRightDown  = this.getBlockInfo(right, downXcol);

    // Save variables for later
    let floorleft = bDownLeft;
    let floorright = bDownRight;

    if (bLeftUp.solid || bLeftDown.solid || bRightUp.solid || bRightDown.solid) {
        // Resolve X collision
        while (bLeftUp.solid || bLeftDown.solid){
            player.loc.x += 0.1;
            left = Math.floor(player.loc.x/Constants.TILE);
            bLeftUp = this.getBlockInfo(left, upXcol);
            bLeftDown = this.getBlockInfo(left, downXcol);
        }

        while (bRightUp.solid || bRightDown.solid){
            player.loc.x -= 0.1;
            right = Math.floor((player.loc.x+player.size.w)/Constants.TILE);
            bRightUp  = this.getBlockInfo(right, upXcol);
            bRightDown  = this.getBlockInfo(right, downXcol);
        }

        leftYcol = Math.floor((player.loc.x + player.size.w/4)/Constants.TILE);
        rightYcol = Math.floor((player.loc.x + player.size.w*3/4)/Constants.TILE);

        player.vel.x = 0;
    }
    
    if (bTopLeft.solid || bTopRight.solid || bDownLeft.solid || bDownRight.solid) {
        // Resolve Y collision
        while (bTopLeft.solid || bTopRight.solid){
            player.loc.y += 0.1;
            up = Math.floor((player.loc.y)/Constants.TILE);
            bTopLeft    = this.getBlockInfo(leftYcol, up);
            bTopRight   = this.getBlockInfo(rightYcol, up);
        }
        while (bDownLeft.solid || bDownRight.solid){
            player.loc.y -= 0.1;
            down = Math.floor((player.loc.y+player.size.h)/Constants.TILE);
            bDownLeft = this.getBlockInfo(leftYcol, down);
            bDownRight = this.getBlockInfo(rightYcol, down);
        }
        player.vel.y = 0;
    }

    // Resolve jumping
    if (floorleft.solid || floorright.solid) player.can_jump = true;
    else player.can_jump = false;

    // On collision, assume it's a door REEEEEEE
    if((bLeftDown.id == Constants.BLOCK_NAMES.DOOR || bRightDown.id == Constants.BLOCK_NAMES.DOOR) 
        && player.last_tile != Constants.BLOCK_NAMES.DOOR){
        if(bLeftDown.id == Constants.BLOCK_NAMES.DOOR) this.roomChange(player,"left");
        else if (bRightDown.id == Constants.BLOCK_NAMES.DOOR) this.roomChange(player,"right");
        player.last_tile = Constants.BLOCK_NAMES.DOOR;
    }
    else player.last_tile = Constants.BLOCK_NAMES.VOID;
}

module.exports = Game;