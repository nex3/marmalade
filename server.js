var connect = require("connect"),
    express = require("express"),
    mustache = require("mustache"),
    backend = require("./backend"),
    helpers = require("./helpers");

exports.create = function(middleware) {
    var app = express.createServer(
        connect.logger(),
        connect.gzip(),
        connect.errorHandler(),
        connect.conditionalGet()
    );
    app.use('/packages', connect.staticProvider(__dirname + '/packages'));

    app.addListener('listening', function() {
        var address = app.address();
        var hostname = address.address;
        if (hostname === "0.0.0.0") hostname = "localhost";
        console.log("Jelly's spread all over " + hostname + ":" + address.port);
    });

    app.get('/', function(req, res) {
        res.send("<h1>Jelly - Elisp Packages on Toast</h1>");
    });

    app.get('/packages/archive-contents', function(req, res) {
        backend.getPackages(function(err, pkgs) {
            if (err) throw err;
            res.render("archive-contents.ejs", {
                locals: helpers.extend({packages: pkgs}),
                layout: false
            }, function(err, str) {
                res.send(str, {'Content-Type': 'text/plain'});
            });
        });
    });

    return app;
};
