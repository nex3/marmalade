TITLE="Jelly Documentation"

default: doc

clean:
	rm -r man README.html

# This only works with the Ruby ronn at time of writing, which is really fine
# because the JS one is pretty bare-bones.
RONN=ronn --pipe

CODE=lib/backend.js lib/server.js lib/helpers.js lib/packageParser.js	\
     lib/sexpParser.js lib/sexp.js lib/util.js

man/code.html: ${CODE}
	mkdir -p html
	dox --title ${TITLE} $^ > $@

README.html: man/jelly.7.man
	ln -sf $^ $@

man/%.man: doc/%.md
	mkdir -p man
	${RONN} -r $^ > $@
	${RONN} -5 $^ > $(@:man=html)

doc: README.html man/code.html man/jelly.7.man man/jelly.1.man man/jelly-api.7.man
