'use strict';

/* Module Require */
var //dateFormat = require('dateformat'),
  //cheerio = require('cheerio'),
  mkdirp = require('mkdirp'),
  mustache = require('mustache'),
  request = require('request'),
  FormData = require('form-data'),
  fs = require('fs');
  //path = require('path'),
  //extend = require('util')._extend,
  //child_process = require('child_process');

// the URL of the (N)ERD service (to be changed if necessary)
const NERD_URL = "http://localhost:8090/service/disambiguate";

// static stuff
const JSON_EXTENSION = new RegExp(/(.json)$/g);
const XML_EXTENSION = new RegExp(/(.xml)$/g);
const TEI_EXTENSION = new RegExp(/(.tei)/g);
const PDF_EXTENSION = new RegExp(/(.pdf)/g);

// for making output less boring
const green = '\x1b[32m';
const red = '\x1b[31m';
const orange = '\x1b[33m';
const white = '\x1b[37m';
const score = '\x1b[7m';
const reset = '\x1b[0m';


// naked nerd query
const NERD_QUERY ={
    "language": {
        "lang": "en"
    },
    "onlyNER": false,
    "resultLanguages": [
        "de",
        "fr"
    ],
    "nbest": false,
    "customisation": "generic"
};

// nerd query with filter for species
const NERD_QUERY_SPECIES = {
    "language": {
        "lang": "en"
    },
    "onlyNER": false,
    "resultLanguages": [
        "de",
        "fr"
    ],
    "nbest": false,
    "customisation": "generic",
    "filter": { "property": { "id": "P225"} }
};

/**
 * Process a PDF file by calling the (N)ERD service and enrich with the resulting
 * JSON
 * @param {function} cb Callback called at the end of the process with the following available parameter:
 *  - {Error} err Read/write error
 * @return {undefined} Return undefined
 */
function processNerd(options, cb) {
  	// get the PDF paths
	fs.readdir(options.inPath, function(err, files) {
	  	files.forEach(file => {
	  		//options.pdfs.push(options.inPath+"/"+file);
	  		console.log(options.inPath+"/"+file);

	  		var form = new FormData();
			form.append("query", JSON.stringify(NERD_QUERY_SPECIES));
			form.append("file", fs.createReadStream(options.inPath+"/"+file));

			form.submit(NERD_URL, function(err, res, body) {
  				console.log(res.statusCode);
  				res.setEncoding('utf8');

  				// write JSON reponse
  				res.on('data', function (chunk) {
  					//console.log(chunk);
  					mkdirp(options.outPath, function(err, made) {
					    // I/O error
					    if (err) 
					      	return cb(err);

	  					var jsonFilePath = options.outPath+"/"+file.replace(".pdf", ".json");
	  					fs.writeFile(jsonFilePath, chunk, 'utf8', 
	  						function(err) { 
	  							if (err) { 
	  								console.log(err);
	  							} 
	  							console.log("JSON response written under: " + jsonFilePath); 
	  						});
		  			});
  				});
  				
  				// write TEI based on the JSON
  				{
	  				var jsonFilePath = file.replace(".pdf", ".tei");
	  				var localOptionsTei = new Object();
	  				localOptionsTei.outPath = options.outPath;
	  				localOptionsTei.output = jsonFilePath;
	  				// complete the options object with information to creating the TEI
					localOptionsTei.template = "resources/nerd.template.tei.xml";
	  				res.on('data', function (chunk) {
	  					//console.log(chunk);
	  					var jsonChunk = JSON.parse(chunk);
	  					var data = new Object();
	  					data.date = new Date().toISOString();
	  					data.entities = [];
	  					buildEntityDistribution(data.entities, jsonChunk);
	  					// render each entity as a TEI <term> element 
	  					data.line = function () {
	  						return "<term key=\"" + this.wikidataId + 
	  							"\" cert=\"" + this.confidence + "\">" + 
	  							this.terms[0] + "</term>";
  						}
	  					writeFormattedStuff(data, localOptionsTei, function(err) { 
							if (err) { 
								console.log(err);
							} 
							console.log("TEI standoff fragment written under: " + 
								localOptionsTei.outPath + "/" + localOptionsTei.output); 
						});
	  				});
	  			}

  				// write CSV based on the JSON
  				{
	  				var csvFilePath = file.replace(".pdf", ".csv");
	  				var localOptionsCsv = new Object();
	  				localOptionsCsv.outPath = options.outPath;
	  				localOptionsCsv.output = csvFilePath;
	  				// complete the options object with information to creating the CSV
					localOptionsCsv.template = "resources/nerd.template.csv";
	  				res.on('data', function (chunk) {
	  					//console.log(chunk);
	  					var jsonChunk = JSON.parse(chunk);
	  					var data = new Object();
	  					data.date = new Date().toISOString();
	  					data.entities = [];
	  					buildEntityDistribution(data.entities, jsonChunk);
	  					// render each entity as csv
	  					data.line = function () {
    						return this.wikidataId + "\t" + this.confidence + "\t"+ this.terms.join(", ");
  						}
	  					writeFormattedStuff(data, localOptionsCsv, function(err) { 
							if (err) { 
								console.log(err);
							} 
							console.log("CSV file written under: " + 
								localOptionsCsv.outPath + "/" + localOptionsCsv.output); 
						});
	  				});
	  			}
			});
	  	});
	});
};


