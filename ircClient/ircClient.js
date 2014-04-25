var net = require('net');
var irc = require('irc');
var log = require('../lib/logger.js');
var config = require('./config.js');
var core;
var botNick =  config.botNick;//part of config of IRC client.
var clients = {};//for server channel user,server --> client. 
var servChanProp = {};//object of server channel prop
var rooms = {};//room id to room obj map. //TODO delete room obj if any room deleted irc.(Done Test)
var servNick = {};//server channel nick -------> sb nick.
var renameCallback = {};
var connected = false;
var queue = require("./queue.js");

/******************************* Exports ****************************************/
module.exports.say = say;
module.exports.rename = rename;
module.exports.partBot = partBot;
module.exports.newNick = newNick;
module.exports.partUser = partUser;
module.exports.connectBot = connectBot;
module.exports.connectUser = connectUser;
module.exports.getBotNick = getBotNick;
module.exports.isConnected = isConnected;
module.exports.setConnected = setConnected;
module.exports.sendQueueData = sendQueueData;
module.exports.getCurrentState = getCurrentState;
module.exports.init = function init(coreObj) {
	core = coreObj;
};
/*********************************** Exports ****************************************/

/******************************************
TODO's 
rename IRC user.
handle this error.
ERROR: { prefix: 'irc.local',
  server: 'irc.local',
  command: 'err_erroneusnickname',
  rawCommand: '432',
  commandType: 'error',
  args: 
   [ 'test2',
     'long name' ] }
TODO if room changes b/w restart then discart queuing messages.
//9 char is min max limit if(nick > 9) gen random.
//handle the case if connection is disconnected by other party

******************************************/

/**
 *Server already connected.
 */
function joinChannels(server, nick, channels, cb) {
	var client = clients[nick][server];
	channels.forEach(function(channel) {
		if (client.opt.channels.indexOf(channel) === -1) {
			client.join(channel);
		}
	});
	cb();
	return client;
}
/**
 *Join server if not connected already.
 */
function joinServer(server, nick, channels, options, cb) {
	if (!clients[nick]) clients[nick] = {}; 
	var client = new irc.Client(server, nick, {
			userName : nick,
			realName: nick + '@scrollback.io',
			channels: channels,
			debug: false,
			stripColors: true,
			floodProtection: true,
			identId: options.identId,
			//showErrors: true,
			webircPassword: options.webircPassword,
			userIp : options.userIp,
			userHostName: options.userHostName
		});
	clients[nick][server] = client;
	client.conn.on("connect", cb);
	onError(client);
	return client;
}
/**
 *always actual nick will be used for identify a user
 *opt.identId is used for ident.
 */
function connectBot(room, options, cb) {
	var server = room.params.irc.server;
	var channel = room.params.irc.channel.toLowerCase();
	rooms[room.id] = room;
	if(!servChanProp[server]) {
		servChanProp[server] = {};
	}
	if (!servChanProp[server][channel]) {
		servChanProp[server][channel] = {};
		servChanProp[server][channel].rooms = [];
		servChanProp[server][channel].users = [];
	}
	if (servChanProp[server][channel].rooms.length !== 0) {
		cb("already connected to some other room");
		return;
	}
	servChanProp[server][channel].rooms.push(room);
	var ch = room.params.irc.pending ? [] : [channel];//after varification connect to channel
	if (!servNick[server]) servNick[server] = {};
	var client;
	if (!clients[botNick]) clients[botNick] = {}; 
	if (clients[botNick][server]) {//already connected to server.
		joinChannels(server, botNick, ch, cb);
	} else {
		client = joinServer(server, botNick, ch, options, cb);
		onPM(client);
		onRaw(client);
		onMessage(client);
		onNames(client);
		onJoin(client);
		onNick(client);
		onLeave(client);
	}
}

function partBot(roomId) {
	var room  = rooms[roomId];
	var client = clients[botNick][room.params.irc.server];
	var channel = room.params.irc.channel;
	var server = room.params.irc.server;
	client.part(channel);//disconnect bot in case of all part.
	var users = servChanProp[room.params.irc.server][channel].users;
	log("users", users, ", servNick", servNick);
	users.forEach(function(user) {
		if(servNick[server][user].dir === 'out') {
			var sbNick = servNick[server][user].nick;
			clients[sbNick][server].part(channel);
		}
	});
	delete servChanProp[server][channel];
	delete rooms[roomId];
}

function connectUser(roomId, nick, options, cb) {
	log("room=", room);
	var room = rooms[roomId];
	var server = room.params.irc.server;
	var channel = room.params.irc.channel;
	var client;
	if (!clients[nick]) clients[nick] = {};
	if (clients[nick][server]) {
		client = joinChannels(server, nick, [channel],cb);
	} else {
		log("connecting user", nick);
		client = joinServer(server, nick, [channel], options,cb);
		client.sbNick = nick;
		client.once('registered', function(message) {
			if(!servNick[client.opt.server]) servNick[client.opt.server] = {};	
			servNick[client.opt.server][client.nick] = {nick: client.sbNick, dir: "out"};
		});
		client.on('part', function(channel, nk, reason, message) {
			if (client.opt.channels.length === 0) {
				log("part channel", nick);
				client.disconnect();
				delete clients[nick][client.opt.server];//TODO some cleanup needed?	
			}
		});
	}
}

