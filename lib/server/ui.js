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
 * The web frontend for Marmalade.
 * Eventually, this will be more fleshed out than it is right now.
 */

var sys = require('sys'),
    url = require('url'),
    querystring = require('querystring'),
    step = require('step'),
    express = require("express"),
    stream = require('marmalade/stream');

/**
 * The number of packages in each page in the search results.
 * @type {number}
 * @const
 */
var PACKAGES_PER_PAGE = 20;

/**
 * Create the Marmalade UI server, for handling the web UI.
 * @param {backend.Backend} be The Marmalade backend.
 * @return {express.Server} The UI server.
 */
exports.create = function(be) {
    var app = express.createServer();

    /**
     * HTML-escape text and add some very basic HTML formatting.
     *
     * @param {string} text The text to format.
     * @return {string} The formatted text.
     */
    app.viewHelpers.formatText = function(text) {
        return '<p>' + this.h(text).replace(/\n\n+/, '</p><p>') + '</p>';
    };

    /**
     * Returns the path for downloading the given package.
     *
     * @param {Object} version The package version metadata.
     * @return {string} The path.
     */
    app.viewHelpers.packageDownloadPath = function(version) {
        return '/packages/' + version._name + '-' + version.version.join('.') +
            '.' + (version.type == 'single' ? 'el' : 'tar');
    };

    /**
     * Return the current URL, with the page parameter set to `n`.
     *
     * @param {number} n The page number for the new URL.
     * @return {string} The URL.
     */
    app.dynamicViewHelpers.pagePath = function(req, res) {
        return function(n) {
            var u = url.parse(req.url, true /* parseQueryString */);
            u.query = u.query || {};
            u.query.page = String(n);
            u.search = '?' + querystring.stringify(u.query);
            return url.format(u);
        };
    };

    /**
     * Set up req.session.lastGet so that it will contain the URL of the
     * last GET this user performed against the server.
     */
    app.use(function(req, res, next) {
        req.lastLastGet = req.session.lastGet;
        req.lastThisGet = req.session.thisGet;
        if (req.session.thisGet) req.session.lastGet = req.session.thisGet;
        req.session.thisGet = (req.method == 'GET' ? req.url: null);

        next();
    });

    /**
     * The main page.
     */
    app.get('/', function(req, res, next) {
        step(
            function() {
                stream.all(
                      be.packageVersionStream(
                          {}, [], {sort: [['_id', -1]], limit: 10}),
                      this);
            },
            function(err, packages) {
                if (err) throw err;
                res.render('index.jade', {
                    locals: {packages: packages || [], sys: sys}
                });
            }, next);
    });

    /**
     * The login page, for signing in.
     */
    app.get('/login', function(req, res, next) {
        step(
            function() {
                // Don't ever redirect people to /login after login
                req.session.thisGet = null;

                if (req.session.loginRequired) {
                    req.flash('error',
                              'You must be logged in to view this page. ' +
                              'If you don\'t have an account, [sign up here]' +
                              '(/register).');
                }
                delete req.session.loginRequired;
                res.render('login.jade');
            }, next);
    });

    /**
     * Logs a user in.
     */
    app.post('/login', function(req, res, next) {
        step(
            function() {
                res.errorView = 'login.jade';
                be.loadUser(req.requiredParam('name'),
                            req.requiredParam('password'),
                            this);
            },
            function(err, user) {
                if (err) throw err;
                if (!user) {
                    throw new base.UserError('Invalid username or password');
                }
                req.session.username = user.name;
                req.session.userToken = user.token;
                res.redirect(req.session.lastGet || '/', 301);
            }, next);
    });

    /**
     * Logs a user out.
     */
    app.post('/logout', function(req, res, next) {
        step(
            function() {
                delete req.session.username;
                delete req.session.userToken;
                res.redirect(req.session.lastGet || '/', 301);
            }, next);
    });

    /**
     * The registration page, for signing up.
     */
    app.get('/register', function(req, res, next) {
        step(
            function() {
                // Don't ever redirect people to /register after register
                req.session.thisGet = null;

                res.render('register.jade');
            }, next);
    });

    /**
     * Registers a new user.
     */
    app.post('/register', function(req, res, next) {
        step(
            function() {
                res.errorView = 'register.jade';
                if (req.requiredParam('password') !=
                    req.requiredParam('password2')) {
                    throw new base.UserError("Passwords don't match");
                }

                be.registerUser(req.requiredParam('name'),
                                req.requiredParam('email'),
                                req.requiredParam('password'),
                                this);
            },
            function(err, user) {
                if (err) throw err;
                req.session.username = user.name;
                req.session.userToken = user.token;
                res.redirect(req.session.lastGet || '/', 301);
            }, next);
    });

    /**
     * Lists all packages.
     */
    app.get('/packages', function(req, res, next) {
        var query;
        var page;
        step(
            function() {
                query = req.param('q');
                page = Number(req.param('page')) || 0;
                page = Math.max(Math.floor(page), 0);
                opts = {
                    skip: page * PACKAGES_PER_PAGE,
                    limit: PACKAGES_PER_PAGE + 1
                };
                stream.all(query ? be.searchPackages(query, [], opts) :
                                   be.packageStream({}, [], opts),
                           this);
            },
            function (err, packages) {
                if (err) throw err;
                packages = packages || [];
                var hasNextPage = !!packages[PACKAGES_PER_PAGE];
                if (hasNextPage) packages.pop();
                res.render('packages/index.jade', {
                    locals: {
                        query: query,
                        page: page,
                        hasNextPage: hasNextPage,
                        packages: packages
                    }
                });
            });
    });

    /**
     * The page for creating a new package.
     */
    app.get('/packages/new', function(req, res, next) {
        step(
            function() {req.requireLogin(this)},
            function(err) {
                if (err) throw err;
                res.render('packages/new.jade');
            }, next);
    });

    /**
     * The page for displaying a single package.
     */
    app.get(/^\/packages\/([^\/]+)\/?$/, function(req, res, next) {
        step(
            function() {be.loadPackage(req.params[0], this)},
            function(err, pkg) {
                if (err) throw err;
                res.render('packages/show.jade', {locals: {
                    pkg: pkg,
                    version: pkg._latestVersion
                }});
            });
    });

    /**
     * The page for displaying a specific version of a single package.
     */
    app.get(/^\/packages\/([^\/]+)\/([0-9]+(?:\.[0-9]+)*)\/?$/, function(
          req, res, next) {
        step(
            function() {
                var version = _.map(req.params[1].split('.'), Number);
                be.loadPackageVersion(req.params[0], version, this);
            },
            function(err, pkg, version) {
                if (err) throw err;
                res.render('packages/show.jade', {locals: {
                    pkg: pkg, version: version
                }});
            });
    });

    /**
     * Uploads a new package or package version.
     */
    app.post('/packages', function(req, res, next) {
        var form = new formidable.IncomingForm();
        var file;
        var type;
        step(
            function() {
                res.errorView = 'packages/new.jade'
                form.parse(req, this);
            },
            function(err, _, files) {
                if (err) throw err;
                file = files['package'];
                if (!file) {
                    throw new base.UserError(
                        "Package file upload parameter required");
                } else if (!file.filename.match(/\.(tar|el)$/i)) {
                    throw new base.UserError(
                        "Package must be in .tar or .el format.");
                } else {
                    type = RegExp.$1.toLowerCase();
                    req.getUser(this);
                }
            },
            function(err, user) {
                if (err) throw err;
                be.savePackageFile(file.path, user, type, this);
            },
            function(err, user) {
                if (err) throw err;
                res.redirect('/', 301);
            },
            next);
    });

    /**
     * InputErrors should become UserErrors for the UI.
     */
    app.use(function(err, req, res, next) {
        if (err instanceof backend.InputError) {
            next(new base.UserError(err.message));
        } else next(err, req, res);
    });

    /**
     * Reset lastGet if none of these paths matched.
     */
    app.use(function(req, res, next) {
        req.session.lastGet = req.lastLastGet;
        req.session.thisGet = req.lastLastGet;

        next();
    });

    return app;
};

