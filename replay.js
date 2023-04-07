'use strict';
const fs = require('fs');
const readline = require('readline');
const {WebSocket, WebSocketServer} = require('ws');
const {sleep} = require('./util.js');

const yargs = require('yargs/yargs');
const {hideBin} = require('yargs/helpers');
/**
 *
 * @return {object} Parsed arguments
 */
function parseCmdArgs() {
  const args = yargs(hideBin(process.argv))
      .command('* [-p port] [-r rate] <file>', 'Replay recorded events')
      .alias('p', 'port')
      .default('p', 8080)
      .describe('p', 'Port to serve from')
      .alias('r', 'rate')
      .default('r', 1)
      .describe('r', 'Replay rate')
      .positional('file', {
        describe: 'Input file',
        type: 'string',
      })
      .help()
      .argv;
  return {
    paybackRatio: args.rate,
    port: args.port,
    inputFile: args.file,
  };
}

/**
 *
 * @param {string} inputFile
 * @return {Promise<object>}
 */
function getWelcomeMessages(inputFile) {
  return new Promise((resolve) => {
    const readable = fs.createReadStream(inputFile);
    const reader = readline.createInterface({input: readable});
    const lines = [];
    let welcomeEndPos = 0;
    let resolved = false;
    reader.on('line', (line) => {
      if (resolved) return;
      ++welcomeEndPos;
      if (line.indexOf('366') >= 0) {
        resolved = true;
        reader.close();
        resolve({lines, welcomeEndPos});
        return;
      }
      lines.push(line);
    });
  });
}

/**
   *
   * @param {string} inputFile
   *
   * @return {object}
   */
async function getInitalChannelState(inputFile) {
  let roomState = '';
  let channelName = '';
  const events353 = [];

  const {lines, welcomeEndPos} = await getWelcomeMessages(inputFile);
  for (const line of lines) {
    if (line.indexOf('ROOMSTATE') >= 0) {
      roomState = line;
      continue;
    }
    const channelNameMatch = line.match(/.*JOIN (?<channelName>.+)/);
    if (channelNameMatch) {
      channelName = channelNameMatch.groups.channelName;
      continue;
    }
    const patternNames =
        /^:[a-zA-Z0-9]+\.tmi\.twitch\.tv 353.+?#[a-zA-Z]+ :(?<names>.+)$/;
    const matchNames = line.match(patternNames);

    if (matchNames) {
      const names = matchNames.groups.names;
      if (names.endsWith('justinfan123')) {
        continue;
      }
      events353.push(names);
    }
  }


  return {
    channelName, roomState, events353, welcomeEndPos,
  };
}


/**
 *
 * @param {WebSocket} ws
 * @param {number} paybackRatio
 * @param {string} inputFile
 * @param {object} initialChannelState
 */
async function doReplay(ws, paybackRatio, inputFile, initialChannelState) {
  const fileStream = fs.createReadStream(inputFile);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let prevMessageTs = null;
  let index = 0;
  console.log('Starting replay');
  for await (const line of rl) {
    if (index++ <= initialChannelState.welcomeEndPos) continue;
    if (!line) continue;
    const timestampPattern = /tmi-sent-ts=(?<ts>\d+)/;
    const timestampMatch = line.match(timestampPattern);
    let ts = prevMessageTs;
    if (timestampMatch) {
      ts = parseInt(timestampMatch.groups.ts);
    } else {
      console.log('Warning: line without timestamp info!');
    }

    if (prevMessageTs !== null) {
      const delay = (ts - prevMessageTs) / paybackRatio;
      await sleep(delay);
    }

    if (ws.readyState !== WebSocket.OPEN) {
      console.log('Stopping replay because the client disconnected');
      break;
    }

    const replacementTs = Date.now();
    const replacedLine =
        line.replace(timestampPattern,
            '$`tmi-sent-ts=' + replacementTs + '"$\'');
    prevMessageTs = ts;
    ws.send(replacedLine);
  }
}

