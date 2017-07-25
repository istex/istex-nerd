'use strict';

/* Module Require */
var mkdirp = require('mkdirp'),
  mustache = require('mustache'),
  request = require('request'),
  FormData = require('form-data'),
  async = require('async'),
  path = require('path'),
  fs = require('fs');

// the URL of the (N)ERD service (to be changed if necessary)
const NERD_URL = "http://localhost:8090/service";

// for making console output less boring
const green = '\x1b[32m';
const red = '\x1b[31m';
const orange = '\x1b[33m';
const white = '\x1b[37m';
const score = '\x1b[7m';
const reset = '\x1b[0m';

// naked nerd query
const NERD_QUERY = {
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
    "full": true,
    "filter": { "property": { "id": "P225"} }
};

/**
 * List all the PDF files in a directory in a synchronous fashion,
 * @return the list of file names
 */
function getPDFFiles (dir) {
    var fileList = [];
    var files = fs.readdirSync(dir);
    for (var i=0; i<files.length; i++) {
    	if (fs.statSync(path.join(dir, files[i])).isFile()) {
    		if (files[i].endsWith(".pdf") | files[i].endsWith(".PDF"))
            	fileList.push(files[i]);
        }
    }
    return fileList;
}

function sequentialRequests(options, listOfFiles, i) {
  	if (i == undefined) {
  		i = 0;
  	}
  	if (i >= listOfFiles.length) {
  		return;
  	}
	var file = listOfFiles[i];	
  	console.log("---\nProcessing: " + options.inPath+"/"+file);

	var form = new FormData();
	if (options.profile && (options.profile == "species"))
		form.append("query", JSON.stringify(NERD_QUERY_SPECIES));
	else
		form.append("query", JSON.stringify(NERD_QUERY));
	form.append("file", fs.createReadStream(options.inPath+"/"+file));
	form.submit(NERD_URL+"/disambiguate", function(err, res, body) {
		if (err) {
			console.log(err);
			return false;
		}

		if (!res) {
			console.log("(N)ERd service appears unavailable");
			return false;
		}

		res.setEncoding('utf8');

		if (res.statusCode != 200) {
			console.log("Call the (N)ERd service failed with error " + res.statusCode);
			return false;
		}

		var body = "";
	  	res.on("data", function (chunk) {
			body += chunk;
		});
		
		res.on("end", function () {
			mkdirp(options.outPath, function(err, made) {
			    // I/O error
			    if (err) 
			      	return cb(err);

			    // first write JSON reponse 
				var jsonFilePath = options.outPath+"/"+file.replace(".pdf", ".json");
				fs.writeFile(jsonFilePath, body, 'utf8', 
					function(err) { 
						if (err) { 
							console.log(err);
						} 
						console.log("JSON response written under: " + jsonFilePath); 
					}
				);
			
				var jsonBody;
				try {
					jsonBody = JSON.parse(body);
				} catch(err) {
				}

				if (jsonBody) {
			        // create and write the TEI fragment
	  				var teiFilePath = file.replace(".pdf", ".tei");
	  				var localOptionsTei = new Object();
	  				localOptionsTei.outPath = options.outPath;
	  				localOptionsTei.output = teiFilePath;
	  				// complete the options object with information to creating the TEI
					localOptionsTei.template = "resources/nerd.template.tei.xml";
					var dataTei = new Object();
					dataTei.date = new Date().toISOString();
					dataTei.id = file.replace(".pdf","");
					dataTei.entities = [];
					buildEntityDistribution(dataTei.entities, options.profile, jsonBody);
					// render each entity as a TEI <term> element 
					dataTei.line = function () {
						var line = "<term key=\"" + this.wikidataId + 
							"\" cert=\"" + this.confidence + "\">";
						if (this.P225)
							line += this.P225;
						else if (this.preferredTerm)
							line += this.preferredTerm;
						else
							line += this.terms[0]; 
						line += "</term>";
						return line;	
					}
					writeFormattedStuff(dataTei, localOptionsTei, function(err) { 
						if (err) { 
							console.log(err);
						} 
						console.log("TEI standoff fragment written under: " + options.outPath+"/"+localOptionsTei.output); 
					});
					
					// create and write the CSV file
	  				var csvFilePath = file.replace(".pdf", ".csv");
	  				var localOptionsCsv = new Object();
	  				localOptionsCsv.outPath = options.outPath;
	  				localOptionsCsv.output = csvFilePath;
	  				// complete the options object with information to creating the CSV
					localOptionsCsv.template = "resources/nerd.template.csv";
					var dataCsv = new Object();
	  				dataCsv.entities = [];
					buildEntityDistribution(dataCsv.entities, options.profile, jsonBody);
					// render each entity as csv
					dataCsv.line = function () {
							//wikidata id	confidence	rank	species	prefered term	observed raw terms
						var theLine = this.wikidataId + "\t" + this.confidence + "\t";
						if (this.P105)
							theLine += this.P105 + "\t";
						if (this.P225)
							theLine += this.P225 + "\t";
						if (this.preferredTerm)
							theLine += this.preferredTerm + "\t";
						theLine += this.terms.join(", ") + "\t";
						theLine += this.count;
						return theLine;	
					};
					writeFormattedStuff(dataCsv, localOptionsCsv, function(err) { 
						if (err) { 
							console.log(err);
						} 
						console.log("CSV file written under: " + options.outPath+"/"+localOptionsCsv.output); 
					});

					// move to next file to be processed
					i++;
					sequentialRequests(options, listOfFiles, i);
				} else {
					// redo
					console.log("(weird bug from formdata/node.js...)");
					console.log("retry...");
					sequentialRequests(options, listOfFiles, i);
				}
			});
		});
  	})
}

