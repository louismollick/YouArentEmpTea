/*
	TODO:
	- Deal with idling : 
	https://stackoverflow.com/questions/48472977/how-to-catch-and-deal
	-with-websocket-is-already-in-closing-or-closed-state-in
*/

const express = require('express');
const fetch = require('node-fetch');
const url = require('url');
const FormData = require('form-data');

const mysql = require('mysql2');

const db = mysql.createPool({
	host: "localhost",
	user: "root",
	password: "",
	database : "youarentemptea",
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0
});

const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);

app.get('/',function(req, res) {
	if(req.query.code) res.sendFile(__dirname + '/client/redirect.html');
	else res.sendFile(__dirname + '/client/index.html');
});
app.use('/client', express.static(__dirname + '/client'));

server.listen(process.env.PORT || 2000);

async function getToken(socket, tokenKey, tokenType){
	console.log('');
	console.log('>>> Getting Token...');
	console.log(`Using ${tokenType} : ${tokenKey}`);
	try { // Use same function for authorization code and refresh token (tokenType)
		const data = new FormData();
		data.append('client_id', '580552424369160212');
		data.append('client_secret', '');
		data.append('redirect_uri', 'http://localhost:2000/');
		data.append('scope', 'identify');
		data.append(tokenType, tokenKey);
		if(tokenType == 'code') data.append('grant_type', 'authorization_code');
		else data.append('grant_type', 'refresh_token');

		// Use data with : code from authorization redirect OR refresh token, in order to obtain token
		const fetchtoken = await fetch('https://discordapp.com/api/oauth2/token', {method: 'POST', body: data,});
		const tokenjson = await fetchtoken.json();

		console.log('Code auth response', tokenjson);
		if(tokenjson.error == 'invalid_request'){
			console.log('Invalid code, redirecting...');
			socket.emit('redirect', '/'); // REEEEEEEEEEEE what about refresh code?
		}
		else {
			console.log('Good code, using token for login...');
			login(socket, tokenjson);}
	} catch (error){
		console.log(error);
	}
}