/**
 *
 * @param {WebSocket} ws
 * @param {string} caps
 * @param {string} nick
 */
function sendWelcomeMsg(ws, caps, nick) {
  console.log('Sending welcome messages');
  ws.send(`:tmi.twitch.tv CAP * ACK ${caps}`);
  ws.send(`:tmi.twitch.tv 001 ${nick} :Welcome, GLHF!`);
  ws.send(`:tmi.twitch.tv 002 ${nick} :Your host is tmi.twitch.tv`);
  ws.send(`:tmi.twitch.tv 003 ${nick} :This server is rather new`);
  ws.send(`:tmi.twitch.tv 004 ${nick} :-`);
  ws.send(`:tmi.twitch.tv 375 ${nick} :-`);
  ws.send(`:tmi.twitch.tv 372 ${nick} ` +
           `:You are in a maze of twisty passages, all alike.`);
  ws.send(`:tmi.twitch.tv 376 ${nick} :>`);
}

/**
 *
 * @param {WebSocket} ws
 * @param {string} nick
 * @param {object} initialChannelState
 */
function sendChannelState(ws, nick, initialChannelState) {
  console.log('Sending channel state messages');
  // TODO: This shoudn't be hardcoded
  ws.send(`@badge-info=;badges=;color=;display-name=${nick};`+
          `emote-sets=;mod=0;subscriber=0;turbo=0;user-type=""`+
          ` :tmi.twitch.tv USERSTATE ${initialChannelState.channelName}`);
  ws.send(`:${nick}!${nick}@${nick}.tmi.twitch.tv ` +
           `JOIN ${initialChannelState.channelName}`);
  console.log(initialChannelState.roomState);
  ws.send(initialChannelState.roomState);
  const names = initialChannelState.events353;
  for (const line of names) {
    ws.send(`:${nick}.tmi.twitch.tv 353 ` +
            `${nick} = ${initialChannelState.channelName} ${line}`);
  }
  ws.send(`:${nick}.tmi.twitch.tv 353 ` +
          `${nick} = ${initialChannelState.channelName} :${nick}`);
  ws.send(`:${nick}.tmi.twitch.tv 366 ` +
          `${nick} ${initialChannelState.channelName} :End of /NAMES list`);
}


/**
 *
 * @param {number} paybackRatio
 * @param {number} port
 * @param {string} inputFile
 * @param {object} initialChannelState
 */
function startWebSocketServer(paybackRatio, port,
    inputFile, initialChannelState) {
  const wss = new WebSocketServer({port});
  wss.on('connection', (ws) => {
    let caps = '';
    let nick = '';
    let joined = false;
    let welcomeSend = false;

    ws.on('close', () => {
      console.log('Client disconnected!');
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        console.log('Unexpected binary data!');
        return;
      }
      const message = data.toString();
      console.log(message);
      if (message.startsWith('CAP REQ')) {
        caps = message.substring('CAP REQ'.length+1);
      }

      if (message.startsWith('NICK')) {
        nick = message.substring('NICK'.length+1);
      }

      if (nick && caps && !welcomeSend) {
        sendWelcomeMsg(ws, caps, nick);
        welcomeSend = true;
      }

      if (message.startsWith('PING')) {
        ws.send('PONG');
        return;
      }


      if (message.startsWith('JOIN')) {
        const requestedChannel = message.substring('NICK'.length+1);
        if (requestedChannel !== initialChannelState.channelName || joined) {
          return;
        }
        joined = true;
        sendChannelState(ws, nick, initialChannelState);
        doReplay(ws, paybackRatio, inputFile, initialChannelState);
      }
    });
  });
}

/**
 * program entry point
 */
async function main() {
  const {paybackRatio, port, inputFile} = parseCmdArgs();
  const initialChannelState = await getInitalChannelState(inputFile);
  console.log(`Replaying channel ${initialChannelState.channelName}`);
  startWebSocketServer(paybackRatio, port, inputFile, initialChannelState);
}


main();
