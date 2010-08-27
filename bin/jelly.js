#!/usr/bin/env node

var optparse = require('optparse'),
    server = require('jelly/server');

var parser = new optparse.OptionParser([
    ['-h', '--help', 'Show this help message'],
    ['-V', '--version', 'Show the Jelly version']
]);

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

parser.on(0, function() {
    console.log(parser);
    process.exit(1);
});

parser.parse(process.argv);


server.create('data', function(err, app) {
    if (err) throw err;
    app.listen();
});
