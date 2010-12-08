#!/usr/bin/env node

var optparse = require('optparse'),
    server = require('marmalade/server');

var parser = new optparse.OptionParser([
    ['-h', '--help', 'Show this help message'],
    ['-V', '--version', 'Show the Marmalade version'],
    ['-p', '--port PORT', 'Port to run the server on (default 3000)']
]);

var port = 3000;

parser.banner = "Usage: marmalade [OPTION]...\n" +
      "\n" +
      "An Emacs Lisp package server.";

parser.on('help', function() {
    console.log(String(parser));
    process.exit();
});

parser.on('version', function() {
    console.log('Marmalade 0.0.2');
    process.exit();
});

parser.on('port', function(_, port_) {
    port = +port_;
    if (port === 0) {
        console.log('Invalid port "' + port + '"');
        process.exit(1);
    }
});

parser.on(2, function(a) {
    console.log(parser);
    process.exit(1);
});

parser.parse(process.argv);


server.create(function(err, app) {
    if (err) throw err;
    app.listen(port);
});
