/**
 * The actual faux-ELPA server. The main job of this file is to hook up the
 * backend to an HTTP interface. This interface is a superset of ELPA's, and so
 * can be used as a package.el source. So far, the only extensions have to do
 * with presenting a web frontend (basically nonexistent at time of writing) and
 * providing facilities for user-uploaded packages.
 */

var Buffer = require("buffer").Buffer,
    queryString = require("querystring"),
    sys = require("sys"),
    connect = require("connect"),
    express = require("express"),
    mustache = require("mustache"),
    step = require("step");
    formidable = require("formidable"),
    backend = require("./backend"),
    helpers = require("./helpers"),
    util = require("./util");

/**
 * An error class raised when we want to send back a specific HTTP error code.
 * This is caught by the server and used to send back the appropriate response.
 * This can be useful to throw within a `step` sequence, since throwing is the
 * only way to do a somewhate-nonlocal exit.
 * @param {string} msg The error message.
 * @param {number} code The error code.
 */
var HttpError = util.errorClass(function HttpError(code) {
    this.code = code;
});

/**
 * Create a Jelly server. This is a standard Express application, with routes
 * and configuration set up for Jelly. To start it, just call
 * `.create().listen()`.
 * @return {express.Server}
 */
exports.create = function() {
    var app = express.createServer();


    /** ## Configuration
     *
     * Logging is handy and gzipping is nice. I don't think `conditionalGet`
     * works without some effort on the server's part, so it's here as a
     * reminder to do that at some point.
     */

    app.configure(function() {
        app.use(connect.logger());
        app.use(connect.gzip());
        app.use(connect.conditionalGet());
    });


    /** # Routing */

    /** ## Web Frontend
     *
     * Eventually, this will be more fleshed out than it is right now.
     */

    /**
     * The main page. Very bare at the moment.
     */
    app.get('/', function(req, res) {
        res.send("<h1>Jelly - Elisp Packages on Toast</h1>");
    });

    /** ## ELPA Interface
     *
     * These routes are the API exposed by ELPA and expected by package.js. ELPA
     * proper makes everything static files, but we're more dynamic about it.
     */

    /**
     * Download an individual package at a specific version.
     */
    app.get(/^\/packages\/(.*)-([0-9.]+)\.(el|tar)$/, function(req, res, next) {
        var name = req.params[0];
        var version = req.params[1];
        var type = req.params[2];
        backend.loadPackage(
            name, _.map(version.split("."), Number), type, function(err, data, pkg) {
                if (err) {
                    if (err.name === "WrongVersionError") {
                        res.send(err.message, {'Content-Type': 'text/plain'}, 404);
                    } else if (err.errno === process.ENOENT) {
                        res.send("Don't have any version of " +
                                 name + "." + type + "\n", 404);
                    } else {
                        next(err);
                    }
                    return;
                }

                res.send(data, {'Content-Type': (pkg.type === 'el'
                                                 ? 'text/plain'
                                                 : 'application/x-tar')});
            });
    });

    /**
     * Gets the list of all packages available. This is sent as an Elisp sexp
     * representation of the package metadata.
     */
    app.get('/packages/archive-contents', function(req, res, next) {
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
            }, next);
    });

    /**
     * Gets a list of builtin packages. We don't want to keep track of this, so
     * we redirect to the official ELPA list.
     */
    app.get('/packages/builtin-packages', function(req, res) {
        res.redirect("http://elpa.gnu.org/packages/builtin-packages", 301);
    });

    /** ## Jelly Interface
     *
     * These routes are the API we expose in addition to that required by ELPA.
     * So far this just has to do with uploading packages.
     */

    /**
     * Uploads a package. This takes a multipart form post with a single Elisp
     * or tar file labeled `package`. The type of the package is inferred from
     * its filename.
     */
    app.post('/packages', function(req, res, next) {
        var form = new formidable.IncomingForm();
        step(
            function() {form.parse(req, this)},
            function(err, fields, files) {
                if (err) throw err;

                var ext = files['package'].filename.match(/\.([^.]+)$/);
                if (!ext) {
                    res.send("Couldn't determine file extension for " +
                               files['package'].filename,
                            400);
                    return;
                }
                ext = ext[1];

                if (ext === "tar") {
                    backend.saveTarFile(files['package'].path, this);
                } else if (ext === "el") {
                    backend.saveElispFile(files['package'].path, this);
                } else {
                    throw new HttpError("Unkown file extension: " + ext, 400);
                }
            },
            function(err, pkg) {
                if (err && err.name === 'SyntaxError') {
                    throw new HttpError(err.message, 400);
                } else if (err) throw err;

                res.send("Saved " + pkg.name + ", version " +
                         pkg.version.join(".") + "\n",
                         {'Content-Type': 'text/plain'});
            }, next);
    });


    /** ## Error Handling */

    /**
     * HttpErrors mean that we should send back a specific response code.
     */
    app.error(function(err, req, res, next) {
        if (err instanceof HttpError) {
            res.send(err.message + "\n", {'Content-Type': 'text/plain'},
                     err.code);
        } else next(err, req, res);
    });

    /**
     * Handle other errors using the standard error handler.
     */
    app.configure('development', function() {
        app.use(connect.errorHandler({dumpExceptions: true, showStack: true}));
    });

    app.configure('production', function() {
        app.use(connect.errorHandler());
    });


    /** ## Initialization
     *
     * Load the database before we start accepting incoming connections.
     */

    app.addListener('listening', function() {
        console.log("Loading database...")
        backend.init();
        var address = app.address();
        var hostname = address.address;
        if (hostname === "0.0.0.0") hostname = "localhost";
        console.log("Jelly's spread all over " + hostname + ":" + address.port);
    });

    return app;
};
