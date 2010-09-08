/**
 * The API for programatically interacting with the Jelly backend. This includes
 * both the standard ELPA API and the Jelly API for user-uploaded packages.
 */

var sys = require("sys"),
    step = require("step");
    formidable = require("formidable"),
    _ = require("underscore")._,
    backend = require("../backend"),
    helpers = require("../helpers"),
    sexpParser = require("../sexpParser"),
    base = require("./base");

/**
 * Install the API routes in the server.
 * @param {express.Server} app
 */
exports.install = function(app) {
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
     * Uploads a package. This takes a multipart form post with `name` and
     * `token` fields, and a single Elisp or tar file labeled `package`. The
     * type of the package is inferred from its filename.
     *
     * A successful response will contain the `package` key, which is the
     * package metadata (as described in backend.js).
     */
    app.post('/v1/packages', function(req, res, next) {
        var form = new formidable.IncomingForm();
        var files;
        step(
            function() {form.parse(req, this)},
            function(err, fields, files_) {
                if (err) throw err;
                if (!fields.name) {
                    throw new base.HttpError("Name parameter required", 400);
                } else if (!fields.token) {
                    throw new base.HttpError("Token parameter required", 400);
                } else if (!files_['package']) {
                    throw new base.HttpError(
                        "Package file upload parameter required", 400);
                } else {
                    files = files_;
                    app.backend.loadUserWithToken(
                        fields.name, fields.token, this);
                }
            },
            function(err, user) {
                if (err) throw err;
                if (!user) {
                    throw new base.HttpError("Username or token invalid", 400);
                }

                var ext = files['package'].filename.match(/\.([^.]+)$/);
                if (!ext) {
                    throw new base.HttpError(
                          "Couldn't determine file extension for " +
                              files['package'].filename,
                          400);
                }
                ext = ext[1];

                if (ext === "tar") {
                    app.backend.saveTarFile(files['package'].path, user, this);
                } else if (ext === "el") {
                    app.backend.saveElispFile(
                        files['package'].path, user, this);
                } else {
                    throw new base.HttpError("Unkown file extension: " + ext,
                                             400);
                }
            },
            function(err, pkg) {
                if (err && err instanceof sexpParser.SyntaxError) {
                    throw new base.HttpError(err.message, 400);
                } else if (err && err instanceof backend.PermissionsError) {
                    throw new base.HttpError(err.message, 403);
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
    app.post('/v1/users', function(req, res, next) {
        step(
            function() {
                app.backend.registerUser(req.requiredParam('name'),
                                         req.requiredParam('password'),
                                         this);
            },
            function(err, user) {
                if (err instanceof backend.RegistrationError) {
                    throw new base.HttpError(err.message, 400);
                } else if (err) throw err;
                res.send({
                    message: "Successfully registered " + user.name,
                    name: user.name,
                    token: user.token
                });
            }, next);
    });

    /**
     * Logs a user in; that is, retrieves the authentication token for a user.
     * This should have `name` and `password` parameters.
     *
     * A successful response will contain the following keys:
     *
     * * `name`: The user's name (presumably the same as the request parameter).
     * * `token`: The user's authentication token, which is sent up to validate
     *     the user's identity.
     */
    app.post('/v1/users/login', function(req, res, next) {
        step(
            function() {
                app.backend.loadUser(req.requiredParam('name'),
                                     req.requiredParam('password'),
                                     this);
            },
            function(err, user) {
                if (err) throw err;
                if (!user) {
                    throw new base.HttpError("Username or password invalid",
                                             400);
                }
                res.send({
                    message: 'Logged in as "' + user.name + '"',
                    name: user.name,
                    token: user.token
                });
            }, next);
    });
};