function onMessage(client) {
	client.on('message', function(to, from, message) {
		log("on message" /*, JSON.stringify(servNick)*/);
		from = from.toLowerCase();
		if (!servChanProp[client.opt.server][from]) {
			return;
		}
		if (connected) {
			sendMessage(client.opt.server, to, from, message);
		} else {
			queue.push({
				fn: "sendMessage",
				server : client.opt.server,
				to: to,
				from: from,
				message: message
			});
		}
	});
}

function sendMessage(server, to, from, message) {
	log("message from:", from, to, server, message);
	from = from.toLowerCase();
	servChanProp[server][from].rooms.forEach(function(room) {
		if (!room.pending) {
			var from;
			if(servNick[server][to].dir === 'in') {
				from = servNick[server][to].nick;
			} else return;
			core.emit('data', {
				type: 'message',
				server: server,
				to: room.id,
				from: from, 
				text: message,
				session: "irc://" + server + ":" + to
			});
		}	
	});
}


function onPM(client) {
	client.on('pm', function(to, from, message) {
		log("pm=," , to, from , message);
		from = from.toLowerCase();
		var msg = [];
		if (message.args && message.args.length >= 2) {
			msg = message.args[1].split(" ");
		}
		if (msg.length >= 3 && msg[0] === 'connect' && servChanProp[client.opt.server][msg[1]]) {//connect #channel room.
			var r = msg[2];//
			log("r=", r);
			client.whois(message.nick, function(reply) {
				log("whois reply: ", reply);
				servChanProp[client.opt.server][msg[1]].rooms.forEach(function(room) {
					log("room", room);
					if(room.params.irc.pending && room.id === r && reply.channels) {
						log("room pending true");
						reply.channels.forEach(function(channel) {
							if (channel.substring(0,1) == '@' && channel.substring(1) === room.params.irc.channel) {
								client.join(room.params.irc.channel);
								if (connected) {
									sendRoom(room);
								} else {
									queue.push({
										fn: "sendRoom",
										room: room
									});
								}
							}
						});
					}
				});
			});
		}
	});
}

function sendRoom(room) {
	room.params.irc.pending = false;
	core.emit('data', {type: "room", room: room});
}

/************************** user left *****************************************/
/**
 * When client leave the server or channel.
 * @param {Object} client client object
 */
function onLeave(client) {

	client.on("part", function(channel, nick, reason, message){//TODO delete client if no more connections
		left(client, [channel], nick);
	});	
	
	client.addListener('kill', function (nick, reason, channels, message)  {//TODO see if autoconnect after kill
		left(client, channels, nick);
	});

	client.addListener('quit', function (nick, reason, channels, message)  {
		left(client, channels, nick);
	});

	client.addListener('kick', function (channel, nick, by, reason, message)  {
		if(!(servNick[client.opt.server][nick] && servNick[client.opt.server][nick].dir === 'out')) {
			left(client, [channel], nick);
		}
	});
}

function left(client, channels, nick) {
	
	if (connected) {
		sendAway(client.opt.server, channels, nick, client.nick);
	} else {
		queue.push({
			fn: "sendAway",
			server: client.opt.server,
			channels: channels,
			nick: nick,
			bn : client.nick
		});
	}
}

function sendAway(server, channels, nick, bn) {
	var sbUser = servNick[server][nick];
	
	channels.forEach(function(channel) {
		
		channel = channel.toLowerCase();
		log("users", servChanProp[server][channel].users.length);
		if (bn === nick) {//bot left the channel //TODO test
			delete servChanProp[server][channel];
			return;
		}
		if (!servChanProp[server][channel]) {
			return;
		}
		var index = servChanProp[server][channel].users.indexOf(nick);
		if(index > -1) servChanProp[server][channel].users.splice(index, 1);
		servChanProp[server][channel].rooms.forEach(function(room) {
			if(!room.params.pending && sbUser && sbUser.dir === "in") {//send away message for only incoming users
				core.emit("data", {
					type: "away",
					to: room.id,
					from: sbUser.nick,
					room: room,
					session: "irc://" + server + ":" + nick
				});
			}
		});
	});
	for( var channel in servChanProp[server]) {//if user left from all channel 
		if (servChanProp[server].hasOwnProperty(channel)) {
			if (servChanProp[server][channel].users.indexOf(nick) != -1) {
				return;
			}
		}
	}
	log("user:", nick, "went away from all channel in ", server, "server");
	delete servNick[server][nick];//TODO check if user left from all connected channels(rooms).
}

/************************** user left *****************************************/

/****************************************** add online irc users ***************/
/**
 * add new member 
 */
function addUsers(client, channel, nick) {
	if (connected) {
		sendBack(client.opt.server, channel, nick, client.nick);
	} else {
		queue.push({
			fn: "sendBack",
			server: client.opt.server,
			channel: channel,
			nick: nick,
			bn : client.nick
		});
	}
}

