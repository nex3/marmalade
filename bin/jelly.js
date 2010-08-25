#!/usr/bin/env node

require("jelly/server").create("data", function(err, app) {
    if (err) throw err;
    app.listen();
});
