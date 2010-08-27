TITLE="Jelly Documentation"

default: doc

clean:
	rm -r html README.html


CODE=lib/backend.js lib/server.js lib/helpers.js lib/packageParser.js	\
     lib/sexpParser.js lib/sexp.js lib/util.js

html/code.html: ${CODE}
	mkdir -p html
	dox --title ${TITLE} $^ > $@

html/index.html: README.md
	mkdir -p html
	ronn -5 $^ > $@

html/api.html: doc/api.md
	mkdir -p html
	ronn -5 $^ > $@

README.html: html/index.html
	ln -sf $^ $@

html: README.html html/code.html html/index.html html/api.html


man/jelly.7.man: README.md
	mkdir -p man
	ronn -r $^ > $@

man/jelly-api.7.man: doc/api.md
	mkdir -p man
	ronn -r $^ > $@

man: man/jelly.7.man man/jelly-api.7.man


doc: html man
