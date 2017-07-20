# Simple ISTEX interface to the (N)ERD service

This node.js module can be used to process a set of PDF in a given directory by the [(N)ERD](https://github.com/kermitt2/nerd) service. Results will include the JSON reponse from (N)ERD, a TEI standoff fragment with the identified entities as TEI `<term>` elements and a CVS file with the identified entities. 

## Build and run

You need first to install and start the (N)ERD service, see the [documentation](http://nerd.readthedocs.io). 

Install the present module:

> npm install

Usage: 

> node main -in *PATH_TO_THE_PDFS_TO_PROCESS* -out *WHERE_TO_PUT_THE_RESULTS*

Example:

> node main -in ~/tmp/in/ -out ~/tmp/out/

## Requirements

- mustache
- request
- form-data
- fs
- mkdirp
