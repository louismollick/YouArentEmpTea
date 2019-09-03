(function() { // module pattern
    const SIZE   = { tw: 19, th: 8};
    const TILE     = 10;
    const KEY      = { ESC: 27, R: 82, W: 87, A: 65, D: 68, E: 69, SPACE: 32, LEFT: 37, UP: 38, RIGHT: 39 };
    const BLOCK_NAMES = { VOID: 0, DOOR: 1, BEDROCK: 2, AUTHOR:3,  PLATFORM: 4, NPC: 5, KEY: 6};
    const BLOCKS = [
        {id: BLOCK_NAMES.VOID},
        {id: BLOCK_NAMES.DOOR_LEFT, color: 'white'},
        {id: BLOCK_NAMES.BEDROCK, color: 'black'},
        {id: BLOCK_NAMES.AUTHOR, color: 'purple', object: 1, message: 1},
        {id: BLOCK_NAMES.PLATFORM, color: 'black'},
        {id: BLOCK_NAMES.NPC, color: 'green', object: 1, message: 1},
        {id: BLOCK_NAMES.KEY, color: 'yellow', object: 1, types:['friend','banana','gun']}
    ];
    let width    = SIZE.tw * TILE;
    let height   = SIZE.th * TILE;
    let canvas   = document.getElementById('game-canvas');
    let ctx      = canvas.getContext('2d');
    
    canvas.width  = width;
    canvas.height = height;

    let socket = io();

    let previousedit = null;

    //-------------------------------------------------------------------------
    // SOCKET EVENTS
    //-------------------------------------------------------------------------

    socket.on('error', console.error);
    socket.on('print', function(data){console.log("printing... ", data);});
    socket.on('alert', function(message){alert(message);});
    socket.on('menu-login', function(data){
        console.log('Setting cookies...');
        // Set cookies for next login
        document.cookie = `id=${data.id};path=/`;
        document.cookie = `token=${data.access_token};path=/`;

        console.log('Displaying login info', data);
        // Update page with login info
        document.getElementById('menu-button-login').href = "";
        document.getElementById('menu-button-login').classList.add('disabled');
        document.getElementById('menu-button-login').innerHTML = `Logged in as 
            <img style="width:30px;" class="rounded-circle" src="https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=128"/> 
            ${data.username}#${data.discriminator}`;
    });
    socket.on('menu-insert-build-id', function(data){
        console.log('Setting build button mapid...');
        document.getElementById('menu-main-btn-build').dataset.mapid = data;
    });
    socket.on('menu-play-online-populate-res', function(data){
        // Clear table
        let table = document.getElementById('menu-play-online');
        table.innerHTML = '';
        
        // Create row, populate with data
        data.forEach(map => {
            let row = document.createElement('tr');
            row.innerHTML =
            `<td>${map.name}</td>
            <td><img style="width:30px;" class="rounded-circle" src="https://cdn.discordapp.com/avatars/${map.authorid}/${map.avatar}.png?size=128"/> ${map.username}</td>
            <td></td><td><button type="button" class="btn btn-primary join" data-mapid="${map.id}">Join</button></td>`;
            table.appendChild(row);
        });
    });
    socket.on('menu-play-campaign-populate-res', function(data){
        // Create row, populate with data
        data.forEach(map => {
            let button = document.createElement('button');
            button.classList.add('btn','btn-primary','join');
            button.innerHTML = "Join";
            button.dataset.mapid = map.id;
            document.getElementById('menu-play-campaign').appendChild(button);
        });
    });
    socket.on('game-show-res',function(build){
        // Hide main menu and show game canvas
        document.getElementById('menu').classList.add('d-none');
        document.getElementById('game').classList.remove('d-none');

        // Hide other things that shouldn't be up yet
        document.getElementById('game-ui-build-edit').classList.add('d-none');
        // If building own room, show build ui panel
        if(build) document.getElementById('game-ui-build').classList.remove('d-none');
        else document.getElementById('game-ui-build').classList.add('d-none');
    });
    
    socket.on('update', function(pack){render(ctx, pack);});

    //-------------------------------------------------------------------------
    // DOCUMENT EVENTS
    //-------------------------------------------------------------------------
    document.addEventListener("DOMContentLoaded", function() {
        // Populate blocks in build panel
        for(i=BLOCK_NAMES.PLATFORM; i<BLOCKS.length; i++){
            let block = document.createElement('div');
            let b = BLOCKS[i];

            block.classList.add('m-2');
            block.classList.add('block');

            // Set default selected block
            if(b.id === BLOCK_NAMES.PLATFORM) block.classList.add('selected');

            // Set internal block info
            block.dataset.json = b.id;
            
            // REEEEEEEE place with sprite
            block.style.backgroundColor = b.color;

            document.getElementById('game-ui-build-blocks').appendChild(block);
        }

        // Populate build secret key select
        BLOCKS[BLOCK_NAMES.KEY].types.forEach(type => {
            let option = document.createElement("option");
            option.text = type;
            option.value = type;
            document.getElementById('game-ui-build-secret').appendChild(option);
        });

        // Populate room selection
        socket.emit('menu-play-online-populate-req');
        socket.emit('menu-play-campaign-populate-req');
    });
    document.getElementById('menu-button-login').onclick = function(){socket.emit('discord-login');}
    document.getElementById('menu-button-main').onclick = function(){
        socket.emit('game-leave');
        // Hide game canvas and show main menu
        document.getElementById('menu').classList.remove('d-none');
        document.getElementById('menu-main').classList.remove('d-none');
        document.getElementById('menu-play').classList.add('d-none');
        document.getElementById('game').classList.add('d-none');
    }
    document.getElementById('menu-main-btn-play').onclick = function(){
        document.getElementById('menu-main').classList.add('d-none');
        document.getElementById('menu-play').classList.remove('d-none');
    }
    document.getElementById('menu-play-online-refresh-btn').onclick = function(){socket.emit('menu-play-online-populate-req');}
    document.getElementById('menu').onclick = function(ev){
        if (ev.target.classList.contains('join') && ev.target.dataset.mapid)
            socket.emit('game-join-req', ev.target.dataset.mapid);
    }
    document.getElementById('game-ui').onclick = function(ev){
        // On build-ui block selection click
        if (ev.target.classList.contains('block')){
            // Remove selected from old selected
            document.getElementsByClassName('selected')[0].classList.remove('selected');
            // Make new block selected
            ev.target.classList.add('selected');
        }
    }
    document.getElementById('game-ui-build-left').onclick = function(){
        socket.emit('game-build-room-change','left');
    }
    document.getElementById('game-ui-build-right').onclick = function(){
        socket.emit('game-build-room-change','right');
    }
    document.getElementById('game-ui-build-edit-message').onchange = function(){
        socket.emit('game-edit-message', document.getElementById('game-ui-build-edit-message').value);
    }
    document.getElementById('game-ui-build-edit-types').onchange = function(){
        socket.emit('game-edit-type', document.getElementById('game-ui-build-edit-types').value);
    }
    document.getElementById('game-ui-build-secret').onchange = function(){
        socket.emit('game-edit-secret', document.getElementById('game-ui-build-secret').value);
    }
    document.getElementById('game-ui-build-btn-save').onclick = function(){socket.emit('game-build-save');}
    document.getElementById('game-ui-build-btn-delete').onclick = function(){socket.emit('game-build-delete');}
    document.addEventListener('keyup', function(ev) { keycontrols(ev,false);}, false);
    document.addEventListener("keydown", function (ev){ keycontrols(ev,true);}, false);
    document.addEventListener('keyup', function(ev) { keycontrols(ev,false);}, false);
    canvas.addEventListener("mousedown", function(ev){
        // Find scale of resized canvas screen vs original
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        // Convert mouse press screen coords to game coords
        const x = (ev.clientX - rect.left) * scaleX;
        const y = (ev.clientY - rect.top) * scaleY;

        // Get selected block id
        let b = JSON.parse(document.getElementsByClassName('selected')[0].dataset.json);

        // If selected block is an object-block, create object with user input
        if(BLOCKS[b].object){
            let blockinfo = BLOCKS[b];
            // Create object
            b = {id: b};
            if(blockinfo.message) b.message = '';
            if(blockinfo.types) b.type = blockinfo.types[0];
        }

        // Ask to place block
        socket.emit('keyPress', {inputId:'mouse',state:{x: x, y: y, b: b}});
    }, false);

    //-------------------------------------------------------------------------
    // GAME RENDERING FUNCTIONS
    //-------------------------------------------------------------------------
    function tformula(tx,ty) {return tx + (ty*SIZE.tw)}; // tile to array index

    function render(ctx,pack){
        ctx.clearRect(0, 0, width, height);
        for (i in pack){ 
            if (i === 'map'){
                // Render map
                for(let y = 0 ; y < SIZE.th ; y++){
                    for(let x = 0 ; x < SIZE.tw ; x++){
                        let cell = pack[i][tformula(x,y)];
                        if (cell){ // not rendering void
                            // Get block rendering info
                            let binfo;
                            if (typeof cell === "object") binfo = BLOCKS[cell.id];
                            else binfo = BLOCKS[cell];

                            // Render with block color RREEEEEEEE make sprite
                            ctx.fillStyle = binfo.color;
                            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);

                            // Type text REEEEE
                            if(cell.type){
                                ctx.fillStyle = 'black';
                                ctx.fillText(cell.type, x * TILE, y * TILE);
                            }
                        }
                    }
                }
            }
            else if(i == 'count'){
                let c = pack['count'];
                let d = document.getElementById('game-ui-build-title');
                if(c != d.innerHTML){
                    d.innerHTML = c;
                    if (c == 0) document.getElementById('game-ui-build-left').disabled = true;
                    else document.getElementById('game-ui-build-left').disabled = false;
                    if (c == 3) document.getElementById('game-ui-build-right').disabled = true;
                    else document.getElementById('game-ui-build-right').disabled = false;
                }
            }
            else if (i == 'edit'){
                let b = pack['edit'];
                if(b){
                    // Display edit indicator
                    ctx.strokeStyle = 'red';
                    ctx.strokeRect(pack[i].x * TILE, pack[i].y * TILE, TILE, TILE);
                }
                if(JSON.stringify(b) != JSON.stringify(previousedit)){ // If editted block has changed
                    if(b){
                        let block = pack['map'][tformula(b.x,b.y)];
                        document.getElementById('game-ui-build-edit').classList.remove('d-none');
                        // Get id
                        let id;
                        if (typeof block == "object") id = block.id;
                        else id = block;
                        // Change name
                        document.getElementById('game-ui-build-edit-title').innerHTML = Object.getOwnPropertyNames(BLOCK_NAMES)[id];
                        // Change block preview sprite/color
                        document.getElementById('game-ui-build-edit-preview').style.backgroundColor = BLOCKS[id].color;

                        // Disable delete button if block is not deletable
                        if(id < BLOCK_NAMES.PLATFORM) document.getElementById('game-ui-build-btn-delete').disabled = true;
                        else document.getElementById('game-ui-build-btn-delete').disabled = false;

                        // Display edited block's message
                        if(block.hasOwnProperty('message')){
                            let m = document.getElementById('game-ui-build-edit-message');
                            m.classList.remove('d-none');
                            m.value = block.message;
                        }
                        else document.getElementById('game-ui-build-edit-message').classList.add('d-none');

                        // Display edited block's type selection
                        if(block.hasOwnProperty('type')){
                            document.getElementById('game-ui-build-edit-types').classList.remove('d-none');
                            let t = document.getElementById('game-ui-build-edit-types');
                            t.classList.remove('d-none');
                            // Clear dropdown list of previous
                            while (t.firstChild) t.removeChild(t.firstChild);
                            // Populate select dropdown with type options
                            BLOCKS[block.id].types.forEach(type => {
                                let option = document.createElement("option");
                                option.text = type;
                                option.value = type;
                                if (type == block.type) option.selected = 'selected';
                                t.appendChild(option);
                            });
                        }
                        else document.getElementById('game-ui-build-edit-types').classList.add('d-none');
                    } 
                    else document.getElementById('game-ui-build-edit').classList.add('d-none');
                }

                previousedit = b;
            }
            else if (i == 'secret'){
                let s = pack['secret'];
                let d = document.getElementById('game-ui-build-secret');
                // If first room, then hide secret select
                if(s == null && !d.parentNode.classList.contains('d-none')) d.parentNode.classList.add('d-none');
                else if (s){
                    // Show if not shown
                    if (d.parentNode.classList.contains('d-none')) d.parentNode.classList.remove('d-none');
                    // Select secret for that room
                    document.getElementById('game-ui-build-secret').childNodes.forEach(option => {
                        if(s == option.value) option.selected = 'selected';
                    });
                }
            }
            else { // Render players
                if(pack[i].holding) {
                    if (typeof pack[i].holding === "object") ctx.fillStyle = BLOCKS[pack[i].holding.id].color;
                    else ctx.fillStyle = BLOCKS[pack[i].holding].color;
                    ctx.fillRect(pack[i].x, pack[i].y-TILE/2, TILE/2, TILE/2);
                }
                ctx.fillStyle = 'pink';
                ctx.fillRect(pack[i].x, pack[i].y, pack[i].w, pack[i].h);
                ctx.fillStyle = 'red';
                ctx.fillRect(pack[i].x, pack[i].y, 1, 1);
            }
        }
    }
    function keycontrols(ev, down) {
        if (ev.target.nodeName.toLowerCase() !== 'input') {
            switch(ev.keyCode) {
                // Movement
                case KEY.LEFT: ev.preventDefault(); socket.emit('keyPress', {inputId:'left', state: down}); break;
                case KEY.A: socket.emit('keyPress', {inputId:'left', state: down}); break;
                case KEY.RIGHT: ev.preventDefault(); socket.emit('keyPress', {inputId:'right', state: down}); break;
                case KEY.D: socket.emit('keyPress', {inputId:'right', state: down}); break;
                case KEY.UP: ev.preventDefault(); socket.emit('keyPress', {inputId:'up', state: down}); break;
                case KEY.SPACE: ev.preventDefault(); socket.emit('keyPress', {inputId:'up', state: down}); break;
                case KEY.W: socket.emit('keyPress', {inputId:'up', state: down}); break;
                case KEY.E: socket.emit('keyPress', {inputId:'interact', state: down}); break;
            }
        }
    }
})();