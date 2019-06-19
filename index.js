/*
	TODO:
	- Prevent exploits : signin, create requests (all buttons basically)
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
	database : 'youarentemptea'
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

async function getToken(socket, tokenKey){
	console.log('');
	console.log('>>> Getting Token...')
	try {
		const data = new FormData();
		data.append('client_id', '');
		data.append('client_secret', '');
		data.append('grant_type', 'authorization_code');
		data.append('redirect_uri', 'http://localhost:2000/');
		data.append('scope', 'identify');
		data.append('code', tokenKey);

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
			getToken(socket, token.refresh_token);
		}
		else{
			let user = {...token, ...info}; // Package for save

			// Remove unnecessary info
			['locale', 'mfa_enabled', 'flags', 'token_type', 'expires_in', 'scope'].forEach(e => delete user[e]);

			// Save to database
			let sql = 'REPLACE INTO users SET ?';
			let query = db.query(sql, user, (err, result) => {
				if(err) throw err;
				console.log(result);
			});
			// Remove more unnecessary info REEEEEEEEEE

			// Send info to client, to save token to cookies
			console.log("Sending info pack to client...");
			socket.emit('discord-login', user);
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

	const urlObj = url.parse(socket.handshake.headers.referer, true);
	const cookie = socket.handshake.headers.cookie;

	// If socket was redirected from Discord OAuth2
	if (urlObj.query.code) {
		console.log('... has code!');

		const accessCode = urlObj.query.code;
		getToken(socket, accessCode);
	}
	else if(cookie){ // Otherwise, if returning player with cookie
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

	socket.on('game-join', function(level){
		// Check if player isn't already in a level
		if(!Object.keys(socket.rooms)[0]){
			let build = false;
			if(!level){	// If no arguments, assume it is socket's room
				level = socket.level;
				build = true;
			}
			// Join room corresponding to level id
			socket.join(level.id);

			// Show client game view
			socket.emit('game-show');

			// If no game is ongoing in level, create it
			if (!io.sockets.adapter.rooms[level.id].game){
				io.sockets.adapter.rooms[level.id].game = new Game(build, level.map);
				io.sockets.adapter.rooms[level.id].sockets.forEach(socket => {
					socket.character = new Character();
				});
			}
		} else{ socket.emit('error', "There was an error joining that level.");}
	});

	socket.on('game-leave', function (){
		let levelid = Object.keys(socket.rooms)[0];

		// If socket is in level, leave
		if(levelid) socket.leave(levelid);
	});

	socket.on('keyPress',function(data){
		console.log('key');
		let levelid = Object.keys(socket.rooms)[0];

		// If player is in level (if !0)
		if(levelid){
			if(data.inputId === 'left')
				socket.character.left = data.state;
			else if(data.inputId === 'right')
				socket.character.right = data.state;
			else if(data.inputId === 'up')
				socket.character.up = data.state;
			else if (data.inputId === 'mouse' && io.sockets.adapter.rooms[levelid].game.build)
				io.sockets.adapter.rooms[levelid].game.newBlock(data.state.x, data.state.y, data.block);
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

	// For each level being played, get game
	for (let levelid in io.sockets.adapter.rooms){
		// Initialize render pack
		let pack = {};

		let room = io.sockets.adapter.room[levelid];
		pack['map'] = room.game.map;

		// For each player, update and get render pack
		for (let i in room.sockets){
			updatePlayer(dt,room.game,room.sockets[i]);
			pack[i] = room.sockets[i].getRenderPack();
		}

		// Send render data to every player
		io.in(id).emit('update', pack);
	}
	lastUpdateTime = currentTime;
}, 1000/60);

//-------------------------------------------------------------------------
// CONSTANTS AND UTILITY FUNCTIONS
//-------------------------------------------------------------------------

const SIZE   = {tw: 30, th: 30};
	TILE     = 20;
	HEIGHT 	 = SIZE.th*TILE;
	GRAVITY  = 9.8 * 6; // default (exagerated) gravity
	MAXDX    = 15;      // default max horizontal speed (15 tiles per second)
	MAXDY    = 60;      // default max vertical speed   (60 tiles per second)
	ACCEL    = 1/3;     // default take 1/2 second to reach maxdx (horizontal acceleration)
	FRICTION = 1/6;     // default take 1/6 second to stop from maxdx (horizontal friction)
	IMPULSE  = 1500;    // default player jump impulse
	BUILD_TIME = 5;     // default time allowed for build phase
	AMOUNT_TEAMS = 2;
	BLOCKS   = { NULL: 0, SPAWN: 1, GOAL: 2, BEDROCK: 3,  BRICK: 4, WOOD: 5 };
	COLLIDER_BLOCKS = [BLOCKS.BEDROCK, BLOCKS.BRICK, BLOCKS.WOOD];
	IMMUTABLE_BLOCKS = [BLOCKS.BEDROCK, BLOCKS.SPAWN, BLOCKS.GOAL];
	PHASES = { BUILD: 0, RACE: 1, FINISH: 2};

function bound(x, min, max) {
	return Math.max(min, Math.min(max, x));
}
function t2p(t)     { return t*TILE;                     }; // tile to point
function p2t(p)     { return Math.floor(p/TILE);         }; // point to tile
function tformula(tx,ty) {return tx + (ty*SIZE.tw)       }; // tile to array index
function pformula(x,y)   {return tformula(p2t(x),p2t(y)) }; // point to array index

function tcell(map,tx,ty) {return map[tformula(tx,ty)];}; // get cell with tile from array

function isSurroundingCellTraversable(map,tx,ty){
	cell = tcell(map,tx,ty);
	for (block of COLLIDER_BLOCKS) if(cell === block) return true;
	return false;
}

function getRandomInt(min, max) { //min and max included
	return Math.floor(Math.random() * (max - min + 1) ) + min;
}
function newMap(){
	let map = [];
	// SETUP MAP
	for(let i = 0; i < SIZE.tw*SIZE.th; i++){
		map[i] = BLOCKS.NULL;// all to 0
	}
	  // Walls
	for(let i = 0; i< SIZE.th*SIZE.tw; i+=SIZE.tw){
		map[i] = BLOCKS.BEDROCK; // vertical
		map[SIZE.tw+i-1] = BLOCKS.BEDROCK;
	}
	for(let i = 0; i < SIZE.tw; i++){
		map[i] = BLOCKS.BEDROCK; // horizontal
		map[SIZE.tw*(SIZE.th-1)+i] = BLOCKS.BEDROCK;
	}
	  // Spawn
	map[tformula(1,SIZE.th-3)] = BLOCKS.SPAWN;
	map[tformula(1,SIZE.th-2)] = BLOCKS.SPAWN;
	map[tformula(2,SIZE.th-3)] = BLOCKS.SPAWN;
	map[tformula(2,SIZE.th-2)] = BLOCKS.SPAWN;
	  // Goal
	let randX = getRandomInt(1, SIZE.tw-2);
	let randY = getRandomInt(2, SIZE.th-2);
	while(map[tformula(randX,randY)]){ // while possible goal locations are already occupied
		randX = getRandomInt(1, SIZE.tw-2);
		randY = getRandomInt(2, SIZE.th-2);
	}
	map[tformula(randX,randY)] = BLOCKS.GOAL;
	map[tformula(randX,randY-1)] = BLOCKS.GOAL;

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

// Update player function, all collision is done using the top left corner 
// of the player box. Function is not a player object method because I don't want to pass in every
// value from the game object seperately ; or use game functions in that obj.
function updatePlayer(dt,game,player){
	let map = game.map;
	
	// Get player movement status
	let wasleft = player.dx  < 0, 
	wasright    = player.dx  > 0,
	friction    = player.friction,
	accel       = player.accel;

	// Update acceleration and player input
	player.ddx = 0;
	player.ddy = player.gravity;
	if (player.left)
		player.ddx = player.ddx - accel;
	else if (wasleft)
		player.ddx = player.ddx + friction;
	if (player.right)
		player.ddx = player.ddx + accel;
	else if (wasright)
		player.ddx = player.ddx - friction;
	if (player.up && !player.jumping && !player.falling) {
		player.ddy = player.ddy - player.impulse; // an instant big force impulse
		player.jumping = true;
	}
	
	// Update X position and velocity
	player.x  = player.x  + (dt * player.dx);
	player.dx = bound(player.dx + (dt * player.ddx), -player.maxdx, player.maxdx);
	if ((wasleft  && (player.dx > 0)) || (wasright && (player.dx < 0))) 
		player.dx = 0; // clamp at zero to prevent friction from making us jiggle side to side

		// Collision variables #1
	let tx = p2t(player.x); // player tile position
	let ty = p2t(player.y);
	let nx = player.x%TILE; // overlap on tile (remainder)
	let ny = player.y%TILE; // y overlap on grid
	let blockhere = isSurroundingCellTraversable(map,tx,ty) // Get surrounding cells around player
	let blockright = isSurroundingCellTraversable(map,tx+1,ty);
	let blockbelow = isSurroundingCellTraversable(map,tx,ty+1);
	let blockbelow_right = isSurroundingCellTraversable(map,tx+1,ty+1);

		// Check for X collision
	if (player.dx > 0) { // moving right 
		if ((blockright && !blockhere) || (blockbelow_right  && !blockbelow && ny)) {
			player.x  = t2p(tx);
			player.dx = 0;
		}
	}
	else if (player.dx < 0) { // moving left
		if ((blockhere     && !blockright) ||
			(blockbelow && !blockbelow_right && ny)) {
			player.x  = t2p(tx + 1);
			player.dx = 0;
		}
	}

	// Update Y position and velocity
	player.y  = player.y  + (dt * player.dy);
	player.dy = bound(player.dy + (dt * player.ddy), -player.maxdy, player.maxdy);

		// Collision variables #2
	tx = p2t(player.x); // p tile position
	ty = p2t(player.y);
	nx = player.x%TILE; // overlap on tile (remainder)
	ny = player.y%TILE; // y overlap on grid
	blockhere = isSurroundingCellTraversable(map,tx,ty);
	blockright = isSurroundingCellTraversable(map,tx+1,ty);
	blockbelow = isSurroundingCellTraversable(map, tx,ty+1);
	blockbelow_right = isSurroundingCellTraversable(map, tx+1,ty+1);

		// Check for Y collision
	if (player.dy > 0) { // falling
		if ((blockbelow && !blockhere) || (blockbelow_right && !blockright && nx)) {
			player.y = t2p(ty);
			player.dy = 0;
			player.falling = false;
			player.jumping = false;
			ny = 0;
		}
	}
	else if (player.dy < 0) { // jumping
		if ((blockhere && !blockbelow) || (blockright && !blockbelow_right && nx)) {
			player.y  = t2p(ty + 1);
			player.dy = 0;
			ny   = 0;
		}
	}

	// Collision variables #3
	tx = p2t(player.x);
	ty = p2t(player.y);
	nx = player.x%TILE;
	ny = player.x%TILE;
	finishhere = (tcell(map,tx,ty) === BLOCKS.GOAL);
	finishright = (tcell(map,tx+1,ty) === BLOCKS.GOAL);
	finishbelow = (tcell(map,tx+1,ty+1) === BLOCKS.GOAL);

		// Check for special block collision
	// if (finishhere || (finishright && nx) || (finishbelow && ny)){ // check for goal
	// 	if (gameState == GAMESTATES.RACE){
	// 		gameState = GAMESTATES.FINISH;
	// 		finishTime = timer;
	// 		clearTimer();
	// 		return;
	// 	}
	// }

	player.falling = ! (blockbelow || (nx && blockbelow_right)); // update falling status
}

// Game object holds information about instance of level : author, map, settings
function Game(build,map){
	this.build = build;
	this.map = map || newMap();
	this.newBlock = function(x,y){
		let cell = tcell(map,p2t(x),p2t(y));
	
		// If no block there, add block
		if (cell == BLOCKS.NULL)
			this.map[pformula(x,y)] = BLOCKS.BRICK;
	
		// Otherwise check if deletable, then delete it
		else if (!IMMUTABLE_BLOCKS.includes(cell)) this.map[pformula(x,y)] = BLOCKS.NULL;
	}
}

// Character object holds player postion and movement information
function Character(){
	this.start    = { x: TILE, y: HEIGHT-2*TILE};
	this.x        = this.start.x;
	this.y        = this.start.y;
	this.dx       = 0;
	this.dy       = 0;
	this.ddx      = 0;
	this.ddy      = 0;
	this.gravity  = TILE * GRAVITY;
	this.maxdx    = TILE * MAXDX;
	this.maxdy    = TILE * MAXDY;
	this.impulse  = TILE * IMPULSE;
	this.accel    = this.maxdx / ACCEL;
	this.friction = this.maxdx / FRICTION;
	this.left     = false;
	this.right    = false;
	this.up       = false;
	this.jumping  = false;
	this.falling  = false;

	this.getRenderPack = function(){
		return {
			x: this.x,
			y: this.y,
		};
	}

	this.reset = function(){
		this.x = this.start.x;
		this.y = this.start.y;
		this.dx = this.dy = 0;
	}
}