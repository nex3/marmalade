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
 * Utility functions for working with streams.
 * Streams are EventEmitters that emit `data`, `error`, and `end` events,
 * and respond to `pause` and `resume` methods.
 * Any number of values may be passed to the `data` callback,
 * but it must be a consistent number throughout the life of the stream.
 */

var sys = require('sys'),
    _ = require('underscore')._;

/**
 * Gets all the values in the stream as one or more arrays.
 * The callback is passed on array for each parameter
 * passed to the `data` callback by the stream.
 *
 * @param {process.EventEmitter} stream
 * @param {function(Error=, Array=...)} callback
 */
exports.all = function(stream, callback) {
    var resultses = [];
    stream.addListener('data', function() {
        var args = Array.prototype.slice.call(arguments, 0);
        if (resultses.length === 0) {
            resultses = _.map(args, function() {return []});
        }

        _.each(args, function(v, i) {resultses[i].push(v)});
    });

    stream.addListener('end', function() {
        var args = _.clone(resultses);
        args.unshift(null);
        callback.apply({}, args);
    });

    stream.addListener('error', callback);
};


/**
 * Returns a new stream that's a view over an existing stream.
 * Pausing and resuming the view will pause and resume the given stream.
 *
 * @param {EventEmitter} stream
 * @return {EventEmitter}
 */
exports.view = function(stream) {
    var newStream = new process.EventEmitter();

    stream.addListener('end', function() {newStream.emit('end')});
    stream.addListener('error', function(e) {newStream.emit('error', e)});

    newStream.pause = _.bind(stream.pause, stream);
    newStream.resume = _.bind(stream.resume, stream);

    return newStream;
};


/**
 * Creates a filtered view of the given string.
 * Only elements for which `filter` returns true are emitted.
 *
 * @param {EventEmitter} stream
 * @param {function : boolean}
 */
exports.filter = function(stream, filter) {
    var newStream = exports.view(stream);

    stream.addListener('data', function() {
        var args = Array.prototype.slice.call(arguments, 0);
        if (filter.apply({}, args)) {
            args.unshift('data');
            newStream.emit.apply(newStream, args);
        }
    });

    return newStream;
};


/**
 * Returns a view of the first `n` elements of a stream.
 * Pauses the underlying stream after `n` elements.
 *
 * @param {EventEmitter} stream
 * @param {number} n
 * @param {boolean=} opt_pause Whether to pause the stream.
 * @return {EventEmitter}
 */
exports.limit = function(stream, n, opt_pause) {
    var i = 0;
    var newStream = exports.filter(stream, function() {
        if (i === n) {
            stream.pause();
            newStream.emit('end');
        }

        i += 1;
        return i <= n;
    });
    return newStream;
};
