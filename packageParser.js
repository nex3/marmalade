var sexpParser = require("./sexpParser");

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

function parseVersion(str) {
    var nums = [];
    var split = str.split(".");
    for (var i = 0; i < split.length; i++) nums.push(+split[i]);
    return nums;
};


exports.parse = function(elisp) {
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

    var parsedRequires = [];
    if (requires) {
        var arr = sexpParser.parse(requires);
        for (var i = 0; i < arr.length; i++)
            parsedRequires.push([arr[i][0], parseVersion(arr[i][1])]);
    }
    parsedVersion = parseVersion(version);

    return {
        name: filename,
        description: desc,
        commentary: commentary,
        requires: parsedRequires,
        version: parsedVersion
    };
};
