/**
 *
 * All the libraries that we're using for this app
 */
const app = require('express')();
const fs = require('fs');
const https = require('https');
const http = require('http');
// hook up socket.io and our http server to express.js

if(process.env.NODE_ENV === 'production') {
    const options = {
        key: fs.readFileSync('/home/teamword/ssl.key', 'utf8'),
        cert: fs.readFileSync('/home/teamword/ssl.cert', 'utf8')
    };
    var server = https.createServer(options, app);
} else {
    var server = http.createServer({}, app);
}

const io = require('socket.io')(server);

import Room from './src/Room';
import User from './src/User';
import config from './src/config'

/**
 * Constants
 */
const PORT = process.env.PORT || 4001;

/**
 * Instance Variables
 */
const rooms = {};

/**
 * The starting point for a user connecting to our lovely little multiplayer
 * server!
 */
io.on('connection', (socket) => {

    // give each socket a random identifier so that we can determine who is who when
    // we're sending messages back and forth!
    // socket.id = nanoid();
    socket.on('gameStart', (settings) => {
        const room = rooms[socket.roomId];
        if(room) {
            room.setSettings( settings );
            room.createTeams();
            room.broadcast('addTeams', room.getTeamsState());
            room.startGame();
        }
    });

    /**
     * Gets fired when a user wants to create a new room.
     */
    socket.on('createRoom', (data, callbackFn) => {
        const room = new Room();
        room.settings = data.settings;
        rooms[room.id] = room;
        const user = new User(socket.id, socket, data.username, true, data.avatar);
        room.addUser(user);
        socket.emit('usersState', room.getUsersState());
        callbackFn({
            roomID: room.id
        });

    });

    /**
     * Gets fired when a player has joined a room.
     */
    socket.on('joinRoom', (data, callbackFn) => {
        const room = rooms[data.roomID];
        if(room && room.users.length < config.MAX_PLAYERS_PER_ROOM && !room.gameStarted ) {
            const user = new User(socket.id, socket, data.username, false, data.avatar);
            room.addUser(user);

            socket.emit('usersState', room.getUsersState());

            callbackFn({
                roomID: data.roomID,
                settings: room.settings
            });
        } else {
            callbackFn({
                roomID: false
            });
        }
    });

    /**
     * Gets fired when the host changed settings
     */
    socket.on('settingsChange', (msg) => {
        if(socket.roomId) {
            const room = rooms[socket.roomId];
            const user = room.getCurrentUser(socket);
            if(room) {
                room.settings = msg;
                room.broadcast('settingsChange', msg, user);
            }
        }
    });


    /**
     * Gets fired when a player has written a word
     */
    socket.on('wroteWord', (msg) => {
        if(socket.roomId) {
            const room = rooms[socket.roomId];
            const user = room.getCurrentUser(socket);
            if(room) {
                room.broadcast('wroteWord', msg);
                room.nextUser();

                room.broadcastToTeam('nextUser', room.getActiveUser().describe());
            }
        }
    });

    /**
     * Gets fired when a player choose the word
     */
    socket.on('wordChoosen', (msg) => {
        if(socket.roomId) {
            const room = rooms[socket.roomId];
            if(room) {
                room.round.word = msg;
                room.round.startTime = Date.now();
                room.startRound();
            }
        }
    })

    /**
     * Gets fired when a player sends a chat
     */
    socket.on('chatMsg', (msg) => {
        if(socket.roomId) {
            const room = rooms[socket.roomId];
            const user = room.getCurrentUser(socket);
            const round = room.round;
            if (round && round.isActive && room.getActiveTeam()) {
                if (room.getActiveTeamUserIds().includes(user.id)) {
                    room.broadcastChatMsgToCorrectGuessers({
                        msg: msg.msg,
                        type: 'normal',
                        username: user.username,
                    });
                    return;
                }
                if (round.didUserGuess(user.id)) {
                    room.broadcastChatMsgToCorrectGuessers({
                        msg: msg.msg,
                        type: 'normal',
                        username: user.username,
                    });
                } else {
                    if (round.word === msg.msg) {
                        user.socket.emit('chatMsg', {
                            msg: msg.msg,
                            type: 'good',
                            username: user.username,
                        });
                        room.broadcastChatMsgToCorrectGuessers({
                            msg: msg.msg,
                            type: 'good',
                            username: user.username,
                        });
                        room.broadcastChatMsg({
                            type: 'good',
                            username: user.username,
                            systemMsg: `game.guessedCorrectly`,
                        });
                        round.assignUserScore(user.id);

                        if (
                            round.didEveryoneGuessCorrectly(room.getActiveTeamUserIds(), room.users)
                        ) {
                            clearTimeout(room.endRoundTimeOut);
                            room.endRound();
                            room.endRoundTimeOut = setTimeout(
                                () => room.startNextRound(),
                                config.ROUND_DELAY
                            );
                        }
                    } else {
                        // chat is outside round, eg. in pause between rounds
                        room.broadcastChatMsg({ ...msg, username: user.username });
                    }
                }
            } else {
                room.broadcastChatMsg({ ...msg, username: user.username });
            }
        }
    });

    /**
     * Gets fired when a player disconnects from the server.
     */
    socket.on('disconnect', () => {
        if(socket.roomId) {
            const room = rooms[socket.roomId];
            if(room) {
                const user = room.getCurrentUser(socket);
                if(user) {
                    if(user.isHost) {
                        delete rooms[room.id];
                        room.exitGame();
                    } else {
                        room.removeUser(user);
                        room.endGame();
                    }
                } else {
                    room.endGame();
                }

                // delete room, if no users left
                if(room.users.length === 0) {
                    delete rooms[room.id];
                }
            }
        }
    });
});

server.listen(PORT, function() {
    console.log(`listening on *:${PORT}`);
});