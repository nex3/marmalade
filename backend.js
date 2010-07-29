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
