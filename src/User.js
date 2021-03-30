class User {
    constructor(id, socket, username, isHost, avatar) {
        this.id = id;
        this.socket = socket;
        this.score = 0;
        this.username = username;
        this.avatar = avatar;
        this.isHost = isHost;
    }
    describe() {
        return {
            id: this.id,
            username: this.username,
            score: this.score,
            avatar: this.avatar,
            isHost: this.isHost
        };
    }
}

export default User;
