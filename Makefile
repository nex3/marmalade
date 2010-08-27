TITLE="Jelly Documentation"

clean:
	rm doc.html


doc.html: lib/backend.js lib/server.js lib/helpers.js lib/packageParser.js \
          lib/sexpParser.js lib/sexp.js lib/util.js
	dox --title ${TITLE} $^ > $@

doc: doc.html

default: doc
