# Simple ISTEX client to the (N)ERD service

This node.js module can be used to process a set of PDF in a given directory by the [(N)ERD](https://github.com/kermitt2/nerd) service. Results are written in a given output directory and include: 

* the original JSON reponse from (N)ERD, 

* a TEI standoff fragment with the identified entities as TEI `<term>` elements,

* a CVS file with the identified entities, for the purpose of easier human-eye checking. 

## Build and run

You need first to install and start the (N)ERD service, see the [documentation](http://nerd.readthedocs.io). 

Install the present module:

> npm install

Usage: 

> node main -in *PATH_TO_THE_PDFS_TO_PROCESS* -out *WHERE_TO_PUT_THE_RESULTS*

Example:

> node main -in ~/tmp/in/ -out ~/tmp/out/

Only the files with extension `.pdf` present in the input directory will be processed, the other files will be ignored. 

## Using profile

For using customised queries to (N)ERD, use the parameter `-p` followed by the profile name, for example: 

> node main -in ~/tmp/in/ -out ~/tmp/out/ -p species

Currently the available query profiles are:

* _species_: filter entities so that only living entities are returned 

## Requirements

- mustache
- request
- form-data
- fs
- mkdirp
