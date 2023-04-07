'use strict';
const fs = require('fs');
const WebSocket = require('ws').WebSocket;
const yargs = require('yargs/yargs');
const {hideBin} = require('yargs/helpers');

const SERVER_URL= 'wss://irc-ws.chat.twitch.tv:443/irc';
const USER = 'justinfan123';


/**
 *
 * @return {object} Parsed arguments
 */
function parseCmdArgs() {
  const args = yargs(hideBin(process.argv))
      .command('* <channel> <output>',
          'Record events from channel into file')
      .positional('file', {
        describe: 'Output file',
        type: 'string',
      })
      .positional('channel', {
        describe: 'Channel name (prefixed with #)',
        type: 'string',
      })
      .help()
      .argv;
  return {
    channelName: args.channel, outputFile: args.output,
  };
}


/**
 * program entry point
 */
function main() {
  const {outputFile, channelName} = parseCmdArgs();
  const file = fs.openSync(outputFile, 'w');
  const ws = new WebSocket(SERVER_URL);
  ws.on('open', () => {
    console.log('Connecting and authenticating...');

    ws.send(`CAP REQ :twitch.tv/tags `+
                      `twitch.tv/commands `+
                      `twitch.tv/membership`);
    ws.send(`NICK ${USER}`);
    ws.send(`JOIN ${channelName}`);
  });
  ws.on('close', () => {
    console.log('Disconnected!');
    fs.fdatasyncSync(file);
    process.exit(0);
  });
  ws.on('message', (data) => {
    const message = data.toString();
    if (message.startsWith('PING')) {
      ws.send('PONG');
      return;
    }
    fs.appendFileSync(file, message + '\n\n');
  });

  process.on('SIGINT', () => {
    console.log('Exiting...');
    ws.close();
    fs.fdatasyncSync(file);
  });
}


main();
