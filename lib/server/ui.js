/**
 * The web frontend for Jelly.
 * Eventually, this will be more fleshed out than it is right now.
 */

exports.install = function(app) {
    /**
     * The main page. Very bare at the moment.
     */
    app.get('/', function(req, res) {
        res.render('index.jade');
    });
};