/**
 * Process a PDF file by calling the (N)ERD service and enrich with the resulting
 * JSON
 * @param {function} cb Callback called at the end of the process with the following available parameter:
 *  - {Error} err Read/write error
 * @return {undefined} Return undefined
 */
function processNerd(options) {
  	// get the PDF paths
  	var listOfFiles = getPDFFiles(options.inPath);
	console.log("found " + listOfFiles.length + " PDF files to be processed");
	sequentialRequests(options, listOfFiles, 0);
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
	      	var filename = options.outPath+"/"+options.output;
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
function init() {
	var options = new Object();
	//var inPath; // path to the PDF
	//var outPath; // path where to write the results
	//var nbThread = 1; // number of threads to use when calling (N)ERD
	var attribute; // name of the passed parameter
	// get the path to the PDF to be processed
	for (var i = 1, len = process.argv.length; i < len; i++) {
		if (process.argv[i-1] == "-in") {
			options.inPath = process.argv[i];
		} else if (process.argv[i-1] == "-out") {
			options.outPath = process.argv[i];
		} else if (process.argv[i-1] == "-p") {
			options.profile = process.argv[i];
		}
	}

	// check the input path
	fs.lstat(options.inPath, (err, stats) => {
	    if (err)
	        console.log(err);
	    if (stats.isFile()) 
	    	console.log("Input path must be a directory, not a file");
	    if (!stats.isDirectory())
	    	console.log("Input path is not a valid directory");
	});

	// check the output path
	fs.lstat(options.outPath, (err, stats) => {
	    if (err)
	        console.log(err);
	    if (stats.isFile()) 
	    	console.log("Output path must be a directory, not a file");
	    if (!stats.isDirectory())
	    	console.log("Output path is not a valid directory");
	});
	return options;
}

/**
 * Given the json response body of the (N)ERD disambiguation query, create an
 * array of entities for presentation purpose, where only one instance of an
 * entity is kept with its maximum confidence and the different raw term
 * used in the processed text to refer to the same entity
 * @param {object} entities the array of entities to be filled
 * @param {object} profile name of the profile to consider or null
 * @param {object} json the response body of the (N)ERD disambiguation query
 *
 * @return {undefined} Return undefined
 */
function buildEntityDistribution(entities, profile, json) {
	var nerdEntitites = json.entities;
	var mapEntities = new Map();
	for(var i=0; i<nerdEntitites.length; i++) {
		var item = nerdEntitites[i];
		if (!item.wikidataId)
			continue;
		var theEntity = {};
		theEntity.wikidataId = item.wikidataId;
		theEntity.confidence = item.nerd_score;
		theEntity.terms = [];
		theEntity.terms.push(item.rawName);

		if (item.preferredTerm)
			theEntity.preferredTerm = item.preferredTerm;

		var statements = item.statements;
		if (statements) {
			for(var j=0; j<statements.length; j++) {
				var statement = statements[j];
		
				// taxon rank example -> { "conceptId" : "Q1310289", "propertyId" : "P105", 
				// "propertyName" : "taxon rank", "valueType" : "wikibase-item", 
				// "value" : "Q7432", "valueName" : "Species"}
				if (statement.propertyId == "P105") {
					if (statement.valueName) {
						theEntity.P105 = statement.valueName.replace(" (biology)", "");
						//console.log(theEntity.wikidataId + " - P105: " + theEntity.P105);
					}
				}

				// taxon name example -> { "conceptId" : "Q1310289", "propertyId" : "P225", 
				// "propertyName" : "taxon name", "valueType" : "string", 
				// "value" : "Phrynobatrachus africanus"},
				if (statement.propertyId == "P225") {
					if (statement.value) {
						theEntity.P225 = statement.value;
						//console.log(theEntity.wikidataId + " - P225: " + theEntity.P225);
					}
				}
			}
		}

		if (item.preferredTerm)
			theEntity.preferredTerm = item.preferredTerm;

		if (profile == "species") {
			if (item.P105)
				theEntity.P105 = item.P105;
			if (item.P225)
				theEntity.P225 = item.P225;
		}

		if (!mapEntities.has(theEntity.wikidataId)) {
			theEntity.count = 1;
			mapEntities.set(theEntity.wikidataId, theEntity);
		} else {
			var otherEntity = mapEntities.get(theEntity.wikidataId);
			otherEntity.count += 1;
			if (otherEntity.confidence < theEntity.confidence)
				otherEntity.confidence = theEntity.confidence;
			if (otherEntity.terms.indexOf(item.rawName) <= -1)
				otherEntity.terms.push(item.rawName);
		}
	}

	for (var value of mapEntities.values()) {
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