/**
 * Write in a file a structured representation with plenty of (N)ERD results, e.g. depending on the 
 * template TEI standoff fragment file or CSV file
 * @param {object} options object containing all the information necessary to manage the paths :
 *  - {string} template path to the template
 *  - {object} outPath output directory
 *  - {object} output output file
 * @param {object} data data to be inserted in the template
 * @param {function} cb Callback called at the end of the process with the following available parameter:
 *  - {Error} err Read/write error
 * @return {undefined} Return undefined
 */
function writeFormattedStuff(data, options, cb) {
  	// getting the template
  	fs.readFile(options.template, "utf-8", function(err, tpl) {
    	// error reading the template
    	if (err) 
    		return cb(err);
    	// the output directory does not exists
    	mkdirp(options.outPath, function(err, made) {
	      	// I/O error
	      	if (err) 
	      		return cb(err);
	      	var filename = options.outPath + "/" + options.output;
	      	// Building the composed structured representation from the template and data
	      	var fragment = mustache.render(tpl, data);
	      	// writing the structured file
	      	fs.writeFile(filename, fragment, "utf8", function(err) {
	        	return cb(err);
	      	});
    	});
  	});
};


/**
 * Init the main object with paths passed with the command line
 */
function init(cb) {
	var options = new Object();
	//var inPath; // path to the PDF
	//var outPath; // path where to write the results
	//var nbThread = 1; // number of threads to use when calling (N)ERD
	var attribute; // name of the passed parameter
	// get the path to the PDF to be processed
	for (var i = 1, len = process.argv.length; i < len; i++) {
		if (process.argv[i-1] == "-in") {
			options.inPath = process.argv[i];
		} else if (process.argv[i-1] == "-nbThreads") {
			options.nbThreads = process.argv[i];
		} else if (process.argv[i-1] == "-out") {
			options.outPath = process.argv[i];
		}
	}

	// check the input path
	fs.lstat(options.inPath, (err, stats) => {
	    if (err)
	        return cb(err);
	    if (stats.isFile()) 
	    	return cb(new Error("Input path must be a directory, not a file"));
	    if (!stats.isDirectory())
	    	return cb(new Error("Input path is not a valid directory"));
	});

	// check the output path
	fs.lstat(options.outPath, (err, stats) => {
	    if (err)
	        return cb(err);
	    if (stats.isFile()) 
	    	return cb(new Error("Output path must be a directory, not a file"));
	    if (!stats.isDirectory())
	    	return cb(new Error("Output path is not a valid directory"));
	});

	return options;
}

function buildEntityDistribution(entities, json) {
	var nerdEntitites = json.entities;
	var mapEntities = new Map();
	for(var i=0; i<nerdEntitites.length; i++) {
		var item = nerdEntitites[i];
		var theEntity = {};
		theEntity.wikidataId = item.wikidataId;
		theEntity.confidence = item.nerd_score;
		theEntity.terms = [];
		theEntity.terms.push(item.rawName);

		if (!mapEntities.has(theEntity.wikidataId)) {
			mapEntities.set(theEntity.wikidataId, theEntity);
		} else {
			var otherEntity = mapEntities.get(theEntity.wikidataId);
			if (otherEntity.confidence < theEntity.confidence)
				otherEntity.confidence = theEntity.confidence;
			if (otherEntity.terms.indexOf(item.rawName) <= -1)
				otherEntity.terms.push(item.rawName);
		}
	}

	for (var entry of mapEntities.entries()) {
	    var value = entry[1];
	    entities.push(value);
	}

	entities.sort(function(a, b) {
    	return parseFloat(b.confidence) - parseFloat(a.confidence);
	});
}

function main() {
	var options = init();
	processNerd(options);
}

main();
