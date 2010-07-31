var Buffer = require("buffer").Buffer,
    queryString = require("querystring"),
    sys = require("sys"),
    connect = require("connect"),
    express = require("express"),
    mustache = require("mustache"),
    step = require("step");
    formidable = require("formidable"),
    backend = require("./backend"),
    helpers = require("./helpers");

exports.create = function(middleware) {
    var app = express.createServer(
        connect.logger(),
        connect.gzip(),
        connect.errorHandler(),
        connect.conditionalGet()
    );

    app.addListener('listening', function() {
        var address = app.address();
        var hostname = address.address;
        if (hostname === "0.0.0.0") hostname = "localhost";
        console.log("Jelly's spread all over " + hostname + ":" + address.port);
    });

    app.get('/', function(req, res) {
        res.send("<h1>Jelly - Elisp Packages on Toast</h1>");
    });

    app.get(/^\/packages\/(.*)-([0-9.]+)\.(el|tar)$/, function(req, res, params) {
        var name = params.splat[0];
        var version = params.splat[1];
        var type = params.splat[2];
        backend.loadPackage(
            name, _.map(version.split("."), Number), type, function(err, data, pkg) {
                if (err) {
                    if (err.name === "WrongVersionError") {
                        res.send(err.message, {'Content-Type': 'text/plain'}, 404);
                    } else if (err.errno === process.ENOENT) {
                        res.send("Don't have any version of " +
                                 name + "." + type + "\n", 404);
                    } else {
                        throw err;
                    }
                    return;
                }

                res.send(data, {'Content-Type': (pkg.type === 'el'
                                                 ? 'text/plain'
                                                 : 'application/x-tar')});
            });
    });

    app.post('/packages', function(req, res) {
        var form = new formidable.IncomingForm();
        step(
            function() {form.parse(req, this)},
            function(err, fields, files) {
                if (err) throw err;
                backend.saveTarFile(files['package'].path, this);
            },
            function(err, pkg) {
                if (err) throw err;
                res.send("Saved " + pkg.name + ", version " +
                         pkg.version.join(".") + "\n",
                         {'Content-Type': 'text/plain'});
            });
    });

    app.get('/packages/archive-contents', function(req, res) {
        step(
            function() {backend.getPackages(this)},
            function(err, pkgs) {
                if (err) throw err;
                res.render("archive-contents.ejs", {
                    locals: helpers.extend({packages: pkgs}),
                    layout: false
                }, this);
            },
            function(err, str) {
                if (err) throw err;
                res.send(str, {'Content-Type': 'text/plain'});
            });
    });

    app.get('/packages/builtin-packages', function(req, res) {
        res.redirect("http://elpa.gnu.org/packages/builtin-packages", 301);
    });

    return app;
};
