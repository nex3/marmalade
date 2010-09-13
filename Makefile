TITLE="Marmalade Documentation"

default: doc

clean:
	rm -rf man README.html

# This only works with the Ruby ronn at time of writing, which is really fine
# because the JS one is pretty bare-bones.
RONN=ronn --pipe

CODE=lib/backend.js lib/server.js lib/helpers.js lib/packageParser.js	\
     lib/sexpParser.js lib/sexp.js lib/util.js

man/code.html: ${CODE}
	mkdir -p html
	dox --title ${TITLE} $^ > $@

README.html: man/marmalade.7
	ln -sf $^.html $@

man/%: doc/%.md
	mkdir -p man
	${RONN} -r $^ > $@
	${RONN} -5 $^ > $@.html

doc: README.html man/code.html man/marmalade.7 man/marmalade.1 man/api.7
