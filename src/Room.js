import config from './config';
import Round from './Round';

const { nanoid } = require('nanoid');

export default class Room {
    constructor() {
        this.sockets = [];
        this.users = [];
        this.teams = [];
        this.writingState = [];
        this.gameStarted = false;
        this.canStart = false;
        this.activeUserIdx = 0;
        this.activeTeamIdx = 0;
        this.round = null;
        this.roundsPlayed = 0;
        this.settings = {};
        this.hintInterval = null;
        this.endRoundTimeOut = null;
        this.id = nanoid(10);
        // this.id = 'AA'; // <= only for testing
    }

    getCurrentUser( socket ) {
        return this.users.find( user => user.id === socket.id );
    }

    setSettings( settings ) {
        this.settings = settings;
    }

    addUser(user) {
        if (this.users.length > config.MAX_PLAYERS_PER_ROOM) {
            throw new Error('too many players');
        }
        this.users.push(user);
        this.broadcast('userJoin', user.describe());

        user.socket.join(this.id);

        // store the room id in the socket for future use
        user.socket.roomId = this.id;

        if (this.users.length < config.MIN_PLAYERS_PER_ROOM) {
            setTimeout(
                () =>
                    this.setCanStart( false ),
                    this.broadcastRoomStatus(config.MIN_PLAYERS_PER_ROOM - this.users.length),
                50
            );
        } else {
            setTimeout(
                () =>
                    this.setCanStart( true ),
                this.broadcastRoomStatus(0),
                50
            );
        }
    }

    removeUser(user) {
        // leave room
        if(typeof user !== 'undefined' && user.socket) {
            user.socket.leave(this.id);

            // remove from list
            this.users = this.users.filter((usr) => usr.id !== user.id);
            this.createTeams(false);

            // tell others
            this.broadcastChatMsg({
                type: 'bad',
                msg: `${user.username} has left the game`,
            });
            this.broadcast('userLeave', user.describe());
        }
    }

    isFull() {
        return this.users.length === config.MAX_PLAYERS_PER_ROOM;
    }

    broadcast(
        msg,
        payload,
        excludedUser= undefined
    ){
        this.users.forEach((user) => {
            if (!excludedUser || (excludedUser && user.id !== excludedUser.id)) {
                user.socket.emit(msg, payload);
            }
        });
    }

    broadcastToGuessers(
        msg,
        payload
    ) {
        let activeUserIds = this.getActiveTeamUserIds();

        for (const user of this.users) {
            if (activeUserIds.includes(user.id)) {
                continue;
            }
            user.socket.emit(msg, payload);
        }
    }

    broadcastToTeam(
        msg,
        payload
    ) {
        this.getActiveTeam().forEach((user) => {
            user.socket.emit(msg, payload);
        })
    }

    /**
     * Returns an array with arrays of the given size.
     *
     * @param myArray {Array} Array to split
     * @param chunkSize {Integer} Size of every group
     */
   chunkArray(myArray, chunk_size) {
        var results = [];

        while (myArray.length) {
            if(myArray.length < chunk_size * 2) {
                results.push(myArray.splice(0, 3));
            } else {
                results.push(myArray.splice(0, chunk_size));
            }
        }

        return results;
    }

