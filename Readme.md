# Simple ISTEX client to the entity-fishing service

This node.js module can be used to process a set of PDF in a given directory by [entity-fishing](https://github.com/kermitt2/nerd) service. Results are written in a given output directory and include: 

* the original JSON reponse from *entity-fishing* (extension `.json`), 

* a TEI standoff fragment with the identified entities as TEI `<term>` elements (extension `.tei`),

* a CVS file with the identified entities, for the purpose of easier human-eye checking (extension `.csv`). 

## Build and run

You need first to install and start the *entity-fishing* service, version **0.0.3**, see the [documentation](http://nerd.readthedocs.io/en/0.0.3/). It is assumed that the server will run on the address `http://localhost:8090`. You can change the server address by editing the file `main.js`.

When the server is up and running, install the present module:

> npm install

Usage: 

> node main -in *PATH_TO_THE_PDFS_TO_PROCESS* -out *WHERE_TO_PUT_THE_RESULTS*

Example:

> node main -in ~/tmp/in/ -out ~/tmp/out/

Only the files with extension `.pdf` present in the input directory (`-in`) will be processed, the other files will be ignored. Results will be written in the output directory (`-out`), reusing the file name with different file extensions (see above).

Note that with _node.js_ for exploiting the parallelism/multithreading capacities of the *entity-fishing* server, you need to start several _node.js_ in parallel (_fork_) and partition the set of PDF files to be processed. 

## Using profile

For using customised queries to *entity-fishing*, use the parameter `-p` followed by the profile name, for example: 

> node main -in ~/tmp/in/ -out ~/tmp/out/ -p species

Currently the available query profiles are:

* _species_: filter entities so that only living entities are returned 

## Evaluation for species

After running the client on a set of PDF files, you can run an evaluation by specifying an evaluation file (gold data) as given in example in `resources/test_gold.csv`:

> node main -eval resources/test_gold.csv -in ~/tmp/in/ -p species

The path given by the parameter `-in` must contain the CVS files resulting from the process of the PDF documents mentionned in the evaluation file. Some standard evaluation metrics will be printed on the output console. 

## Requirements

- mustache
- async
- request
- form-data
- fs
- mkdirp
- path
