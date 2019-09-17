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

const mysql = require('mysql2/promise');

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

// If client is redirected from Discord login OAuth with code in query, send to redirect 
// page (which will redirect when cookie is set with login token).
app.get('/',function(req, res) {
	if(req.query.code) res.sendFile(__dirname + '/client/redirect.html');
	else res.sendFile(__dirname + '/client/index.html');
});
app.use('/client', express.static(__dirname + '/client'));

server.listen(process.env.PORT || 2000);

const Constants = require('./shared/constants.js');
const Game = require('./server/game.js');
const Player = require('./server/player.js');

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

async function getToken(socket, tokenKey, tokenType){
	console.log('');
	console.log('>>> Getting Token...');
	console.log(`Using ${tokenType} : ${tokenKey}`);
	// Use same function for authorization code and refresh token (tokenType)
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
		login(socket, tokenjson);
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
			await db.query('REPLACE INTO users SET ?', {...user});
			
			delete user['refresh_token']; // Remove more unnecessary info

			// Check if player has any maps, get id
			let result = await db.query('SELECT id FROM maps WHERE authorid = ?', [user.id]);

			if(!result[0][0]){ // If new player with no maps (result[0][0] is undefined), insert new map (which generates a mapid)
				console.log('mapid is null, so creating new map...');

				const sql = `INSERT INTO maps (name,authorid) VALUES ("?'s Tea Room",?);`;
				await db.query(sql, [socket.user.username,user.id]);

				// Now get the new mapid which was just created
				result = await db.query('SELECT id FROM maps WHERE authorid = ?', [user.id]);
			}

			// Send data to client, to save token to cookies
			console.log("Sending info pack to client...");
			console.log({...user, ...result[0][0].id});
			socket.emit('login', {...user, 'mapid': result[0][0].id});

			// Save data to client-side socket, for quick access 
			socket.user = user;

			// Populate campaign map list
			const sql2 = 'SELECT maps.id, maps.name, maps.authorid FROM maps WHERE isplayer = 0;';
			const campaign = await db.query(sql2);
			socket.emit('menu-play-campaign-populate-res', campaign[0]);
		}
	} catch (error) {
		console.log(error);
	}
}

//-------------------------------------------------------------------------
// SOCKET STUFF
//-------------------------------------------------------------------------
io.on('connection', function(socket){
	socket.leave(socket.id); // Leave default room, we only want a socket to be in 1 at a time

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
		db.query('SELECT access_token, refresh_token FROM users WHERE id = ?', [cookie_id])
		.then(result =>{
			console.log('Db token: ', result[0][0].access_token);
			if (result[0][0].access_token == cookie_token){
				console.log("Good token!")
				login(socket, result[0][0]);
			} else throw "Wrong token!";
		});
	}

	socket.on('game-join-req', function(mapid){
		// Check if socket is logged in, and isn't already in a level
		if(socket.user && !Object.keys(socket.rooms)[0]){
			let build = false;

			console.log('');
			console.log(`>>> Retrieving ${mapid}...`);
			db.query('SELECT * FROM maps WHERE id = ?', [mapid]) // Access database, get map
			.then(result => {
				socket.join(socket.id);
				if (result[0][0].authorid == socket.user.id){ // If authorid of map is same as socket id, player can edit map
					console.log('Build is active!');
					build = true;
				}
				console.log('Creating session!');
				socket.player = new Player();
				io.sockets.adapter.rooms[socket.id].game = 
					new Game(build,mapid,result[0][0].name,result[0][0].authorid,JSON.parse(result[0][0].secret),JSON.parse(result[0][0].data));

				// Show client game view
				socket.emit('game-show-res', build);
			});
		}
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
		db.query(sql).then(result =>{
			socket.emit('menu-play-online-populate-res', result[0]);
		});
	});

	socket.on('game-edit', function(att,data){
		let levelid = Object.keys(socket.rooms)[0];
		if(levelid){ // Player must be in a level
			let game = io.sockets.adapter.rooms[levelid].game;
			if(game.build){
				if(game.editing){
					if (att === "message" || att === "type") game.editBlockAttribute(att,data);
					else if (att === "delete") game.deleteBlock();
				} 
				if (att == "roomChange") game.roomChange(socket.player, data);
				else if (att == "secret" && game.count) game.editSecret(data);
				else if (att == "save"){
					let sql = 'UPDATE maps SET data = ?,secret = ? WHERE id = ?';
					db.query(sql, [JSON.stringify(game.map_data),JSON.stringify(game.secret),game.id]);
				}
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
			else if (data.inputId === 'interact' && data.state && !game.build) game.onInteract(player);
			else if (data.inputId === 'mouse' && game.build) // If socket is building a level and clicks on canvas, add block
				game.onClick(data.state.x, data.state.y, data.state.b);
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
			pack['message'] = room.game.messageQueue.shift();
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