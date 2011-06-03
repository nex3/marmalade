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
    expressUtils = require("express/utils"),
    step = require("step");
    _ = require("underscore")._,
    jade = require("jade"),
    backend = require("./backend"),
    sexp = require("./sexp"),
    util = require("./util"),
    base = require("./server/base"),
    api = require("./server/api"),
    ui = require("./server/ui");


/**
 * Teach connect the Elisp mime type.
 */
mime.types['.el'] = 'text/x-script.elisp';

/**
 * Connect middleware that extends the request and response objects with useful
 * Marmalade-specific functionality.
 */
function extensions(app) {
    return function(req, res, next) {
        /**
         * Extend res.send so that sent objects are rendered as either Elisp or
         * JSON, depending on the Accept headers.
         */
        var oldSend = _.bind(res.send, res);
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
                body = sexp.sexp(body);
            }

            oldSend.call(this, body, headers, status);
        };

        /**
         * Extend res.render so that the username and flash are passed as locals
         * to the view.
         */
        var oldRender = _.bind(res.render, res);
        res.render = function(view, options, fn) {
            if (typeof options === 'function') {
                fn = options, options = {};
            }
            options = options || {};
            options.locals = _.extend({
                username: req.session.username,
                flash: req.flash(),
                hostname: app.hostname
            }, options.locals || {});
            return oldRender(view, options, fn);
        };

        /**
         * Gets a parameter, or throws an error if it doesn't exist.
         * @param {string} name The name of the parameter.
         * @return {string} value The value of the paramter.
         */
        req.requiredParam = function(name) {
            var val = this.param(name);
            if (!_.isUndefined(val)) return val;
            throw new base.HttpError('Required parameter "' + name + '" not given',
                                     400);
        };

        /**
         * Load the user from the session, or throw an HttpError if that doesn't
         * work.
         *
         * @param {function(Error=, Object=)} callback
         */
        req.getUser = function(callback) {
            var req = this;
            step(
                  function() {
                      if (!req.session.username || !req.session.userToken) {
                          throw new base.LoginRequired();
                      }

                      app.backend.loadUserWithToken(
                            req.session.username,
                            req.session.userToken,
                            this);
                  },
                  function(err, user) {
                      if (err instanceof backend.InputError)
                          throw new base.LoginRequired();
                      if (err) throw err;
                      return user;
                  }, callback);
        }
        req.requireLogin = req.getUser;

        next();
    };
};

/**
 * Create a Marmalade server. This is a standard Express application, with
 * routes and configuration set up for Marmalade. To start it, just call
 * `.create().listen()`.
 * @param {string=} opt_hostname The name of the site this is running on.
 *   Defaults to the value of the `hostname` command.
 * @param {function(Error=, express.Server=)} callback Called with the new
 *   server.
 */
exports.create = function(opt_hostname, callback) {
    if (!callback) {
        callback = opt_hostname;
        opt_hostname = null;
    }
    var app = express.createServer();

    /**
     * The Marmalade backend. This will be set once the caller receives the app.
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
        app.set('views', __dirname + '/views');
        app.use(express.staticProvider(__dirname + '/public'));
        app.use(connect.logger());
        app.use(connect.gzip());
        app.use(connect.conditionalGet());
        app.use(connect.bodyDecoder());
        app.use(express.cookieDecoder());
        app.use(express.session());
        app.use(extensions(app));
    });

    /** ## Helpers */
    app.viewHelpers._ = _;
    app.viewHelpers.h = expressUtils.htmlEscape;

    /**
     * Returns the name portion of the author string (that is, removes the email
     * portion).
     *
     * @param {string} author The author string, usually from a header.
     * @return {string} The author name.
     */
    app.viewHelpers.authorName = function(author) {
        return author ? author.replace(/ *<.*> *$/, '') : '';
    };


    /** # Routing
     *
     * The UI lives in `server/ui.js`.
     *
     * The API lives in `server/api.js`.
     */
    app.use(function(req, res, next) {
        if (!app.api) {
            app.api = api.create(app.backend);
            app.api.settings = app.settings;
            app.api.viewHelpers.__proto__ = app.viewHelpers;
        }
        return app.api.handle(req, res, next);
    });

    app.use(function(req, res, next) {
        if (!app.ui) {
            app.ui = ui.create(app.backend);
            app.ui.settings = app.settings;
            app.ui.viewHelpers.__proto__ = app.viewHelpers;
        }
        return app.ui.handle(req, res, next);
    });


    /** ## Error Handling */

    /**
     * HttpErrors mean that we should send back a specific response code.
     */
    app.error(function(err, req, res, next) {
        if (err instanceof base.HttpError) {
            console.log("HTTP Error " + err.code + ": " + err.message);
            step(
                function() {
                    req.flash('error', err.message);
                    res.render('empty.jade', this);
                },
                function(err_, str) {
                    if (err_) throw err;
                    res.send(str, err.code);
                }, next);
        } else next(err, req, res);
    });

    /**
     * LoginRequireds mean that we should redirect to the login page.
     */
    app.error(function(err, req, res, next) {
        if (err instanceof base.LoginRequired) {
            req.session.loginRequired = true;
            res.redirect("/login", 301);
        } else next(err, req, res);
    });

    /**
     * UserError means that we should display the error message via flash and
     * re-render the form (falling back on the last GET page they visited).
     */
    app.error(function(err, req, res, next) {
        if (err instanceof base.UserError) {
            req.flash('error', err.message);
            if (res.errorView) {
                res.render(res.errorView);
            } else {
                res.redirect(req.lastGet || '/', 301);
            }
        } else next(err, req, res);
    });

    /**
     * Handle other errors using the standard error handler.
     */
    app.configure('development', function() {
        app.error(connect.errorHandler({dumpExceptions: true, showStack: true}));
    });

    app.configure('production', function() {
        app.error(connect.errorHandler());
    });


    /** ## Initialization */

    /**
     * Tell the user when we're ready to accept connections.
     */
    app.addListener('listening', function(err) {
        console.log("Marmalade's spread all over " + app.hostname + ":" +
                    app.address().port);
    });

    /**
     * Initialize the backend before we let the user start the server.
     */
    console.log("Loading database...");
    step(
        function() {
            if (opt_hostname) return opt_hostname;
            else util.run('hostname', [], this);
        },
        function(err, hn) {
            if (err) throw err;
            app.hostname = hn.trim();
            backend.create(app.hostname, this);
        },
        function(err, be) {
            if (err) throw err;
            app.backend = be;
            return app;
        }, callback);
};

/**
 * Add a Jade filter to preserve newlines in a chunk of text.
 * @param {str} The string to preserve.
 */
jade.filters.preserve = function(str) {
    // If filters return newlines, Jade won't mess with them,
    // so we just clean up the trailing newline.
    return str.replace(/\\n$/, '');
};
