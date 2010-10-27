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
                res.render('login.jade');
            }, next);
    });
};

