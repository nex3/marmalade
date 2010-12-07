/*!*
 * Marmalade: an Emacs Lisp package server.
 * Copyright (C) 2010 Google Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * The API for programatically interacting with the Marmalade backend. This
 * includes both the standard ELPA API and the Marmalade API for user-uploaded
 * packages.
 */

var sys = require("sys"),
    step = require("step");
    formidable = require("formidable"),
    _ = require("underscore")._,
    express = require("express"),
    backend = require("../backend"),
    sexpParser = require("../sexpParser"),
    sexp = require("../sexp");
    stream = require("../stream");
    base = require("./base");

/**
 * Create the Marmalade API server, for handling the ELPA API and Marmalade's
 * own HTTP API.
 * @param {backend.Backend} be The Marmalade backend.
 * @return {express.Server} The API server.
 */
exports.create = function(be) {
    var app = express.createServer();

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
        be.loadPackageData(
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
        var pkgStream = be.packageVersionStream();
        var first = true;

        pkgStream.on('data', function(pkg) {
            res.write(res.partial("archive-contents.ejs", {
                locals: {pkg: pkg},
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

    /** ## Marmalade Interface
     *
     * These routes are the API we expose in addition to that required by ELPA.
     * So far this includes uploading packages and handling users.
     *
     * All responses to Marmalade-specific API calls can be either JSON or
     * Elisp. Elisp responses will be sent if the user agent includes
     * 'text/x-script.elisp' in its Accept header; otherwise, JSON will be sent.
     * Note that if the user agent accepts both JSON and Elisp, JSON will be
     * preferred.
     *
     * All responses will include a human-readable 'message' key (for objects in
     * JSON and alists in Elisp). They may also contain other keys specific to
     * the request in question.
     */

    /**
     * Gets the package metadata for a package. This includes metadata for all
     * versions of the package.
     *
     * A successful response will contain the `package` key, which is the
     * package metadata (as describd in the marmalade-api(7) manpage).
     */
    app.get('/v1/packages/:package', function(
          req, res, next) {
        var pkg;
        step(
            function() {be.loadPackage(req.requiredParam('package'), this)},
            function(err, pkg_) {
                if (err) throw err;
                if (!pkg_) throw new base.HttpError(
                      'Package "' + req.requiredParam('package') +
                      '" doesn\'t exist', 404);
                pkg = pkg_;
                stream.all(
                      be.packageVersionStream({_name: pkg._name}, [],
                                              {sort: [['_id', 'descending']]}),
                      this);
            },
            function(err, versions) {
                if (err) throw err;
                pkg.versions = versions;
                res.send({
                    message: "Got " + pkg.name,
                    'package': normalize(pkg)
                });
            }, next);
    });

    /**
     * Gets the package metadata for a specific version of a package.
     *
     * A successful response will contain the `package` key, which is the
     * package metadata (as describd in the marmalade-api(7) manpage).
     */
    app.get(/^\/v1\/packages\/([^\/]+)\/([0-9]+(?:\.[0-9]+)*)\/?$/, function(
          req, res, next) {
        var name = req.params[0];
        var version = _.map(req.params[1].split('.'), Number);
        step(
            function() {be.loadPackageVersion(name, version, this)},
            function(err, pkg, ver) {
                if (err) throw err;
                if (!pkg) throw new base.HttpError(
                      'Package "' + name + '" version "' + version.join('.') +
                      '" doesn\'t exist', 404);
                pkg.versions = [ver];
                res.send({
                    message: "Got " + pkg.name + ", version " +
                          ver.version.join('.'),
                    'package': normalize(pkg)
                });
            }, next);
    });

    /**
     * Gets the package metadata for the latest version of a package.
     *
     * A successful response will contain the `package` key, which is the
     * package metadata (as describd in the marmalade-api(7) manpage).
     */
    app.get('/v1/packages/:package/latest', function(
          req, res, next) {
        step(
            function() {be.loadPackage(req.requiredParam('package'), this)},
            function(err, pkg) {
                if (err) throw err;
                if (!pkg) throw new base.HttpError(
                      'Package "' + req.requiredParam('package') +
                      '" doesn\'t exist', 404);
                pkg.versions = [pkg._latestVersion];
                res.send({
                    message: "Got " + pkg.name,
                    'package': normalize(pkg)
                });
            }, next);
    });

    /**
     * Uploads a package. This takes a multipart form post with `name` and
     * `token` fields, and a single Elisp or tar file labeled `package`. The
     * type of the package is inferred from its filename.
     *
     * A successful response will contain the `package` key, which is the
     * package metadata (as describd in the marmalade-api(7) manpage).
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
                    be.loadUserWithToken(fields.name, fields.token, this);
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
                    be.saveTarFile(files['package'].path, user, this);
                } else if (ext === "el") {
                    be.saveElispFile(files['package'].path, user, this);
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
                          pkg.versions[0].version.join("."),
                    'package': normalize(pkg)
                });
            }, next);
    });

    function getOwners_(req) {
        var owners = [];
        _.each(_.keys(req.body), function(k) {
            if (k.match(/^owner[0-9]*$/)) owners.push(req.body[k]);
        });

        if (owners.length == 0) {
            throw new backend.InputError(
                  'Required parameter "owner" not given');
        }
        return owners;
    }

    /**
     * Adds one or more owners to a package. This should have 'name', `token`,
     * and `package` parameters. It should also have either an `owner`
     * parameter, or a series of `owner#` parameters, with `#` replaced by
     * numbers. Owners are specified by their usernames.
     */
    app.post('/v1/packages/:package/owners', function(req, res, next) {
        var owners;
        step(
            function() {
                be.loadUserWithToken(req.requiredParam('name'),
                                     req.requiredParam('token'),
                                     this);
            },
            function(err, owner) {
                if (err) throw err;
                owners = getOwners_(req);
                _.each(owners, function(newOwner) {
                    be.addPackageOwner(req.requiredParam('package'),
                                       owner, newOwner, this.parallel());
                }, this);
            },
            function(err) {
                if (err) throw err;
                res.send({message: "Successfully added " + owners.join(', ') +
                          " as owner" + (owners.length == 1 ? "" : "s") +
                          " of " + req.requiredParam('package')});
            }, next);
    });

    /**
     * Removes one or more owners from a package. This should have 'name',
     * `token`, and `package` parameters. It should also have either an `owner`
     * parameter, or a series of `owner#` parameters, with `#` replaced by
     * numbers. Owners are specified by their usernames.
     */
    app.del('/v1/packages/:package/owners', function(req, res, next) {
        var owners;
        step(
            function() {
                be.loadUserWithToken(req.requiredParam('name'),
                                     req.requiredParam('token'),
                                     this);
            },
            function(err, owner) {
                if (err) throw err;
                owners = getOwners_(req);
                _.each(owners, function(removedOwner) {
                    be.removePackageOwner(req.requiredParam('package'),
                                          owner, removedOwner, this.parallel());
                }, this);
            },
            function(err) {
                if (err) throw err;
                res.send({message: "Successfully removed " + owners.join(', ') +
                          " as owner" + (owners.length == 1 ? "" : "s") +
                          " of " + req.requiredParam('package')});
            }, next);
    });

    /**
     * Gets the user metadata for a user.
     *
     * A successful response will contain the `user` key, which is the user
     * metadata (as describd in the marmalade-api(7) manpage).
     */
    app.get('/v1/users/:name', function(req, res, next) {
        step(
            function() {be.loadPublicUser(req.requiredParam('name'), this)},
            function(err, user) {
                if (err) throw err;
                if (!user) throw new base.HttpError(
                      'User "' + req.requiredParam('name') +
                      '" doesn\'t exist', 404);
                delete user.email;
                res.send({
                    message: "Got " + user.name,
                    user: normalize(user)
                });
            }, next);
    });

    /**
     * Registers a new user. This should have `name`, `email`, and `password`
     * parameters.
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
                be.registerUser(req.requiredParam('name'),
                                req.requiredParam('email'),
                                req.requiredParam('password'),
                                this);
            },
            function(err, user) {
                if (err) throw err;
                res.send({
                    message: "Successfully registered " + user.name,
                    name: user.name,
                    token: user.token
                });
            }, next);
    });

    /**
     * Updates a user's information. This should have `name` and `token`
     * parameters, and optionally `email` and `password` paramters.
     */
    app.put('/v1/users', function(req, res, next) {
        var name;
        step(
            function() {
                name = req.requiredParam('name');
                be.loadUserWithToken(
                    name, req.requiredParam('token'), this);
            },
            function(err, user) {
                if (req.param('email')) user.email = req.param('email');
                if (req.param('password'))
                    user.password = req.param('password');
                be.saveUser(user, this);
            },
            function(err) {
                if (err) throw err;
                res.send({message: "Successfully updated " + name});
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
                be.loadUser(req.requiredParam('name'),
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

    /**
     * Resets a user's password. This generates a new, random password for the
     * user and sends that password to the email the user provided during
     * registration.
     */
    app.post('/v1/users/reset', function(req, res, next) {
        step(
            function() {
                be.resetPassword(req.requiredParam('name'), this);
            },
            function(err) {
                if (err) throw err;
                res.send({message: 'Email sent with temporary password.'});
            }, next);
    });

    /**
     * InputErrors should become HttpErrors for the API.
     */
    app.use(function(err, req, res, next) {
        if (err instanceof backend.InputError) {
            next(new base.HttpError(err.message, 400));
        } else next(err, req, res);
    });

    /**
     * If the API doesn't match a /v1/ route, it's an error.
     */
    app.use('/v1/', function(req, res, next) {
        next(new base.HttpError('Cannot ' + req.method + ' ' + req.url, 404));
    });

    /**
     * Send API HttpErrors with JSON bodies.
     */
    app.use(function(err, req, res, next) {
        if (err instanceof base.HttpError) {
            console.log("HTTP Error " + err.code + ": " + err.message);
            res.send({message: err.message}, err.code);
        } else next(err, req, res);
    });

    /**
     * Make all sexp functions available at top-level in API views.
     */
    _.extend(app.viewHelpers, sexp);

    return app;
};

/**
 * Non-destructively recursively normalize the properties in a Mongo record for
 * external consumption. This gets rid of internal attributes (starting with an
 * underscore) and converts the _id attribute to a timestamp integer.
 *
 * @param {Object} obj The object to normalize.
 * @return {Object} The normalized object.
 */
function normalize(obj) {
    if (_.isArray(obj)) {
        return _.map(obj, function(val) {return normalize(val)});
    } else if (obj && obj._id) {
        var newObj = {};
        for (var prop in obj) {
            if (!prop.match(/^_/)) newObj[prop] = normalize(obj[prop]);
        }
        newObj.created = obj._id.generationTime;
        return newObj;
    } else {
        return obj;
    }
};

