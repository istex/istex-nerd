## Build and run

Install:

> npm install

Usage: 

> node main -in *PATH_TO_THE_PDFS_TO_PROCESS* -out *WHERE_TO_PUT_THE_RESULTS* -nbThreads *NUMBER_OF_THREADS_TO_USE_FOR_CALLING_NERD* 

Example:

> node main -in ~/tmp -out ~/tmp -nbThreads 16 

## Requirements

- mustache
- request
- form-data
- fs
- mkdirp