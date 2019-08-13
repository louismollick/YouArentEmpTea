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

const mysql = require('mysql');

const db = mysql.createConnection({
	host: "localhost",
	user: "root",
	password: "",
	database : "youarentemptea"
});

db.connect(function(err) {
	if (err) throw err;
	console.log("MySql Connected!");
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
		data.append('client_secret', 'OgcZ6EAd0LnUhRvq8NAeYtF_69RutLgw');
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
	console.log('>>> Logging in...')
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
			let sql = `INSERT INTO users SET ? ON DUPLICATE KEY UPDATE username='${user.username}',avatar='${user.avatar}',discriminator='${user.discriminator}',access_token='${user.access_token}',refresh_token='${user.refresh_token}'`;
			let query = db.query(sql, user, (err, result) => {
				if(err) throw err;
				console.log(result);
			});
			// Remove more unnecessary info
			delete user['refresh_token'];

			// Send data to client, to save token to cookies
			console.log("Sending info pack to client...");
			socket.emit('discord-login', user);

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

		// Access database and compare
		let sql = `SELECT access_token, refresh_token FROM users WHERE id = ${cookie_id}`;
		let query = db.query(sql, (err, result) => {
			if(err) throw err;
			console.log('Db token: ', result[0].access_token);
			if (result[0].access_token == cookie_token){
				// Try logging in with the current token (result[0] contains refresh 
				// token as well, in case current token is expired).
				console.log("Good cookie!")
				login(socket, result[0]);
			}
			else console.log("Wrong cookie!");
		});
	}

	socket.on('game-join-req', function(levelname, authorid){
		// Check if socket is logged in, and isn't already in a level
		if(socket.user && !Object.keys(socket.rooms)[0]){
			let build = false;

			// If no data, assume socket's room
			if(!levelname || !authorid) {
				build = true;
				levelname = 'Default'; // REEEEEEEEEEEEE
				authorid = socket.user.id;
			}
		
			console.log('');
			console.log(`>>> Displaying ${levelname} by ${authorid}...`);

			// Join room corresponding to level id
			let levelid = `${authorid}-${levelname}`;
			socket.join(levelid);

			// Access database, get map
			let sql = `SELECT json_extract(maps, '$.${levelname}') AS map FROM users WHERE id = ${authorid}`;
			let query = db.query(sql, (err, result) => {
				if(err) throw err;

				// If no game is ongoing in level, create it
				if (!io.sockets.adapter.rooms[levelid].game){
					socket.player = new Player();
					console.log("Created Player??");
					io.sockets.adapter.rooms[levelid].game = new Game(build,levelname,authorid,JSON.parse(JSON.parse(result[0].map)));
					console.log("Created game??");
				}
			});

			// Show client game view
			socket.emit('game-show-res', build); // REEEEEEEEEEEEEE
			
		} else{ socket.emit('error', "There was an error joining that level.");}
	});

	socket.on('game-leave-req', function (){
		let levelid = Object.keys(socket.rooms)[0];

		// If socket is in level, leave
		if(levelid) socket.leave(levelid);
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
					game.newBlock(round_p2t(player.loc.x),round_p2t(player.loc.y), player.holding);
					player.holding = null;
				}
				// Pick up block
				else if (!player.holding && binfo.pickup){
					player.holding = game.getBlock(round_p2t(player.loc.x),round_p2t(player.loc.y));
					game.newBlock(round_p2t(player.loc.x),round_p2t(player.loc.y), BLOCK_NAMES.VOID);
				}
				// Talk to NPC
				else if (binfo.talk && !binfo.pickup){
					let b = game.getBlock(round_p2t(player.loc.x),round_p2t(player.loc.y));
					if(b.message != ""){
						socket.emit('game-npc-talk', b.message);

						// Stop player input state
						player.left = false;
						player.right = false;
						player.up = false;
						player.vel = {x:0, y:0};
					}
				}
			}
			// If socket is building a level and clicks on canvas, add block
			else if (data.inputId === 'mouse' && io.sockets.adapter.rooms[levelid].game.build)
				io.sockets.adapter.rooms[levelid].game.newBlock(floor_p2t(data.state.x), floor_p2t(data.state.y), data.state.b);
		}
	});

	socket.on('game-build-save', function(){
		let levelid = Object.keys(socket.rooms)[0];
		// If player is in level (if !0)
		if(levelid){
			let game = io.sockets.adapter.rooms[levelid].game; // Assign by REFERENCE
			// If the map is being edited
			if(game.build){
				// Save to database
				let sql = `UPDATE users SET maps = json_replace(maps, '$.${game.mapname}',?) WHERE id = ${socket.user.id}`;
				let query = db.query(sql, JSON.stringify(game.map_data), (err, result) => {
					if(err) throw err;
					console.log(result);
				});
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
			
			// For each socket id in room, update and get render pack
			for (let i in room.sockets){
				room.game.updatePlayer(dt, io.sockets.connected[i].player);
				pack[i] = io.sockets.connected[i].player.getRenderPack();
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
/*
	Key vairables:
	id       [required] - an integer that corresponds with a tile in the data array.
	edit	 [optional] - whether a builder can move/place/remove a block
	solid    [optional] - whether the tile is solid or not, defaults to false.
	bounce   [optional] - how much velocity is preserved upon hitting the tile, 0.5 is half.
	jump     [optional] - whether the player can jump while over the tile, defaults to false.
	gravity  [optional] - gravity of the tile, must have X and Y values (e.g {x:0.5, y:0.5}).
	oncollision [optional] - refers to a script in the scripts section, executed if it is touched.
	
*/
const BLOCK_NAMES = { VOID: 0, DOOR_LEFT: 1, DOOR_RIGHT: 2, BEDROCK: 3,  PLATFORM: 4, NPC: 5, KEY: 6};
const BLOCK_INFO = [
	{id: BLOCK_NAMES.VOID, solid:0},
	{id: BLOCK_NAMES.DOOR_LEFT, solid:0, oncollision: function(game,player){
		if(game.count){
			game.count--; 
			game.map = game.map_data[game.count]; 
			player.spawn("right");
		} 
	}},
	{id: BLOCK_NAMES.DOOR_RIGHT, solid:0, oncollision: function(game, player){
		if(game.count<4){
			game.count++; 
			game.map = game.map_data[game.count]; 
			player.spawn("left");
		} 
	}},
	{id: BLOCK_NAMES.BEDROCK, solid: 1, bounce: {x: 0,y: 0},},
	{id: BLOCK_NAMES.PLATFORM, solid: 1, edit: 1, bounce: {x: 0,y: 0}},
	{id: BLOCK_NAMES.NPC, solid: 0, edit: 1, talk: 1},
	{id: BLOCK_NAMES.KEY, solid: 0, edit: 1, pickup: 1},
];
const SIZE = {tw: 19, th: 8};
const TILE     = 10;
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

function t2p(t){ return t*TILE;} // tile to point
function floor_p2t(p){ return Math.floor(p/TILE);} // point to tile, for click
function round_p2t(p){ return Math.round(p/TILE);} // point to tile, for block drop
function tformula(tx,ty,tw=SIZE.tw){ return tx + (ty*tw)} // tile to array index

function newMap(tw,th){
	let map = [];
	// SETUP MAP
	for(let i = 0; i < tw*th; i++){
		map[i] = BLOCK_NAMES.VOID;// all to 0
	}
	  // Walls
	for(let i = 0; i< th*tw; i+=tw){
		map[i] = BLOCK_NAMES.BEDROCK; // vertical
		map[tw+i-1] = BLOCK_NAMES.BEDROCK;
	}
	for(let i = 0; i < tw; i++){
		map[i] = BLOCK_NAMES.BEDROCK; // horizontal
		map[tw*(th-1)+i] = BLOCK_NAMES.BEDROCK;
	}
	return map;
}

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
function Game(build,name,authorid,map){
	this.build = build;
	this.mapname = name;
	this.authorid = authorid;
	this.map_data = map;
	this.count = 0;
	this.map = this.map_data[this.count]; // Pointer to current room of map (editing this edits data)
	this.secret = [null, null, null, null];

	this.getBlock = function (tx,ty) {return this.map[tformula(tx,ty)];}
	this.getBlockInfo = function(tx,ty){
		let t = this.getBlock(tx,ty);
		if (typeof t === 'object' && t !== null) return BLOCK_INFO[t.id];
		return BLOCK_INFO[t];
	}

	this.newBlock = function(x,y,b){
		let tile = this.getBlockInfo(x,y);
		
		// If no block there, add block
		if (!tile.id) this.map[tformula(x,y)] = b;
		
		// Otherwise check if deletable, then delete it
		else if (tile.edit) this.map[tformula(x,y)] = BLOCK_NAMES.VOID;
	}

	this.updatePlayer = function (dt, player){
		if (player.left && player.vel.x > -LIMITS.x) player.vel.x -= SPEEDS.left;
		if (player.up && player.can_jump && player.vel.y > -LIMITS.y) player.vel.y -= SPEEDS.jump;
		if (player.right && player.vel.x < LIMITS.x) player.vel.x += SPEEDS.left;

		let tX = player.loc.x + dt*player.vel.x;
		let tY = player.loc.y + dt*player.vel.y;

		let offset = Math.round((TILE / 2) - 1);

		let tile = this.getBlockInfo(Math.round(player.loc.x / TILE),Math.round(player.loc.y / TILE));
		
		if(tile.gravity){
			player.vel.x += tile.gravity.x;
			player.vel.y += tile.gravity.y;
		} else {
			player.vel.y += SPEEDS.gravity;
		}

		let t_y_up   = Math.floor(tY / TILE);
		let t_y_down = Math.ceil(tY / TILE);
		let y_near1  = Math.round((player.loc.y - offset) / TILE);
		let y_near2  = Math.round((player.loc.y + offset) / TILE);

		let t_x_left  = Math.floor(tX / TILE);
		let t_x_right = Math.ceil(tX / TILE);
		let x_near1   = Math.round((player.loc.x - offset) / TILE);
		let x_near2   = Math.round((player.loc.x + offset) / TILE);

		let top1    = this.getBlockInfo(x_near1, t_y_up);
		let top2    = this.getBlockInfo(x_near2, t_y_up);
		let bottom1 = this.getBlockInfo(x_near1, t_y_down);
		let bottom2 = this.getBlockInfo(x_near2, t_y_down);
		let left1   = this.getBlockInfo(t_x_left, y_near1);
		let left2   = this.getBlockInfo(t_x_left, y_near2);
		let right1  = this.getBlockInfo(t_x_right, y_near1);
		let right2  = this.getBlockInfo(t_x_right, y_near2);

		player.vel.x = Math.min(Math.max(player.vel.x, -LIMITS.x), LIMITS.x);
		player.vel.y = Math.min(Math.max(player.vel.y, -LIMITS.y), LIMITS.y);
		
		player.loc.x += dt*player.vel.x;
		player.loc.y += dt*player.vel.y;
		
		player.vel.x *= .83;
		
		if (left1.solid || left2.solid || right1.solid || right2.solid) {
			// Resolve collision
			while (this.getBlockInfo(Math.floor(player.loc.x / TILE), y_near1).solid 
			|| this.getBlockInfo(Math.floor(player.loc.x / TILE), y_near2).solid){
				player.loc.x += 0.1;
			}

			while (this.getBlockInfo(Math.ceil(player.loc.x / TILE), y_near1).solid
				|| this.getBlockInfo(Math.ceil(player.loc.x / TILE), y_near2).solid)
				player.loc.x -= 0.1;
				
			// tile bounce
			var bounce = 0;
			if (left1.solid && left1.bounce.x > bounce) bounce = left1.bounce.x;
			if (left2.solid && left2.bounce.x > bounce) bounce = left2.bounce.x;
			if (right1.solid && right1.bounce.x > bounce) bounce = right1.bounce.x;
			if (right2.solid && right2.bounce.x > bounce) bounce = right2.bounce.x;

			player.vel.x *= -bounce || 0;
		}
		
		if (top1.solid || top2.solid || bottom1.solid || bottom2.solid) {
			// Resolve collision
			while (this.getBlockInfo(x_near1, Math.floor(player.loc.y / TILE)).solid 
			|| this.getBlockInfo(x_near2, Math.floor(player.loc.y / TILE)).solid)
				player.loc.y += 0.1;

			while (this.getBlockInfo(x_near1, Math.ceil(player.loc.y / TILE)).solid 
			|| this.getBlockInfo(x_near2, Math.ceil(player.loc.y / TILE)).solid)
				player.loc.y -= 0.1;
				
			// tile bounce
			var bounce = 0;
			if (top1.solid && top1.bounce.y > bounce) bounce = top1.bounce.y;
			if (top2.solid && top2.bounce.y > bounce) bounce = top2.bounce.y;
			if (bottom1.solid && bottom1.bounce.y > bounce) bounce = bottom1.bounce.y;
			if (bottom2.solid && bottom2.bounce.y > bounce) bounce = bottom2.bounce.y;
			
			player.vel.y *= -bounce || 0;
		}

		// Resolve jumping
		if ((bottom1.solid || bottom2.solid) && !tile.jump) player.can_jump = true;
		else player.can_jump = false;

		// On collision, call event associated to block
		if(player.last_tile != tile.id && tile.oncollision) tile.oncollision(this, player);

		player.last_tile = tile.id;
	}
}

// Player object holds player postion and movement information
function Player(){
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
		return {...this.loc, 'holding': this.holding};
	}

	this.spawn = function(side){
		if (side === "right") this.loc = { x: (SIZE.tw-2)*TILE, y: (SIZE.th-2)*TILE};
		else if (side === "left") this.loc = { x: TILE, y: (SIZE.th-2)*TILE};
	}
}