const tmi = require('tmi.js');
const yargs = require('yargs/yargs');
const {hideBin} = require('yargs/helpers');

const args = yargs(hideBin(process.argv))
    .command('* <channel>',
        'Example client that connects to test server and displays all messages')
    .positional('channel', {
      describe: 'Channel name (prefixed with #)',
      type: 'string',
    })
    .help()
    .argv;


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
  channels: [args.channel],
  options: {
    debug: true,
  },
});

client.connect();
client.on('connected', console.log.bind(console));
client.on('submysterygift', console.log.bind(console));

client.on('message', (channel, tags, message, self) => {
  console.log(`${tags['display-name']}: ${message}`);
});
