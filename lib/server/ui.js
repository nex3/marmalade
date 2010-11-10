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
    step = require('step'),
    stream = require('marmalade/stream');

exports.install = function(app) {
    /**
     * The main page.
     */
    app.get('/', function(req, res, next) {
        step(
            function() {
                stream.all(
                      app.backend.packageVersionStream(
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
                app.backend.loadUser(req.requiredParam('name'),
                                     req.requiredParam('password'),
                                     this);
            },
            function(err, user) {
                if (err) throw err;
                if (!user) {
                    req.flash('error', 'Invalid username or password');
                    res.render('login.jade');
                } else {
                    req.session.username = user.name;
                    req.session.userToken = user.token;
                    res.redirect(req.session.lastGet || '/', 301);
                }
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
                if (req.requiredParam('password') !=
                    req.requiredParam('password2')) {
                    throw new base.HttpError(
                          "Passwords don't match", 400);
                }

                app.backend.registerUser(req.requiredParam('name'),
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
     * Uploads a new package or package version.
     */
    app.post('/packages', function(req, res, next) {
        var form = new formidable.IncomingForm();
        var file;
        var type;
        step(
            function() {form.parse(req, this)},
            function(err, _, files) {
                if (err) throw err;
                file = files['package'];
                if (!file) {
                    throw new base.HttpError(
                        "Package file upload parameter required", 400);
                } else if (!file.filename.match(/\.(tar|el)$/i)) {
                    throw new base.HttpError(
                        "Package must be in .tar or .el format.", 400);
                } else {
                    type = RegExp.$1.toLowerCase();
                    req.getUser(this);
                }
            },
            function(err, user) {
                if (err) throw err;
                app.backend.savePackageFile(file.path, user, type, this);
            },
            function(err, user) {
                if (err) throw err;
                res.redirect('/', 301);
            },
            next);
    });
};

