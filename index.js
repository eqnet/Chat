var express = require('express');
var app = express();
var server = app.listen(8080);
var io = require('socket.io').listen(server);
var MongoClient = require('mongodb').MongoClient;

console.log(process.env.OPENSHIFT_MONGODB_DB_URL);

var db;
var uri = process.env.MONGODB_USER;
MongoClient.connect(uri, {useNewUrlParser:true}, function(err, client) {
   if (err) {
	   console.log('Error conecting to MongoDB:' + err)
   } else {
	   db = client.db("node");
   }
});

app.use(express.static('public'));

app.get('/', function(req, res) {
	
});

var userCount = 0;
var users = {};

io.on('connection', function(socket) {
	userCount++;
	io.emit(socket.id).emit('user count', userCount);
	io.to(socket.id).emit('update users', users);
	
	socket.on('add user', function(msg) {
		if (msg !== '' && msg.toLowerCase() !== 'all users') {
			if (users[msg]) {
				if (users[msg] !== socket.id) {
					io.to(socket.id).emit('invalid user', 'This nickname already exists. Please choose a different nickname.');
				}
			} else {
				if (users[socket.nickname]) {
					delete users[socket.nickname];
					socket.broadcast.emit('chat message', socket.id, socket.nickname, 'I have changed my nickname to ' + msg);
					
					updateUser(socket.nickname, msg);
					
					socket.nickname = msg;
					users[socket.nickname] = socket.id;
				} else {
					socket.nickname = msg;
					users[socket.nickname] = socket.id;
					socket.broadcast.emit('chat message', socket.id, socket.nickname, socket.nickname +' has joined the chat session');
					
					userConnected(msg);
					//createUser(msg);
				}
				
				updateUsers();
			}
		} else {
			io.to(socket.id).emit('invalid user', 'Invalid nickname.');
		}
	});
	
	socket.on('chat message', function(user, msg) {
		var timeSinceLastMsg = (new Date().getTime() - new Date(socket.lastMsgDate).getTime()) / 1000;
		socket.lastMsgDate = new Date();
		
		if (timeSinceLastMsg < 3) { //Set to 1 after testing
			socket.broadcast.emit('chat message', '', 'Admin', socket.nickname +' is being removed from the chat session');
			socket.end();
			return;
		}
		
		io.to(socket.id).emit('chat message', '', socket.nickname, msg);
		
		var msgUsers = [];
		
		if (user == 'All Users') {
			socket.broadcast.emit('chat message', socket.id, socket.nickname, msg);
			
			for (var key in users) {
				msgUsers.push(key);
			}
		} else {
			var chatUsers = user.split('|');
			for (var i=0;i<chatUsers.length;i++) {
				io.to(chatUsers[i]).emit('chat message', socket.id, socket.nickname, msg);
				msgUsers.push(io.sockets.connected[chatUsers[i]].nickname);
			}
		}
		
		getMsgUsers(msgUsers, function(mongodbUsers) {
			msgSent(socket.nickname, mongodbUsers, msg);
		});
	});

	socket.on('disconnect', function() {
		userCount--;
		delete users[socket.nickname];
		socket.broadcast.emit('user count', userCount);
		if (socket.nickname) {
			socket.broadcast.emit('chat message', '', 'Admin', socket.nickname +' has left the chat session');
		}
		
		updateUsers();
	});

	function updateUsers() {
		io.emit('update users', users);
	}
});

console.log('listening on port:8080');

var getMsgUsers = function(msgUsers, callback) {
	db.collection('users').find({"nickname":{$in:msgUsers}}, {_id:1}).toArray(function(err, rows) {
		if(err) throw err;

		callback(rows);
	});
}

var getMsgSender = function(nickname, callback) {
	db.collection('users').find({"nickname":nickname}, {_id:1}).toArray(function(err, rows) {
		if(err) throw err;

		callback(rows[0]);
	});
}

function createUser(nickname) {
	db.collection('users').insert({nickname:nickname}, function(err, rows) {
		if(err) throw err;
	});
}

function updateUser(nickname, newNickname) {
	db.collection('users').update({nickname:nickname},{$set:{nickname:newNickname}}, function(err, count) {
		if(err) throw err;
	});
}

function userConnected(nickname) {
	db.collection('users').countDocuments({nickname:nickname}, function(err, count) {
		if (count == 0) {
			createUser(nickname);
		}
	});
}

function msgSent(nickname, users, msg) {
	var mongodbUsers = [];
	for (var i=0;i<users.length;i++) {
		mongodbUsers.push(users[i]._id);
	}
	
	db.collection('users').update(
		{"nickname":nickname},
		{
			$inc:{"sentMsgs.count":1},
			$set:{"sentMsgs.lastDate":new Date()},
			$push:{
				"sentMsgs.msgs":{
					"date":new Date(),
					"users":mongodbUsers,
					"msg":msg
				}
			}
		},	function(err, count) {
				if(err) throw err;
				
				getMsgSender(nickname, function(mongodbUser) {
					msgReceived(mongodbUser, users, msg);
				});
			}
	);
}

function msgReceived(mongodbUser, users, msg) {
	var msgDate = new Date();
	var user = {};
	
	for (var i=0;i<users.length;i++) {
		user = users[i];
		db.collection('users').update(
			{"_id":user._id},
			{
				$inc:{"receivedMsgs.count":1},
				$set:{"receivedMsgs.lastDate":msgDate},
				$push:{
					"receivedMsgs.msgs":{
						"date":msgDate,
						"user":mongodbUser._id,
						"msg":msg
					}
				}
			},	function(err, count) {
					if(err) throw err;
				}
		);
	}
}

/*
var server_port = process.env.OPENSHIFT_NODEJS_PORT || 8080;
var server_ip_address = process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1';

server.listen(server_port, server_ip_address, function () {
	console.log( "Listening on " + server_ip_address + ", server_port " + port );
});
*/
/*
db.collection('users').count({nickname:msg}, function(err, count) {
	if (count > 0) {
		db.collection('users').update({nickname:msg},{$inc:{msg_count:1}, $set:{last_msg:new Date()}}, function(err, count) {
			if(err) throw err;
		});
	} else {
		db.collection('users').insert({nickname:msg, msg_count:1, last_msg:new Date()}, function(err, rows) {
			if(err) throw err;
		});
	}
});
*/


