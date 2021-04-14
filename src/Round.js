import fs from 'fs';
import config from './config';
import User from './User';

class Round {
    constructor( settings ) {
        this.settings = settings;
        this.words = JSON.parse(fs.readFileSync(`${__dirname}/../words/${settings.language}.json`).toString());
        this.word = false;
        this.chooseWords = this.pickRandomWords();
        this.hintsLeft = 0;
        this.hintCount = 0;
        this.timeToComplete = parseInt(settings.roundTime,10);
        this.startTime = Date.now();
        this.isActive = true;
        this.userScores = {};
    }

    pickRandomWords() {
        let shuffeld = [...this.words];
        for (let i = shuffeld.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffeld[i], shuffeld[j]] = [shuffeld[j], shuffeld[i]];
        }
        return shuffeld.slice(0,3);
    }

    determineHintCount() {
        const runeCount = this.word.length;
        if (runeCount <= 2) {
            this.hintCount = 0;
        } else if (runeCount <= 4) {
            this.hintCount = 1;
        } else if (runeCount <= 6) {
            this.hintCount = 2;
        } else if (runeCount <= 9) {
            this.hintCount = 3;
        } else {
            this.hintCount = 4;
        }
        this.hintsLeft = this.hintCount;
    }

    didUserGuess(userId) {
        return Boolean(this.userScores[userId]);
    }

    didEveryoneGuessCorrectly(activeUserIds, users) {
        for (const user of users) {
            if (activeUserIds.includes(user.id)) {
                continue;
            }

            if (this.userScores[user.id] === undefined) {
                return false;
            }
        }
        return true;
    }

    assignUserScore( userId ) {
        let declineFactor = 1.0 / this.settings.roundTime;
        const secondsLeft = (Date.now() - this.startTime) / 1000;
        // console.log('SL:', secondsLeft);


        let baseScore = config.MAX_BASE_SCORE * Math.pow(1.0 - declineFactor, (this.settings.roundTime - secondsLeft));
        // console.log('BS:',baseScore);
        let score = 0;

        //Every hint not shown, e.g. not needed, will give the player bonus points.
        if (this.hintCount < 1) {
            score = baseScore
        } else {
            score = baseScore + this.hintsLeft * (config.MAX_HINT_BONUS_SCORE / this.hintCount);
        }

        this.userScores[userId] = Math.round(score);
    }

    getScores(activeUsers, users) {
        const userScoresFinal= {};
        let correctGuesses = 0;

        let activeUserIds = [];
        activeUsers.forEach((user) => {
            activeUserIds.push(user.id);
        });

        for (const user of users) {
            // except team from normal scoring
            if (activeUserIds.includes(user.id)) {
                continue;
            }
            const score = this.userScores[user.id];
            if (score !== undefined) {
                correctGuesses++;
                userScoresFinal[user.id] = this.userScores[user.id];
            } else {
                userScoresFinal[user.id] = 0;
            }
        }
        // set points for team users
        activeUsers.forEach((user) => {
            userScoresFinal[user.id] = Math.round(
                (correctGuesses / (users.length - activeUsers.length)) * ( config.MAX_BASE_SCORE / activeUsers.length)
            );
        });
        return userScoresFinal;
    }
}

export default Round;