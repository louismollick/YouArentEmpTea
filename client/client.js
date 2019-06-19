(function() { // module pattern
    const SIZE   = { tw: 30, th: 30},
        TILE     = 20,
        COLOR    = { WHITE: '#ffffff',BLACK: '#000000', YELLOW: '#ECD078', BRICK: '#D95B43', PINK: '#C02942', PURPLE: '#542437', GREY: '#333', SLATE: '#53777A', GOLD: 'gold', GREEN: '#26A65B'},
        KEY      = { ESC: 27, R: 82, W: 87, A: 65, D: 68, R: 82, SPACE: 32, LEFT: 37, UP: 38, RIGHT: 39 },
        BLOCKS   = { NULL: 0, SPAWN: 1, GOAL: 2, BEDROCK: 3,  BRICK: 4, WOOD: 5 },
        MOUSE_OFFSET = {x: -TILE/2, y: -TILE/2};
    
    let width    = SIZE.tw * TILE;
    let height   = SIZE.th * TILE;
    let canvas   = document.getElementById('game-canvas');
    let ctx      = canvas.getContext('2d');
    
    canvas.width  = width;
    canvas.height = height;

    let socket = io();

    // Selected Block in Game Build panel;
    let sblock = null;

    //-------------------------------------------------------------------------
    // SOCKET EVENTS
    //-------------------------------------------------------------------------

    socket.on('error', console.error);

    socket.on('discord-login', function(data){
        console.log('Setting cookies...');
        // Set cookies for next login
        document.cookie = `id=${data.id};path=/`;
        document.cookie = `token=${data.access_token};path=/`;

        console.log('Displaying login info');
        // Update page with login info

    });

    socket.on('game-show',function(){
        // Hide main menu and show game canvas
        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('game').style.display = 'inline-block';
    });

    socket.on('game-build',function(bool){
        if(bool) document.getElementById('game-ui-build-panel').style.display = 'inline-block';
        else document.getElementById('game-ui-build-panel').style.display = 'none';
    });

    document.onclick = function(e){
        // On join button click
        if (e.target.classList.contains('join')){
            // Event propogation -- find lobbyid corresponding to join button pressed
            let levelid = e.target.parentNode.previousElementSibling.innerHTML;
            socket.emit('game-join', levelid);
        }
        // On game build block click
        if (e.target.classList.contains('block')){
            // Set selected block
            sblock = e.target.id;

            // Highlight selected block
            e.target.classList.push('selected'); // REEEEEEEEEEEEEEEEEEEE
        }
    }
    document.getElementById('menu-button-login').onclick = function(){
        socket.emit('discord-login');
    }

    document.getElementById('main-menu-btn-room').onclick = function(){
        socket.emit('game-join'); // By default is socket's room
    }

    document.getElementById('menu-button-main').onclick = function(){
        socket.emit('game-leave');
    }

    socket.on('update', function(pack){
        render(ctx, pack);
    });

    //-------------------------------------------------------------------------
    // GAME RENDERING
    //-------------------------------------------------------------------------

    function t2p(t)     { return t*TILE;                     }; // tile to point
    function p2t(p)     { return Math.floor(p/TILE);         }; // point to tile
    function tformula(tx,ty) {return tx + (ty*SIZE.tw)       }; // tile to array index
    function pformula(x,y)   {return tformula(p2t(x),p2t(y)) }; // point to array index

    function render(ctx,pack){
        ctx.clearRect(0, 0, width, height);
        for (i in pack){
            if (i === 'map'){
                // Render map
                for(let y = 0 ; y < SIZE.th ; y++) {
                    for(let x = 0 ; x < SIZE.tw ; x++) {
                        let cell = pack[i][tformula(x,y)];;
                        if (cell){
                            if (cell == BLOCKS.BEDROCK) ctx.fillStyle = COLOR.BLACK;
                            else if (cell == BLOCKS.GOAL) ctx.fillStyle = COLOR.PURPLE;
                            else if (cell == BLOCKS.BRICK) ctx.fillStyle = COLOR.BRICK;
                            else if (cell == BLOCKS.SPAWN) ctx.fillStyle = COLOR.WHITE;
                            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
                        }
                    }
                }
            }
            else{ // Render players
                ctx.fillStyle = COLOR.PINK;
                ctx.fillRect(pack[i].x, pack[i].y, TILE, TILE);
            }
        }
    }
    function keycontrols(ev, down) {
        switch(ev.keyCode) {
            // Movement
            case KEY.LEFT: ev.preventDefault(); socket.emit('keyPress', {inputId:'left', state: down}); break;
            case KEY.A: socket.emit('keyPress', {inputId:'left', state: down}); break;
            case KEY.RIGHT: ev.preventDefault(); socket.emit('keyPress', {inputId:'right', state: down}); break;
            case KEY.D: socket.emit('keyPress', {inputId:'right', state: down}); break;
            case KEY.UP: ev.preventDefault(); socket.emit('keyPress', {inputId:'up', state: down}); break;
            case KEY.SPACE: ev.preventDefault(); socket.emit('keyPress', {inputId:'up', state: down}); break;
            case KEY.W: socket.emit('keyPress', {inputId:'up', state: down}); break;
        }
    }

    // EVENTS
    document.addEventListener("keydown", function (ev){ keycontrols(ev,true);}, false);
    document.addEventListener('keyup', function(ev) { keycontrols(ev,false);}, false);
    canvas.addEventListener("mousedown", function(ev){
        // Make the click the tip of the cursor, not middle
        let x = ev.clientX+MOUSE_OFFSET.x;
        let y = ev.clientY+MOUSE_OFFSET.y;

        // Ask to place block
        socket.emit('keyPress', {inputId:'mouse',state:{x: x,y: y, block: sblock}});
    }, false);
})();