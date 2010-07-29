var fs = require("fs"),
    sys = require("sys"),
    step = require("step"),
    _ = require("underscore")._,
    packageParser = require("./packageParser");

var pkgDir = __dirname + '/packages';

function pkgFile(name) {
    return pkgDir + '/' + name + ".el";
};

exports.savePackage = function(elisp, callback) {
    var pkg = packageParser.parseElisp(elisp);
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
        if (err) {
            return;
            callback(err);
        }

        var pkg = packageParser.parseElisp(elisp);
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

exports.saveTarball = function(tar, callback) {
    var pkg;
    step(
        function() {packageParser.parseTar(tar, this)},
        function(err, pkg_) {
            if (err) throw err;
            pkg = pkg_;
            fs.writeFile(pkgDir + "/" + pkg.name + ".tar", tar, this);
        },
        function(err) {
            callback(err, pkg);
        })
};

exports.getPackages = function(callback) {
    step(
        function() {fs.readdir('packages', this)},
        function(err, files) {
            if (err) throw err;

            var fileGroup = this.group();
            _(files).each(function(file) {
                var cb = fileGroup();
                fs.readFile(pkgDir + '/' + file, function(err, data) {
                    cb(null, [file, data]);
                });
            });
        },
        function(err, packages) {
            if (err) throw err;
            var pkgGroup = this.group();
            _(packages).each(function(pkg) {
                var file = pkg[0],
                    data = pkg[1];
                if (file.match(/\.el$/)) {
                    pkgGroup()(null, packageParser.parseElisp(data.toString('utf8')));
                } else {
                    packageParser.parseTar(data, pkgGroup());
                }
            });
        },
        callback);
};