async function login(socket, token){
	console.log('');
	console.log('>>> Logging in...');
	try {
		// Use token to get user info
		const fetchinfo = await fetch('https://discordapp.com/api/users/@me', {
			headers: {Authorization: `Bearer ${token.access_token}`},
		});
		const info = await fetchinfo.json();

		console.log('Login info response', info);
		if(info.message == '401: Unauthorized'){
			console.log('Expired token, refreshing...');
			getToken(socket, token.refresh_token, 'refresh_token');
		}
		else{
			let user = {...token, ...info}; // Package for save

			// Remove unnecessary info
			['locale', 'mfa_enabled', 'flags', 'token_type', 'expires_in', 'scope'].forEach(e => delete user[e]);

			// Save to database, but if already there, only update what's necessary
			let sql = 'REPLACE INTO users SET ?';
			let query = db.query(sql, {...user}, (err, result) => {
				console.log(user);
				if(err) throw err;
				console.log(result);
			});
			
			// Remove more unnecessary info
			delete user['refresh_token'];

			// Check if player has any maps, get id
			let sql2 = 'SELECT id FROM maps WHERE authorid = ?';
			db.query(sql2, user.id, (err, result) => {
				if(err) throw err;
				
				// If new player with no maps (result[0] is undefined), insert new map (which generates a mapid)
				if(!result[0]){
					console.log('mapid is null, so creating new map...');

					let sql3 = `INSERT INTO maps (name,authorid) VALUES ("${socket.user.username}'s Tea Room",?);`;
					db.promise().query(sql3, user.id).then(() => {
						// Now get the new mapid which was just created
						let sql4 = 'SELECT id FROM maps WHERE authorid = ?';
						db.query(sql4, user.id, (err, result) => {
							if(err) throw err;
							console.log('Sending NEW created mapid: ', result[0]['id']); // REEEEE
							socket.emit('menu-insert-build-id', result[0]['id']);
						});
					});
				} else{
					console.log('Sending mapid : ', result[0]['id']);
					socket.emit('menu-insert-build-id', result[0]['id']);
				} 
			});
			// Send data to client, to save token to cookies
			console.log("Sending info pack to client...");
			socket.emit('menu-login', user);

			// Save data to client-side socket, for quick access 
			socket.user = user;
		}
	} catch (error) {
		console.log(error);
	}
}
//-------------------------------------------------------------------------
// SOCKET STUFF
//-------------------------------------------------------------------------
io.on('connection', function(socket){
	// Leave default room, we only want a socket to be in 1 at a time
	socket.leave(socket.id);

	console.log('########################')
	console.log('');
	console.log("New connection!", socket.id);

	// Get query code and cookies from client handshake
	const urlObj = url.parse(socket.handshake.headers.referer, true);
	const cookie = socket.handshake.headers.cookie;

	// If socket was redirected from Discord OAuth2
	if (urlObj.query.code) {
		console.log('... has code!');

		const accessCode = urlObj.query.code;
		getToken(socket, accessCode, 'code');
	}
	else if(cookie){ // Otherwise, if returning socket with cookie
		console.log('... has cookie!');
		console.log('');
		console.log('>>> Comparing cookie token...');

		let cookie_id = getCookie(cookie, 'id');
		let cookie_token = getCookie(cookie, 'token');
		console.log('Cookie token: ', cookie_token);

		if (cookie_token){
			// Access database and compare
			let sql = 'SELECT access_token, refresh_token FROM users WHERE id = ?';
			db.query(sql, cookie_id, (err, result) => {
				if(err) throw err;
				if (result[0]){
					console.log('Db token: ', result[0].access_token);
					if (result[0].access_token == cookie_token){
						// Try logging in with the current token (result[0] contains refresh 
						// token as well, in case current token is expired).
						console.log("Good cookie!")
						login(socket, result[0]);
					}
					else console.log("Wrong cookie!");
				} else console.log("Wrong cookie!");
			});
		} else console.log("Wrong cookie!");
	}

	socket.on('game-join-req', function(mapid){
		// Check if socket is logged in, and isn't already in a level
		if(socket.user && !Object.keys(socket.rooms)[0]){
			let build = false;

			console.log('');
			console.log(`>>> Retrieving ${mapid}...`);

			// Access database, get map
			let sql = 'SELECT * FROM maps WHERE id = ?';
			db.query(sql, mapid, (err, result) => {
				if(err) throw err;
				// Verify that result is something
				if(result[0]){
					socket.join(socket.id);
					// If authorid of map is same as socket id, player can edit map
					if (result[0]['authorid'] == socket.user.id){
						console.log('Build is active!');
						build = true;
					}
					// Create new room session and create game
					console.log('Creating session!');
					socket.player = new Player();
					io.sockets.adapter.rooms[socket.id].game = 
						new Game(build,mapid,result[0].name,result[0].authorid,JSON.parse(result[0].secret),JSON.parse(result[0].data));

					// Show client game view
					socket.emit('game-show-res', build);
				}
			});
		} else{ socket.emit('error', "There was an error joining that level.");}
	});

	socket.on('game-leave', function (){
		let levelid = Object.keys(socket.rooms)[0];
		// If socket is in level, leave
		if(levelid){
			socket.leave(levelid);
			socket.player = null; // Delete player object
		}
	});
	socket.on('menu-play-online-populate-req', function(){
		let sql = 'SELECT maps.id,maps.name,maps.authorid,users.username,users.avatar FROM maps INNER JOIN users ON maps.authorid=users.id WHERE maps.isplayer = 1;';
		db.query(sql, (err, result) => {
			if(err) throw err;
			console.log(result);
			socket.emit('menu-play-online-populate-res', result);
		});
	});
	socket.on('menu-play-campaign-populate-req', function(){
		let sql = 'SELECT maps.id, maps.name, maps.authorid FROM maps WHERE isplayer = 0;';
		db.query(sql, (err, result) => {
			if(err) throw err;
			console.log(result);
			socket.emit('menu-play-campaign-populate-res', result);
		});
	});
	socket.on('game-build-save', function(){
		let levelid = Object.keys(socket.rooms)[0];
		// If player is in level (if !0)
		if(levelid){
			let game = io.sockets.adapter.rooms[levelid].game; // Assign by REFERENCE
			// If the map is being edited
			if(game.build){
				// Save to database
				let sql = 'UPDATE maps SET data = ?,secret = ? WHERE id = ?';
				db.query(sql, [JSON.stringify(game.map_data),JSON.stringify(game.secret),game.id], (err, result) => {
					if(err) throw err;
					console.log(result);
				});
			}
		}
	});
	socket.on('game-build-room-change', function(data){
		let levelid = Object.keys(socket.rooms)[0];
		// If player is in level (if !0)
		if(levelid){
			let game = io.sockets.adapter.rooms[levelid].game; // Assign by REFERENCE
			if (game.build && (data == 'left' || data == 'right')) game.roomChange(socket.player, data);
		}
	});
	socket.on('game-edit-message', function(data){
		let levelid = Object.keys(socket.rooms)[0];
		// If player is in level (if !0)
		if(levelid){
			let game = io.sockets.adapter.rooms[levelid].game; // Assign by REFERENCE
			// If the edited block holds a message, edit that messages
			if(game.build && game.editing){
				let b = game.getBlock(game.editing.x,game.editing.y);
				if(b.hasOwnProperty('message')) b.message = data;
			}
		}
	});
	// DEALS WITH TYPES AND SECRET
	socket.on('game-edit-type', function(data){
		let levelid = Object.keys(socket.rooms)[0];
		// If player is in level (if !0)
		if(levelid){
			let game = io.sockets.adapter.rooms[levelid].game; // Assign by REFERENCE
			// If the edited block holds a type, edit that type
			if(game.build && game.editing){
				let b = game.getBlock(game.editing.x,game.editing.y);
				if(b.hasOwnProperty('type')) b.type = data; // REEEE type check pls
			}
		}
	});
	socket.on('game-edit-secret', function(data){
		let levelid = Object.keys(socket.rooms)[0];
		// If player is in level (if !0)
		if(levelid){
			let game = io.sockets.adapter.rooms[levelid].game; // Assign by REFERENCE
			// If the edited block holds a type, edit that type
			if(game.build && game.count) game.secret[game.count] = data;  // REEEE type check pls
		}
	});
	socket.on('game-build-delete', function(){
		let levelid = Object.keys(socket.rooms)[0];
		// If player is in level (if !0)
		if(levelid){
			let game = io.sockets.adapter.rooms[levelid].game; // Pointer to game object
			// If the game is in build mode and selected block can be removed, delete block
			if(game.build && game.editing && game.getBlockInfo(game.editing.x,game.editing.y).remove){
				game.map[tformula(game.editing.x,game.editing.y)] = BLOCK_NAMES.VOID;
				game.editing = null;
			} 
		}
	});

	socket.on('keyPress',function(data){
		let levelid = Object.keys(socket.rooms)[0];
		// If player is in level (if !0)
		if(levelid){
			// Create shortcut variables (pointers) to objects
			let player = socket.player; // Assign by REFERENCE (pointer)
			let game = io.sockets.adapter.rooms[levelid].game; // Assign by REFERENCE

			if(data.inputId === 'left') player.left = data.state;
			else if(data.inputId === 'right') player.right = data.state;
			else if(data.inputId === 'up') player.up = data.state;
			else if (data.inputId === 'interact' && data.state && !game.build){
				let binfo = game.getBlockInfo(round_p2t(player.loc.x),round_p2t(player.loc.y));

				// Place block (is the square void?)
				if(player.holding && !binfo.id){
					console.log(player.holding);
					game.placeBlock(round_p2t(player.loc.x),round_p2t(player.loc.y), player.holding);
					player.holding = null;
				}
				// Pick up block
				else if (!player.holding && binfo.pickup){
					player.holding = game.getBlock(round_p2t(player.loc.x),round_p2t(player.loc.y));
					game.placeBlock(round_p2t(player.loc.x),round_p2t(player.loc.y), BLOCK_NAMES.VOID);
				}
				// Talk to NPC
				else if (binfo.talk && !binfo.pickup){
					let b = game.getBlock(round_p2t(player.loc.x),round_p2t(player.loc.y));
					let m = b.message;
					let winflag = false;
					if(b.id == BLOCK_NAMES.AUTHOR && player.holding){
						if(player.holding.type == game.secret[game.count]){
							game.secret[game.count] = null;
							player.holding = null;
							m = "AYAYA";
							if(game.secret.every((val,i,arr) => val===arr[0])){
								console.log('yeee');
								winflag = true;
							}
						} else{
							m = "NOT TODAY BOYO HEHE";
						}
					}
					if(m != ""){
						socket.emit('alert', m);
						if(winflag){
							game.win = true;
							socket.emit('alert',"YOU WIN, go back to your home you stupid bitch");
						} 
						// Stop player input state
						player.left = false;
						player.right = false;
						player.up = false;
						player.vel = {x:0, y:0};
					}
				}
			}
			// If socket is building a level and clicks on canvas, add block
			else if (data.inputId === 'mouse' && game.build){
				game.onClick(floor_p2t(data.state.x), floor_p2t(data.state.y), data.state.b);
			}
		}
	});
});

