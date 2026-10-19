#!/bin/sh
# Met à jour la version web (iPhone / navigateur) publiée sur GitHub Pages : docs/app = copie de www
rm -rf docs/app && mkdir -p docs/app && cp -r www/. docs/app/
