#!/usr/bin/env node

var optparse = require('optparse'),
    server = require('jelly/server');

var parser = new optparse.OptionParser([
    ['-h', '--help', 'Show this help message'],
    ['-V', '--version', 'Show the Jelly version'],
    ['-p', '--port PORT', 'Port to run the server on (default 3000)'],
    ['-d', '--data DIR', 'Directory in which to store the server data ' +
                         '(default ./data)']
]);

var port = 3000,
    dataDir = './data';

parser.banner = "Usage: jelly [OPTION]...\n" +
      "\n" +
      "An Emacs Lisp package server.";

parser.on('help', function() {
    console.log(parser);
    process.exit();
});

parser.on('version', function() {
    console.log('Jelly 0.0.0');
    process.exit();
});

parser.on('port', function(_, port_) {
    port = +port_;
    if (port === 0) {
        console.log('Invalid port "' + port + '"');
        process.exit(1);
    }
});

parser.on('dataDir', function(_, dataDir_) {
    dataDir = dataDir_;
});

parser.on(2, function(a) {
    console.log(parser);
    process.exit(1);
});

parser.parse(process.argv);


server.create(dataDir, function(err, app) {
    if (err) throw err;
    app.listen(port);
});