io.on('disconnecting',function(socket){
	console.log("Socket leaving! ", socket.id);
});

//-------------------------------------------------------------------------
// UPDATE LOOP
//-------------------------------------------------------------------------

let lastUpdateTime = (new Date()).getTime();
// Starts game loop, which constantly emits 'update' to clients
setInterval(function() {
	let currentTime = (new Date()).getTime();
	let dt = (currentTime - lastUpdateTime)/1000;

	// For each level being played, get game if it exists
	for (let levelid in io.sockets.adapter.rooms){
		if (io.sockets.adapter.rooms[levelid].game){
			// Initialize render pack
			let pack = {};
			let room = io.sockets.adapter.rooms[levelid];
			
			pack['map'] = room.game.map;
			if (room.game.build){
				pack['edit'] = room.game.editing;
				pack['count'] = room.game.count;
				// packp['bg'] = room.game.
				pack['secret'] = room.game.secret[room.game.count];
			}
			// For each socket id in room, update and get render pack
			for (let i in room.sockets){
				let player = io.sockets.connected[i].player;
				if (player){
					room.game.updatePlayer(dt, player);
					pack[i] = player.getRenderPack();
				}
			}
			// Send render data to every player
			io.in(levelid).emit('update', pack);
		}
	}
	lastUpdateTime = currentTime;
}, 1000/60);

