var connect = require('connect'),
    config = require('./config'),
    fs = require('fs'),
    http = require('http'),
    redis = require('redis'),
    sockjs = require('sockjs');

var INDEX_HTML;
var CHANGED = false;
var R;
var SOCKS = {};

function index(req, resp, next) {
	var m = req.method;
	if (req.url == '/' && (m == 'GET' || m == 'HEAD')) {
		resp.writeHead(200, {
			'Cache-Control': 'no-cache',
			'Content-Type': 'text/html; charset=utf-8',
			Expires: 'Thu, 01 Jan 1970 00:00:00 GMT',
		});
		if (m == 'HEAD')
			return resp.end();

		R.get(config.REDIS_KEY, function (err, ctr) {
			if (err)
				return next(err);
			ctr = commas(parseInt(ctr, 10) || 0);
			var html = INDEX_HTML.replace('$CTR', ctr);
			resp.end(html);
		});
		return;
	}

	if ((req.url == '/' || req.url == '/wub') && m == 'POST') {
		R.incr(config.REDIS_KEY, function (err) {
			if (err)
				return next(err);
			CHANGED = true;

			if (req.url == '/wub') {
				resp.writeHead(204);
				resp.end();
				return;
			}
			resp.writeHead(303, {
				Location: '.',
				'Content-Type': 'text/plain; charset=utf-8',
			});
			resp.end('乙');
		});
		return;
	}

	next();
}

function commas(x) {
	return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function onOpen(conn) {
	if (!conn.id)
		throw new Error('No socket ID?!');
	SOCKS[conn.id] = conn;
	conn.on('data', onMessage);
	conn.once('close', onClose);
}

function onMessage(message) {
	if (message == 'poll') {
		var sock = this;
		R.get(config.REDIS_KEY, function (err, ctr) {
			if (err)
				return console.error(err);
			if (sock.writable)
				sock.write(parseInt(ctr, 10) || 0);
		});
	}
	else {
		this.end();
	}
}

function onClose() {
	delete SOCKS[this.id];
}

function broadcast(msg) {
	for (var id in SOCKS) {
		var sock = SOCKS[id];
		if (sock.writable)
			sock.write(msg);
	}
}

function flushChange() {
	if (CHANGED) {
		CHANGED = false;
		R.get(config.REDIS_KEY, function (err, ctr) {
			if (err)
				throw err;
			broadcast(parseInt(ctr, 10) || 0);
		});
	}
}

function reload() {
	fs.readFile('index.html', 'utf8', function (err, html) {
		if (err)
			throw err;
		INDEX_HTML = html;
		broadcast('reload');
	});
}

function main() {
	R = redis.createClient(config.REDIS_PORT);
	reload();
	process.on('SIGHUP', reload);

	var app = connect()
		.use(connect.static(__dirname + '/www', {
			maxAge: config.DEBUG ? 3*24*60*60*1000 : 0,
		}))
		.use(index);

	var sock = sockjs.createServer({
		sockjs_url: config.SOCKJS_URL,
		prefix: '/shaberu',
		log: function () {},
	});
	sock.on('connection', onOpen);

	var server = http.createServer(app);
	sock.installHandlers(server);
	server.listen(config.PORT);
	console.log('Listening on :' + config.PORT + '.');

	setInterval(flushChange, 500);
}

if (require.main === module)
	main();
