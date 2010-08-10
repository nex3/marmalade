var spawn = require("child_process").spawn,
    fs = require("fs"),
    sys = require("sys"),
    step = require("step"),
    _ = require("underscore")._;

/**
 * Run an executable, optionally with a chunk of text to pass to stdin, and call
 * the callback with the output.
 * @param {String} command The name of the executable to run.
 * @param {Array.<string>} args The arguments to the executable.
 * @param {string=} input The string to pass via stdin.
 * @param {function(Error=, string)} callback Passed the collected standard
 *   output from the process.
 */
exports.run = function(command, args, input, callback) {
    if (callback === undefined) {
        callback = input;
        input = null;
    }

    console.log("Running " + command + " " + args.join(" "));
    var child = spawn(command, args);
    var stdout = [];
    var stderr = [];
    child.on('error', callback);
    child.stdout.on('data',
                    function(data) {stdout.push(data.toString('utf8'))});
    child.stderr.on('data',
                    function(data) {stderr.push(data.toString('utf8'))});
    child.on('exit', function(code, signal) {
        if (code !== 0) {
            var err = new Error("Process " + command +
                                " terminated unexpectedly.");
            err.code = code;
            err.signal = signal;
            err.command = command;
            err.args = args;
            err.stderr = stderr.join();
            err.stdout = stdout.join();
            callback(err, err.stdout);
            return;
        }

        callback(null, stdout.join());
    });

    if (input) child.stdin.end(input, 'utf8');
};

/**
 * Creates a class inheriting from `Error`. This class's constructor will take
 * at least one parameter, the error message.
 *
 * @param {string|function} nameOrFn If a string, the name of the class to
 *   create. If a function, a named function that is used as (part of) the
 *   constructor for the new class. The message parameter is not passed to the
 *   function, but other parameters are.
 * @return {function} The class constructor.
 */
exports.errorClass = function(nameOrFn) {
    var name = nameOrFn;
    var fn;
    if (_.isFunction(nameOrFn)) {
        name = nameOrFn.name;
        fn = nameOrFn;
    }

    var err = function(msg) {
        this.name = name;
        this.message = msg;
        Error.call(this, msg);
        Error.captureStackTrace(this, arguments.callee);

        if (fn) {
            fn.apply(this, Array.prototype.slice.call(arguments, 1));
        }
    };
    sys.inherits(err, Error);
    return err;
};
