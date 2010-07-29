var fs = require("fs"),
    sys = require("sys"),
    spawn = require("child_process").spawn,
    step = require("step"),
    _ = require("underscore")._,
    packageParser = require("./packageParser");

var pkgDir = __dirname + '/packages';

function pkgFile(name) {
    return pkgDir + '/' + name + ".el";
};

exports.savePackage = function(elisp, callback) {
    var pkg = packageParser.parse(elisp);
    step(
        function() {fs.open(pkgFile(pkg.name), "w", 0600, this)},
        function(err, fd) {
            if (err) throw err;
            fs.write(fd, elisp, null, "utf8", this)
        },
        function(err, written) {callback(err, pkg)});
};

exports.loadPackage = function(name, version, callback) {
    fs.readFile(pkgFile(name), "utf8", function(err, elisp) {
        if (err) return callback(err);
        var pkg = packageParser.parse(elisp);
        if (!_.isEqual(pkg.version, version)) {
            var err = new Error("Don't have " + name + ".el version " +
                                version.join(".") + ", only version " +
                                pkg.version.join(".") + "\n");
            err.name = "WrongVersionError";
            callback(err, elisp);
            return;
        }

        callback(null, elisp);
    });
};

function run(command, args, input, callback) {
    if (callback === undefined) {
        callback = input;
        input = null;
    }

    console.log("Running " + command + " " + args.join(" "));
    var child = spawn(command, args);
    var stdout = [];
    var stderr = [];
    child.on('error', callback);
    child.stdout.on('data', function(data) {stdout.push(data.toString('utf8'))});
    child.stderr.on('data', function(data) {stderr.push(data.toString('utf8'))});
    child.on('exit', function(code, signal) {
        if (code !== 0) {
            var err = new Error("Process " + command + " terminated unexpectedly.");
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

exports.saveTarball = function(tar, callback) {
    var tmpDir;
    var name;
    var version;
    var pkg;
    step(
        function() {run("mktemp", ["-d", "-t", "jelly.XXXXXXXXXX"], this)},
        function(err, output) {
            if (err) throw err;
            tmpDir = output.replace(/\n$/, "");
            run("tar", ["--extract", "--directory", tmpDir], tar, this);
        },
        function(err) {
            if (err) throw err;
            fs.readdir(tmpDir, this);
        },
        function(err, files) {
            if (err) throw err;
            var match;
            if (files.length !== 1 ||
                !(match = files[0].match(/^(.+)-([0-9.]+)$/))) {
                throw "ELPA archives must contain exactly one directory," +
                    "named <package>-<version>";
            }
            name = match[1];
            version = packageParser.parseVersion(match[2]);
            var pkgGroup = this.group()();
            var readmeGroup = this.group()();
            fs.readFile(tmpDir + "/" + files[0] + "/" + name + "-pkg.el", "utf8",
                        function(err, elisp) {
                            if (err) throw err;
                            pkgGroup(null, packageParser.parseDeclaration(elisp));
                        });
            fs.readFile(tmpDir + "/" + files[0] + "/README", "utf8",
                        function(err, readme) {
                            if (err) readmeGroup();
                            readmeGroup(null, readme);
                        });
        },
        function(err, pkg_, readme) {
            if (err) throw err;
            pkg = pkg_[0];
            readme = readme[0];
            if (!_.isEqual(pkg.name, name)) {
                throw "Package name \"" + pkg.name + "\" in " + name + "-pkg.el" +
                    " doesn't match archive name \"" + name + "\"!";
            } else if (!_.isEqual(pkg.version, version)) {
                throw "Package version \"" + pkg.version.join(".") + "\" in " +
                    name + "-pkg.el doesn't match archive version \"" +
                    version.join(".") + "\"!";
            }

            pkg.commentary = readme;
            run("rm", ["-rf", tmpDir], function(){});
            fs.writeFile(pkgDir + "/" + pkg.name + ".tar", tar, this);
        },
        function(err) {callback(err, pkg)});
};

exports.getPackages = function(callback) {
    step(
        function() {fs.readdir('packages', this)},
        function(err, files) {
            if (err) throw err;

            _(files).each(function(file) {
                fs.readFile(pkgDir + '/' + file, "utf8", this.parallel());
            });
        },
        function(err /*, elisps... */) {
            if (err) throw(err);
            var elisps = Array.prototype.slice.call(arguments, 1);
            return _(elisps).map(packageParser.parse);
        },
        callback);
};
