TITLE="Jelly Documentation"

clean:
	rm doc.html


doc.html: backend.js server.js helpers.js packageParser.js sexpParser.js sexp.js util.js
	dox --title ${TITLE} $^ > $@

doc: doc.html

default: doc
