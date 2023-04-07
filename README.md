# Simple tool for recording and replaying twitch IRC messages

# Usage

1. Record chat messages from channel
```bash
node record.js "#myfavouritechannel" example_recording.txt
```
2. Start replay server
```bash
node replay.js -p 8080 -r 10 example_recording.txt
```
3. Connect your chatbot to the server (see example.js for details)
```javascript
const tmi = require('tmi.js');

const client = new tmi.Client({
  connection: {
    server: 'localhost',
    port: 8080,
    secure: false,
  },
  identity: {
    username: 'test',
    password: 'oath:the_server_will_not_check_this',
  },
  channels: ["#myfavouritechannel"],
  options: {
    debug: true,
  },
});

client.connect();
```
