var fs = require("fs"),
    _ = require("underscore")._,
    step = require("step"),
    util = require("./util");
    sexpParser = require("./sexpParser");

function escape(str) {
    return str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};

var headerPrefix = "^;+[ \t]+(?:@\\(#\\))?[ \t]*\\$?";

function getHeader(elisp, header) {
    var rx = new RegExp(headerPrefix + escape(header) + "[ \t]*:[ \t]*(.*)", "im");
    var match = elisp.match(rx);
    return match && match[1];
};

function getSection(elisp, rx) {
    startRx = new RegExp("^(;{3};*) (" + rx.source + ")[ \t]*:", "im");
    var startMatch = elisp.match(startRx);
    if (!startMatch) return null;
    elisp = elisp.substring(startMatch.index + startMatch[0].length);
    var level = startMatch[1].length;

    var endRx = new RegExp("^;{3," + level + "} .*:", "m");
    var endMatch = elisp.match(endRx);
    if (!endMatch) throw "Unterminated section: " + startMatch[2];

    return startMatch[0] + elisp.substring(0, endMatch.index);
};

function stripRCS(str) {
    if (!str) return str;
    if (!str.match(/^[ \t]*\$Revision:[ \t]([0-9.]+)[ \t]*\$$/)) return str;
    return RegExp.$1;
};

function parseRequires(str) {
    if (!str) return [];
    return _(sexpParser.parse(str)).map(function(require) {
        return [require[0], parseVersion(require[1])];
    });
};

function parseVersion(str) {
    return _(str.split(".")).map(Number);
};


exports.parseElisp = function(elisp) {
    var startMatch = elisp.match(/^;;; ([^ ]*)\.el --- (.*)$/m);
    if (!startMatch) throw "No starting comment for package";

    var filename = startMatch[1];
    var desc = startMatch[2];

    var endRx = new RegExp("^;;; " + escape(filename) + "\\.el ends here", "m");
    var endMatch = elisp.match(endRx);
    if (!endMatch) throw "No closing comment for package";

    elisp = elisp.substring(startMatch.index, endMatch.index + endMatch[0].length);
    var requires = getHeader(elisp, "package-requires");
    var version = stripRCS(getHeader(elisp, "package-version") ||
                           getHeader(elisp, "version"));
    if (!version)
        throw 'Package does not have a "Version" or "Package-Version" header';
    var commentary = getSection(elisp, /commentary|documentation/);

    requires = parseRequires(requires);
    version = parseVersion(version);

    return {
        name: filename,
        description: desc,
        commentary: commentary,
        requires: requires,
        version: version,
        type: "single"
    };
};

function parseDeclaration(elisp) {
    var sexp = sexpParser.parse(elisp);
    if (!_.isArray(sexp) || !sexp[0] === "define-package") {
        throw "Expected a call to define-package";
    }

    var name = sexp[1];
    var version = parseVersion(sexp[2]);
    var desc = sexp[3];
    var requires = parseRequires(sexp[4]);

    return {
        name: name,
        description: desc,
        requires: requires,
        version: version,
        type: "tar"
    };
};

exports.parseTar = function(tar, callback) {
    var tmpDir;
    var name;
    var version;
    var pkg;
    step(
        function() {util.run("mktemp", ["-d", "-t", "jelly.XXXXXXXXXX"], this)},
        function(err, output) {
            if (err) throw err;
            tmpDir = output.replace(/\n$/, "");
            util.run("tar", ["--extract", "--directory", tmpDir], tar, this);
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
            version = parseVersion(match[2]);
            var pkgGroup = this.group()();
            var readmeGroup = this.group()();
            fs.readFile(tmpDir + "/" + files[0] + "/" + name + "-pkg.el", "utf8",
                        function(err, elisp) {
                            if (err) throw err;
                            pkgGroup(null, parseDeclaration(elisp));
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
            util.run("rm", ["-rf", tmpDir], function(){});
            return pkg;
        },
        callback);
};