//-------------------------------------------------------------------------
// CONSTANTS AND UTILITY FUNCTIONS
//-------------------------------------------------------------------------
const BLOCK_NAMES = { VOID: 0, DOOR: 1, BEDROCK: 2, AUTHOR:3, PLATFORM: 4, NPC: 5, KEY: 6};
const BLOCK_INFO = [
	{id: BLOCK_NAMES.VOID, solid:0, remove:1},
	{id: BLOCK_NAMES.DOOR, solid:0},
	{id: BLOCK_NAMES.BEDROCK, solid: 1},
	{id: BLOCK_NAMES.AUTHOR, solid: 0, edit:1, remove: 0, talk:1},
	{id: BLOCK_NAMES.PLATFORM, solid: 1, edit:1, remove: 1},
	{id: BLOCK_NAMES.NPC, solid: 0, edit:1, remove: 1, talk:1},
	{id: BLOCK_NAMES.KEY, solid: 0, edit:1, remove: 1, pickup: 1},
];
const BLANK_ROOM0 = [ 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2 ];
const SIZE = {tw: 19, th: 8};
const TILE = 10;
const LIMITS = {
	x: 40,
	y: 160,
};
const SPEEDS = {
	gravity: 3,
	jump: 90,
	left: 8,
	right: 8,
};

function floor_p2t(p){ return Math.floor(p/TILE);} // point to tile, for click
function round_p2t(p){ return Math.round(p/TILE);} // point to tile, for block drop
function tformula(tx,ty,tw=SIZE.tw){ return tx + (ty*tw)} // tile to array index

function getCookie(source, cname) {
	var name = cname + "=";
	var decodedCookie = decodeURIComponent(source);
	var ca = decodedCookie.split(';');
	for(var i = 0; i <ca.length; i++) {
		var c = ca[i];
		while (c.charAt(0) == ' ')
			c = c.substring(1);
		if (c.indexOf(name) == 0)
			return c.substring(name.length, c.length);
	}
	return "";
}

//-------------------------------------------------------------------------
// UPDATE FUNCTION & OBJECTS
//-------------------------------------------------------------------------