function sendBack(server, channel, nick, bn) {
	log("servChanProp", JSON.stringify(servChanProp));
	log("server", server, " channel:", channel);
	channel = channel.toLowerCase();
	servChanProp[server][channel].rooms.forEach(function(room) {
		//save data.
		if(nick != bn) servChanProp[server][channel].users.push(nick);//don't add myNick 
		if(nick != bn && !servNick[server][nick] && !room.params.irc.pending) {
			servNick[server][nick] = {nick: nick, dir: "in"};//default nick is irc nick
			core.emit("data", {
				type: "back",
				to: room.id,
				from: nick,
				room: room,
				session: "irc//:" + server + ":" + nick
			});
		}
	});
}

function onNick(client) {
	client.addListener('nick', function (oldNick, newNick, channels, message)  {
		if (!(renameCallback[oldNick] && renameCallback[oldNick][client.opt.server])) {
			channels.forEach(function(channel) {
				addUsers(client, channel, newNick);
			});
		} else {
			channels.forEach(function(channel) {
				servNick[client.opt.server][newNick] = {nick: renameCallback.newNick, dir: "out"};//this is for user which is connecting from scrollback(NO need to queue updation.)
				delete servNick[client.opt.server][oldNick];
				delete renameCallback[oldNick][client.opt.server];
			});
		}
		left(client, channels, oldNick);	
	});
}

function onJoin(client) {
	client.on('join', function(channel, nick, message) {//TODO use room.pending and send diff event for each room.	
		addUsers(client, channel, nick);
	});
}

/**
 *List of names send by server for channel
 */
function onNames(client) {
	client.on('names', function(channel, nicks) {
		log("server names", nicks);
		for (var nick in nicks) {
			if (nicks.hasOwnProperty(nick)) {
				if (client.nick === nick) continue;//my 
				addUsers(client, channel, nick);
			}		
		}
	});
}
/****************************************** add online irc users ***************/

/************************* send users msg ***************************************/
//text and action message
function say(message) {
	log("message sending to irc:", message);
	var client = clients[message.from][rooms[message.to].params.irc.server];
	client.say(rooms[message.to].params.irc.channel, message.text);
}
/************************* send users msg ***************************************/

/**
 * changes mapping of old nick to new nick
 * called from other side of app.
 * and not reconnect as new user.
 * this will be reply of back message if nick changes.
 */
function newNick(roomId, nick, sbNick) {
	var room = rooms[roomId];
	if (!servNick[room.params.irc.server]) {
		servNick[room.param.irc.server] = {};
	}
	servNick[room.params.irc.server][nick] = {nick: sbNick, dir: "in"};
}

/**
 * change nick in every server for that user.
 * @param {Object} oldNick old nick
 * @param {Object} newNick new Nick
 */
function rename(oldNick, newNick) {
	for(var server in clients[oldNick]) {//
		if (clients[oldNick].hasOwnProperty(server)) {
			var client = clients[oldNick][server];
			if(!renameCallback[client.nick]) renameCallback[client.nick] = {}; 
			renameCallback[client.nick][server] = {oldNick: oldNick, newNick: newNick};			
			client.rename(newNick);
			if (!clients[newNick]) clients[newNick] = {};
			clients[newNick][server] = clients[oldNick][server];
		}
	}
	delete clients[oldNick];
}

/**
 * away message from user
 * @param roomId ID of room.
 * @param {nick} nick user's unique nick
 */
function partUser(roomId, nick) {
	log("rooms", rooms, "roomId:", roomId, " nick", nick);
	var room = rooms[roomId];
	log(room);
	var client = clients[nick][room.params.irc.server];
	client.part(room.params.irc.channel);
}


/************************************ update servChanNick *************************/

/**
 * Return current state of Client.
 * @param {function} callback callback(state)
 */
function getCurrentState() {
	return {//state
		rooms: rooms,
		servChanProp: servChanProp,
		servNick: servNick
	};
}

/**
 * get Current nick of bot on server
 * @param {string} roomId 
 * @param {function} callback callback(nick)
 */
function getBotNick(roomId) {
	var room = rooms[roomId];
	var nick = clients[botNick][room.params.irc.server].nick;
	return nick;
}

function isConnected() {
	return connected;
}

function setConnected(c) {
	connected = c;//TODO false to true --> empty queue.
}

function sendQueueData() {
	log("Sending queue data:");
	while(true ) {
		var obj = queue.pop();
		if (obj === null) break;
		switch (obj.fn) {
			case "sendBack":
				sendBack(obj.server, obj.channel, obj.nick, obj.bn);
				break;
			case "sendAway":
				sendAway(obj.server, obj.channels, obj.nick, obj.bn);
				break;
			case "sendMessage":
				sendMessage(obj.server, obj.to, obj.from, obj.message);
				break;
			case "sendRoom":
				sendRoom(obj.room);
				break;
		}
	}
}

function onRaw(client) {
	client.on('raw', function(raw) {
		log("Raw message:", raw);
	});
}

function onError(client) {
	client.on('error', function(message) {
		log("IRC error:", message);
		core.emit('data', {
			type: 'ircError',
			server: client.opt.server,
			message: message
		});
	});
}