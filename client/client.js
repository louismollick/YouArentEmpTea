(function() { // module pattern
    const SIZE   = { tw: 19, th: 8};
    const TILE     = 10;
    const KEY      = { ESC: 27, R: 82, W: 87, A: 65, D: 68, E: 69, SPACE: 32, LEFT: 37, UP: 38, RIGHT: 39 };
    const BLOCK_NAMES = { VOID: 0, DOOR_LEFT: 1, DOOR_RIGHT: 2, BEDROCK: 3,  PLATFORM: 4, NPC: 5, KEY: 6};
    const BLOCKS = [
        {id: BLOCK_NAMES.VOID},
        {id: BLOCK_NAMES.DOOR_LEFT, color: 'blue'},
        {id: BLOCK_NAMES.DOOR_RIGHT, color: 'red'},
        {id: BLOCK_NAMES.BEDROCK, color: 'black'},
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

    //-------------------------------------------------------------------------
    // SOCKET EVENTS
    //-------------------------------------------------------------------------

    socket.on('error', console.error);

    socket.on('print', function(data){console.log("printing... ", data);});

    socket.on('game-npc-talk', function(message){
        alert(message);
    });

    socket.on('discord-login', function(data){
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

    socket.on('game-show-res',function(build){
        // Hide main menu and show game canvas
        document.getElementById('main-menu').classList.add('d-none');
        document.getElementById('game').classList.remove('d-none');

        // If building own room, show build ui panel
        if(build) document.getElementById('game-ui-build').classList.remove('d-none');
        else document.getElementById('game-ui-build').classList.add('d-none');
    });

    socket.on('update', function(pack){
        render(ctx, pack);
    });

    //-------------------------------------------------------------------------
    // DOCUMENT EVENTS
    //-------------------------------------------------------------------------
    document.addEventListener("DOMContentLoaded", function() {
        // Add all placeable blocks to build panel
        for(i=4; i<BLOCKS.length; i++){
            let block = document.createElement('div');
            let b = BLOCKS[i];

            block.classList.add('m-3');
            block.classList.add('block');

            // Set default selected block
            if(b.id === BLOCK_NAMES.PLATFORM) block.classList.add('selected');

            // Set internal block info
            block.dataset.json = b.id;
            
            // REEEEEEEE place with sprite
            block.style.backgroundColor = b.color;

            document.getElementById('game-ui-build-blocks').appendChild(block);
        }
    });
    document.onclick = function(ev){
        // On join button click
        if (ev.target.classList.contains('join')){
            // Event propogation -- find lobbyid corresponding to join button pressed
            let levelid = ev.target.parentNode.previousElementSibling.innerHTML;
            socket.emit('game-join', levelid);
        }
        // On build-ui block selection click
        if (ev.target.classList.contains('block')){
            // Get selected block info 
            let b = BLOCKS[ev.target.dataset.json];

            // Show additional user input ui if necessary
            if(b.message) document.getElementById('game-ui-build-message').classList.remove('d-none');
            else document.getElementById('game-ui-build-message').classList.add('d-none');

            if(b.types){
                let t = document.getElementById('game-ui-build-types');
                t.classList.remove('d-none');

                // Clear dropdown list of previous
                while (t.firstChild) {
                    t.removeChild(t.firstChild);
                }
                // Populate select dropdown with type options
                b.types.forEach(type => {
                    let option = document.createElement("option");
                    option.text = type;
                    option.value = type;
                    t.appendChild(option);
                });
            } 
            else document.getElementById('game-ui-build-types').classList.add('d-none');

            // Remove selected from old selected
            document.getElementsByClassName('selected')[0].classList.remove('selected');

            // Make new block selected
            ev.target.classList.add('selected');
        }
    }
    document.getElementById('menu-button-login').onclick = function(){socket.emit('discord-login');}
    document.getElementById('main-menu-btn-room').onclick = function(){socket.emit('game-join-req');}
    document.getElementById('menu-button-main').onclick = function(){socket.emit('game-leave-req');}
    document.getElementById('game-ui-build-btn-save').onclick = function(){socket.emit('game-build-save');}
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
        console.log(b, typeof b);
        // If selected block is an object-block, create object with user input
        if(BLOCKS[b].object){
            let blockinfo = BLOCKS[b];

            // Create object
            b = {id: b};

            // Add specific attributes
            if(blockinfo.message){
                b.message = document.getElementById('game-ui-build-message').value;
                document.getElementById('game-ui-build-message').value = '';
            } 
            if(blockinfo.types){
                let e = document.getElementById('game-ui-build-types');
                b.type = e.options[e.selectedIndex].value;
            }
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
                            //REEEEEE
                            if (typeof cell === "object") ctx.fillStyle = BLOCKS[cell.id].color;
                            else ctx.fillStyle = BLOCKS[cell].color;
                            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);

                            ctx.fillStyle = 'black';
                            if(cell.type) ctx.fillText(cell.type, x * TILE, y * TILE);
                        }
                    }
                }
            }
            else{// Render players
                if(pack[i].holding) {
                    if (typeof pack[i].holding === "object") ctx.fillStyle = BLOCKS[pack[i].holding.id].color;
                    else ctx.fillStyle = BLOCKS[pack[i].holding].color;
                    ctx.fillRect(pack[i].x, pack[i].y-TILE/2, TILE/2, TILE/2);
                }
                ctx.fillStyle = 'pink';
                ctx.fillRect(pack[i].x, pack[i].y, TILE, TILE);
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