// Game object holds information about instance of level : author, map, settings
function Game(build,id,name,authorid,secret,map){
	this.id = id;
	this.build = build;
	this.mapname = name;
	this.authorid = authorid;
	this.secret = secret;
	this.map_data = map;

	this.count = 0;
	this.win = false;
	this.editing = null;

	// Pointer to current room of map (editing this edits data). First room is blank, until player wins
	if(!this.build) this.map = BLANK_ROOM0;
	else this.map = this.map_data[this.count];

	this.getBlock = function (tx,ty) {return this.map[tformula(tx,ty)];}
	this.getBlockInfo = function(tx,ty){
		let t = this.getBlock(tx,ty);
		if (typeof t === 'object' && t !== null) return BLOCK_INFO[t.id];
		return BLOCK_INFO[t];
	}
	this.onClick = function(x,y,b){
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
	this.placeBlock = function(x,y,b){
		let tile = this.getBlockInfo(x,y);
		if(tile.remove) this.map[tformula(x,y)] = b;
	}
		
	this.roomChange = function(player, dir){
		if((this.count==0 && dir=="right") || 0<this.count<3 || (this.count==3 && dir=="left")){
			// Get direction, change room count
			if(dir == "left" && this.count) this.count--; 
			else if(dir == "right" && this.count<3) this.count++;

			// Update current map from map data -- if player hasnt won, make first room empty
			if(this.count == 0 && !(this.build || this.win)) this.map = BLANK_ROOM0;
			else this.map = this.map_data[this.count];

			// Remove editing
			this.editing = null;

			player.spawn(dir); // Respawn character at door entrance
		}
	}

	this.updatePlayer = function (dt, player){
		// Update velocity from player input
		if (player.left && player.vel.x > -LIMITS.x) player.vel.x -= SPEEDS.left;
		if (player.up && player.can_jump && player.vel.y > -LIMITS.y) player.vel.y -= SPEEDS.jump;
		if (player.right && player.vel.x < LIMITS.x) player.vel.x += SPEEDS.left;
		
		// Update player movement 
		player.vel.y += SPEEDS.gravity; // gravity
		player.vel.x *= .83; // friction

		player.vel.x = Math.min(Math.max(player.vel.x, -LIMITS.x), LIMITS.x); // Cap velocities
		player.vel.y = Math.min(Math.max(player.vel.y, -LIMITS.y), LIMITS.y);

		player.loc.x += dt*player.vel.x; // Update location
		player.loc.y += dt*player.vel.y;

		// Get tile locations of all probe points on player object
		let left = Math.floor((player.loc.x)/TILE);
		let leftYcol = Math.floor((player.loc.x + player.size.w/4)/TILE);
		let right = Math.floor((player.loc.x + player.size.w)/TILE);
		let rightYcol = Math.floor((player.loc.x + player.size.w*3/4)/TILE);
		let up = Math.floor((player.loc.y)/TILE);
		let upXcol = Math.floor((player.loc.y + player.size.h/4)/TILE);
		let down = Math.floor((player.loc.y + player.size.h)/TILE);
		let downXcol = Math.floor((player.loc.y + player.size.h*3/4)/TILE);

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
				left = Math.floor(player.loc.x/TILE);
				bLeftUp = this.getBlockInfo(left, upXcol);
				bLeftDown = this.getBlockInfo(left, downXcol);
			}

			while (bRightUp.solid || bRightDown.solid){
				player.loc.x -= 0.1;
				right = Math.floor((player.loc.x+player.size.w)/TILE);
				bRightUp  = this.getBlockInfo(right, upXcol);
				bRightDown  = this.getBlockInfo(right, downXcol);
			}

			leftYcol = Math.floor((player.loc.x + player.size.w/4)/TILE);
			rightYcol = Math.floor((player.loc.x + player.size.w*3/4)/TILE);

			player.vel.x = 0;
		}
		
		if (bTopLeft.solid || bTopRight.solid || bDownLeft.solid || bDownRight.solid) {
			// Resolve Y collision
			while (bTopLeft.solid || bTopRight.solid){
				player.loc.y += 0.1;
				up = Math.floor((player.loc.y)/TILE);
				bTopLeft    = this.getBlockInfo(leftYcol, up);
				bTopRight   = this.getBlockInfo(rightYcol, up);
			}
			while (bDownLeft.solid || bDownRight.solid){
				player.loc.y -= 0.1;
				down = Math.floor((player.loc.y+player.size.h)/TILE);
				bDownLeft = this.getBlockInfo(leftYcol, down);
				bDownRight = this.getBlockInfo(rightYcol, down);
			}
			player.vel.y = 0;
		}

		// Resolve jumping
		if (floorleft.solid || floorright.solid) player.can_jump = true;
		else player.can_jump = false;

		// On collision, assume it's a door REEEEEEE
		if((bLeftDown.id == BLOCK_NAMES.DOOR || bRightDown.id == BLOCK_NAMES.DOOR) 
			&& player.last_tile != BLOCK_NAMES.DOOR){
			if(bLeftDown.id == BLOCK_NAMES.DOOR) this.roomChange(player,"left");
			else if (bRightDown.id == BLOCK_NAMES.DOOR) this.roomChange(player,"right");
			player.last_tile = BLOCK_NAMES.DOOR;
		}
		else player.last_tile = BLOCK_NAMES.VOID;
	}
}

// Player object holds player postion and movement information
function Player(){
	this.size = {w: TILE/2, h: TILE};
	this.loc = {x: (SIZE.tw-8)*TILE, y: (SIZE.th-2)*TILE};
	this.vel    = { x: 0, y: 0};
	this.left     = false;
	this.right    = false;
	this.up       = false;
	this.can_jump = true;
	this.jump_switch = 0;
	this.last_tile = null;
	this.holding = null;

	this.getRenderPack = function(){
		return {...this.loc, ...this.size, 'holding': this.holding};
	}

	this.spawn = function(door){
		if (door === "left") this.loc = { x: (SIZE.tw-1)*TILE-this.size.w-1, y: (SIZE.th-2)*TILE};
		else if (door === "right") this.loc = { x: TILE+1, y: (SIZE.th-2)*TILE};
	}
}