    /**
     * Returns an array with random users in team chunks (min 2, max 3)
     */
    createTeams( doShuffle=true ) {
        let shuffeld = [...this.users];
        if(doShuffle) {
            for (let i = shuffeld.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffeld[i], shuffeld[j]] = [shuffeld[j], shuffeld[i]];
            }
        }
        let teams = this.chunkArray(shuffeld,2);
        this.teams = teams;
    }

    toTeam( user, fromTeam, toTeam) {
        this.teams[toTeam].push(user);
        this.teams[fromTeam].forEach( (teamuser, idx) => {
            if(user.id === teamuser.id) {
                this.teams[fromTeam].splice(idx,1);
            }
        });
    }

    getUsersState() {
        return this.users.map((user) => user.describe());
    }
    getTeamsState() {
        return this.teams.map((team) => {
            return team.map((user) => user.describe());
        });
    }

    teamsAreValid() {
        let valid = true;
        this.teams.forEach((team) => {
           if( team.length < 2) {
               valid = false;
           }
        });

        return valid;
    }

    broadcastChatMsg(msg, excludedUser ) {
        this.broadcast('chatMsg', msg, excludedUser);
    }

    broadcastChatMsgToCorrectGuessers( msg ) {
        const correctGuessers = this.users.filter((user) =>
            this.round.didUserGuess(user.id)
        );
        this.getActiveTeam().forEach((user) => correctGuessers.push(user));
        correctGuessers.forEach((user) => user.socket.emit('chatMsg', msg));
    }

    broadcastRoomStatus( msg ) {
        this.broadcast('roomStatus', msg);
    }

    setCanStart( msg ) {
        this.canStart = true;
        this.broadcast('canStart',msg);
    }

    startGame() {
        if(!this.gameStarted && this.canStart) {
            this.broadcast('gameStart', {
                rounds: this.settings.rounds,
                users: this.getUsersState()
            });
            this.gameStarted = true;
            // reset round data
            this.roundsPlayed = 0;
            this.activeUserIdx = 0;
            this.activeTeamIdx = 0;

            this.prepareStartRound();
        }
    }

    getActiveUser() {
        return this.teams[this.activeTeamIdx][this.activeUserIdx];
    }

    getActiveTeam() {
        return this.teams[this.activeTeamIdx];
    }

    getActiveTeamUserIds() {
        let activeUserIds = [];
        this.teams[this.activeTeamIdx].forEach((user) => {
            activeUserIds.push(user.id);
        });
        return activeUserIds;
    }

    prepareStartRound() {
        if(!this.gameStarted) return;
        this.round = new Round( this.settings );
        this.broadcast('prepareStart', {
            words: this.round.chooseWords,
            activeUser: this.getActiveUser().describe()
        });
    }

    startRound() {
        if(!this.gameStarted) return;
        // this.round = new Round( this.settings );
        const roundInfo = this.getRoundInfo();
        this.broadcast('roundStart', {
            ...roundInfo,
            word: roundInfo.word.replace(/\S/gs, '_'),
            rlWord: roundInfo.word
        });

        this.broadcast('nextUser', this.getActiveUser().describe());

        // start hinting
        this.startHinting();

        this.endRoundTimeOut = setTimeout(() => {
            this.endRound();
            setTimeout(() => this.startNextRound(), config.ROUND_DELAY);
        }, this.round.timeToComplete);
    }

    startHinting() {
        this.round.determineHintCount();
        let revealHintEveryXMilliseconds = Math.round(this.round.timeToComplete  / (this.round.hintCount + 1));
        let len = this.round.word.length - 1;
        let indexes = [];
        for( let i = 0; i <= len; i++) {
            indexes.push(i);
        }

        let asdf = indexes.sort(function(){return 0.5-Math.random()});
        let hintedWords = [];
        let hintWord = this.round.word.replace(/\S/gs, '_').split('');
        let realWord = this.round.word.split('');

        for( let j = 0; j <= this.round.hintCount -1; j++) {
            let key = asdf.shift()
            hintWord[key] = realWord[key];
            hintedWords.push(hintWord.join(''));
        }

        this.broadcastToTeam( 'wordHint', realWord);

        this.hintInterval = setInterval( () => {
            let hintWord = hintedWords.shift();
            this.broadcastToGuessers( 'wordHint', hintWord);
            // this.broadcast( 'wordHint', hintWord);
            this.round.hintsLeft--;
            if(this.round.hintsLeft === 0) {
                clearInterval(this.hintInterval);
            }
        }, revealHintEveryXMilliseconds);
    }

    endRound(activeUser) {
        clearInterval(this.hintInterval);
        if (!activeUser) {
            activeUser = this.getActiveUser();
        }
        if (!activeUser) {
            return;
        }
        if (!this.round) {
            return;
        }
        this.broadcast('wordReveal', this.round.word);
        this.broadcast('roundEnd', 1);
        this.round.isActive = false;
        const roundScores = this.round.getScores(this.teams[this.activeTeamIdx], this.users);
        this.broadcast('roundScores', roundScores);
        for (const user of this.users) {
            user.score += roundScores[user.id];
        }
    }

    addToWritingState( word ) {
        this.writingState.push( word );
    }

    clearToWritingState() {
        this.writingState = [];
    }

    nextUser() {
        this.activeUserIdx++;
        let playersInTeam = this.teams[this.activeTeamIdx].length;

        if(this.activeUserIdx >= playersInTeam) {
            this.activeUserIdx = 0;
        }
    }

    startNextRound() {
        if(!this.gameStarted) return;
        this.activeTeamIdx++;
        this.activeUserIdx = 0;
        this.writingState = [];

        // every teams turn
        if (this.activeTeamIdx >= this.teams.length) {
            this.roundsPlayed++;
            this.activeTeamIdx = 0;
            this.activeUserIdx = this.alternatePlayer();
            if(this.roundsPlayed >= this.settings.rounds) {
                this.endGame();
            } else {
                this.prepareStartRound();
            }
        } else {
            this.activeUserIdx = this.alternatePlayer();
            this.prepareStartRound();
        }
    }

    alternatePlayer() {
        let activeTeamLength = this.teams[this.activeTeamIdx].length;
        return ((this.roundsPlayed+1) % activeTeamLength === 0) ? activeTeamLength -1 : ((this.roundsPlayed+1) % activeTeamLength) -1;
    }

    getRoundInfo() {
        if (!this.round) {
            throw new Error();
        }

        let currentTeamNo = this.activeTeamIdx + 1;
        let nextTeamNo = currentTeamNo +1;
        if(nextTeamNo > this.teams.length) {
            nextTeamNo = 1;
        }

        return {
            startTime: this.round.startTime,
            timeToComplete: this.round.timeToComplete,
            word: this.round.word,
            chooseWords: this.roundsPlayed.chooseWords,
            roundNo: this.roundsPlayed + 1,
            activeTeamIdx: this.activeTeamIdx,
            teamsLength: this.teams.length,
            nextTeamNo: nextTeamNo
        };
    }

    endGame() {
        this.gameStarted = false;
        clearTimeout(this.endRoundTimeOut);
        clearInterval(this.hintInterval);
        this.broadcast('gameEnd', 1);

        for (const user of this.users) {
            user.score = 0;
        }
    }

    exitGame() {
        this.gameStarted = false;
        clearTimeout(this.endRoundTimeOut);
        clearInterval(this.hintInterval);
        this.broadcast('exitGame', 1);
    }
}