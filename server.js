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
    mime = require("connect/utils").mime,
    express = require("express"),
    mustache = require("mustache"),
    step = require("step");
    formidable = require("formidable"),
    _ = require("underscore")._,
    backend = require("./backend"),
    helpers = require("./helpers"),
    sexp = require("./sexp").sexp,
    sexpParser = require("./sexpParser"),
    util = require("./util");

/**
 * Teach connect the Elisp mime type.
 */
mime.types['.el'] = 'text/x-script.elisp';

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
 * Connect middleware that extends the request and response objects with useful
 * Jelly-specific functionality.
 */
function extensions(req, res, next) {
    /**
     * Extend res.send so that sent objects are rendered as either Elisp or
     * JSON, depending on the Accept headers.
     */
    var oldSend = res.send;
    res.send = function(body, headers, status) {
        // Allow status as second arg
        if (typeof headers === 'number') {
            status = headers,
            headers = null;
        }

        // Defaults
        status = status || 200;
        headers = headers || {};

        if (typeof body === 'object' && !(body instanceof Buffer) &&
              req.accepts('el') && !req.accepts('json')) {
            this.contentType('.el');
            body = sexp(body);
        }

        oldSend.call(this, body, headers, status);
    };

    /**
     * Gets a parameter, or throws an error if it doesn't exist.
     * @param {string} name The name of the parameter.
     * @return {string} value The value of the paramter.
     */
    req.requiredParam = function(name) {
        var val = this.param(name);
        if (val) return val;
        throw new HttpError('Required parameter "' + name + '" not given', 400);
    };

    next();
};

/**
 * Create a Jelly server. This is a standard Express application, with routes
 * and configuration set up for Jelly. To start it, just call
 * `.create().listen()`.
 * @param {string} dataDir The root of the Jelly backend's data store.
 * @param {function(Error=, express.Server=)} callback Called with the new
 *   server.
 */
exports.create = function(dataDir, callback) {
    var app = express.createServer();

    /**
     * The Jelly backend. This will be set once the caller receives the app.
     * @type {backend.Backend}
     */
    app.backend = null;


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
        app.use(connect.bodyDecoder());
        app.use(extensions);
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
        app.backend.loadPackage(
            name, _.map(version.split("."), Number), type, function(err, data, pkg) {
                if (err) {
                    if (err instanceof backend.LoadError) {
                        res.send(err.message + "\n",
                                 {'Content-Type': 'text/plain'},
                                 404);
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
     * representation of the package metadata. This is actually streaming,
     * although `package.el` doesn't care.
     */
    app.get('/packages/archive-contents', function(req, res, next) {
        var pkgStream = app.backend.packageStream();
        var first = true;

        pkgStream.on('data', function(pkg) {
            res.write(res.partial("archive-contents.ejs", {
                locals: helpers.extend({pkg: pkg}),
                layout: false
            }).replace(/\n */mg, ''));
        });

        pkgStream.on('error', function(err) {
            sys.error(err.stack);
            res.write(')');
            res.end();
        });

        pkgStream.on('end', function() {
            res.write(')');
            res.end();
        });

        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.write('(1');
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
     * So far this includes uploading packages and handling users.
     *
     * All responses to Jelly-specific API calls can be either JSON or Elisp.
     * Elisp responses will be sent if the user agent includes
     * 'text/x-script.elisp' in its Accept header; otherwise, JSON will be sent.
     * Note that if the user agent accepts both JSON and Elisp, JSON will be
     * preferred.
     *
     * All responses will include a human-readable 'message' key (for objects in
     * JSON and alists in Elisp). They may also contain other keys specific to
     * the request in question.
     */

    /**
     * Uploads a package. This takes a multipart form post with `username` and
     * `token` fields, and a single Elisp or tar file labeled `package`. The
     * type of the package is inferred from its filename.
     *
     * A successful response will contain the `package` key, which is the
     * package metadata (as described in backend.js).
     */
    app.post('/packages', function(req, res, next) {
        var form = new formidable.IncomingForm();
        var files;
        step(
            function() {form.parse(req, this)},
            function(err, fields, files_) {
                if (err) throw err;
                if (!fields.username) {
                    throw new HttpError("Username parameter required", 400);
                } else if (!fields.token) {
                    throw new HttpError("Token parameter required", 400);
                } else if (!files_['package']) {
                    throw new HttpError(
                        "Package file upload parameter required", 400);
                } else {
                    files = files_;
                    app.backend.loadUserWithToken(
                        fields.username, fields.token, this);
                }
            },
            function(err, user) {
                if (err) throw err;
                if (!user) {
                    throw new HttpError("Username or token invalid", 400);
                }

                var ext = files['package'].filename.match(/\.([^.]+)$/);
                if (!ext) {
                    throw new HttpError("Couldn't determine file extension " +
                                        "for " + files['package'].filename,
                                        400);
                }
                ext = ext[1];

                if (ext === "tar") {
                    app.backend.saveTarFile(files['package'].path, user, this);
                } else if (ext === "el") {
                    app.backend.saveElispFile(
                        files['package'].path, user, this);
                } else {
                    throw new HttpError("Unkown file extension: " + ext, 400);
                }
            },
            function(err, pkg) {
                if (err && err instanceof sexpParser.SyntaxError) {
                    throw new HttpError(err.message, 400);
                } else if (err && err instanceof backend.PermissionsError) {
                    throw new HttpError(err.message, 403);
                } else if (err) throw err;

                res.send({
                    message: "Saved " + pkg.name + ", version " +
                          pkg.version.join("."),
                    'package': pkg
                });
            }, next);
    });

    /**
     * Registers a new user. This should have `name` and `password` parameters.
     *
     * A successful response will contain the following keys:
     *
     * * `name`: The user's name (presumably the same as the request parameter).
     * * `token`: The user's authentication token, which is sent up to validate
     *     the user's identity.
     */
    app.post('/users', function(req, res, next) {
        step(
            function() {
                app.backend.registerUser(req.requiredParam('name'),
                                         req.requiredParam('password'),
                                         this);
            },
            function(err, user) {
                if (err instanceof backend.RegistrationError) {
                    throw new HttpError(err.message, 400);
                } else if (err) throw err;
                res.send({
                    message: "Successfully registered " + user.name,
                    name: user.name,
                    token: user.token
                });
            }, next);
    });


    /** ## Error Handling */

    /**
     * HttpErrors mean that we should send back a specific response code.
     */
    app.error(function(err, req, res, next) {
        if (err instanceof HttpError) {
            res.send({message: err.message}, err.code);
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


    /** ## Initialization */

    /**
     * Tell the user when we're ready to accept connections.
     */
    app.addListener('listening', function() {
        var address = app.address();
        var hostname = address.address;
        if (hostname === "0.0.0.0") hostname = "localhost";
        console.log("Jelly's spread all over " + hostname + ":" + address.port);
    });

    /**
     * Initialize the backend before we let the user start the server.
     */
    console.log("Loading database...");
    step(
        function() {backend.create(dataDir, this)},
        function(err, be) {
            if (err) throw err;
            app.backend = be;
            return app;
        }, callback);
};
