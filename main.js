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
//const NERD_URL = "http://cloud.science-miner.com/nerd/service";
//const NERD_URL = "http://nerd.huma-num.fr/nerd/service";

// for making console output less boring
const green = '\x1b[32m';
const red = '\x1b[31m';
const orange = '\x1b[33m';
const white = '\x1b[37m';
const blue = `\x1b[34m`;
const score = '\x1b[7m';
const bright = "\x1b[1m";
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
    "filter": { "property": { "id": "P225"} },
    "minSelectorScore" : 0.3
};

/**
 * List all the PDF files in a directory in a synchronous fashion,
 * @return the list of file names
 */
function getFiles (dir) {
    var fileList = [];
    var files = fs.readdirSync(dir);
    for (var i=0; i<files.length; i++) {
    	if (fs.statSync(path.join(dir, files[i])).isFile()) {
    		if (files[i].endsWith(".pdf") || files[i].endsWith(".PDF") ||
    			files[i].endsWith(".txt") || files[i].endsWith(".TXT") ||
    			files[i].endsWith(".xml") || files[i].endsWith(".XML") ||
    			files[i].endsWith(".tei") || files[i].endsWith(".TEI")
    			)
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

  	var requestQuery = null;
  	if (options.profile && (options.profile == "species"))
		requestQuery = NERD_QUERY_SPECIES;
	else
		requestQuery = NERD_QUERY;

	var form = new FormData();
	if (file.endsWith(".pdf") || file.endsWith(".PDF"))
		form.append("file", fs.createReadStream(options.inPath+"/"+file));
	else if (file.endsWith(".txt") || file.endsWith(".TXT")) {
		var textContent = fs.readFileSync(options.inPath+"/"+file, "utf8");
		requestQuery.text = JSON.stringify(textContent);
	} else {
		console.log("---\nxml/tei processing not yet implemented");
		// move to next file to be processed
		i++;
		sequentialRequests(options, listOfFiles, i);
	}
	form.append("query", JSON.stringify(requestQuery));
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
			// move to next file to be processed
			i++;
			sequentialRequests(options, listOfFiles, i);
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
 * @param {object} options object containing all the information necessary to manage the paths:
 *  - {object} inPath input directory where to find the PDF files
 *  - {object} outPath output directory where to write the results
 *  - {string} profile the profile indicating which filter to use with the (N)ERD service, e.g. "species"
 * @return {undefined} Return undefined
 */
function processNerd(options) {
  	// get the PDF paths
  	var listOfFiles = getFiles(options.inPath);
	console.log("found " + listOfFiles.length + " PDF files to be processed");
	sequentialRequests(options, listOfFiles, 0);
};


/**
 * Write in a file a structured representation with plenty of (N)ERD results, e.g. depending on the 
 * template TEI standoff fragment file or CSV file
 * @param {object} options object containing all the information necessary to manage the paths:
 *  - {string} template path to the template
 *  - {object} outPath output directory
 *  - {object} output output file
 *  - {string} profile the profile indicating which filter to use with the (N)ERD service, e.g. "species"
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
		} else if (process.argv[i-1] == "-eval") {
			options.eval = process.argv[i];
		}
	}

	if (!options.inPath) {
		console.log("Input path is not defines");
		return;
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
	if (options.outPath) {
		fs.lstat(options.outPath, (err, stats) => {
		    if (err)
		        console.log(err);
		    if (stats.isFile()) 
		    	console.log("Output path must be a directory, not a file");
		    if (!stats.isDirectory())
		    	console.log("Output path is not a valid directory");
		});
	}
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

/**
 * Run an evaluation by calling the (N)ERD service based on a gold dataset file
 * JSON
 * @param {object} options object containing all the information necessary to manage the paths:
 *  - {string} gold dataset file path
 *  - {object} inPath input directory where to find the produced CSV files necessary to run the evaluation
 *  - {string} profile the profile indicating which filter to use with the (N)ERD service, e.g. "species"
 * @return {undefined} Return undefined
 */
function evalNerd(options) {
  	// get the expected "gold" results
  	var file = options.eval;
  	var content = fs.readFileSync(file, 'utf8');

  	var lines = content.split(/\r?\n/);
  	var gold = [];
  	var dataFile;
  	var entities;
  	for(var i=1; i<lines.length; i++) {
  		
  		//console.log(lines[i]);
  		var cells = lines[i].split(/\t/);
  		//console.log(cells.length);
  		if (cells.length == 2) {
  			if (cells[0].trim().length != 0) {
  				// we have a new file
  				if (dataFile) {
  					var entry = new Object();
  					entry.file = dataFile;
  					entry.entities = entities;
  					gold.push(entry);
  					//console.log(file);
  					//console.log(entities);
  				}

  				dataFile = cells[0];
  				entities = [];
  			} 
  			if (cells[1].trim().length != 0) {
  				entities.push(cells[1].trim().toLowerCase());
  			}
  		}	
  	}

  	var sum_precision = 0.0;
  	var sum_recall = 0.0;
  	var sum_true_positive = 0;
  	var sum_false_positive = 0;
  	var sum_observed = 0;
  	var sum_expected = 0;
  	// get the observed results and produce metrics
  	for(var i=0; i<gold.length; i++) {
  		var theFile = options.inPath + "/" + gold[i].file + ".csv";
  		// read the species names
  		var theContent = fs.readFileSync(theFile, 'utf8');
  		var theEntities = [];
  		var theLines = theContent.split(/\r?\n/);
  		for(var j=1; j<theLines.length; j++) {
  			var cells = theLines[j].split(/\t/);
  			if ( (cells.length == 7) && (cells[2].trim() == "Species") ) {
  				// we concatenate the "scientific" species name together with the raw actual name 
  				// found in the text, so that we can use the second one as a fallback due to the
  				// policies of the gold dataset we use (if synonyms, use the actual raw name instead 
  				// of the standard scientific name)
	  			if (cells[3].trim().length != 0) {
	  				theEntities.push(cells[3].trim().toLowerCase() + "/" + cells[5].trim().toLowerCase());
	  			}
	  		}
  		}
  		var stats = computeMetrics(theEntities, gold[i].entities);
  		console.log("\n");
  		console.log(orange+'%s\x1b[0m', "file: " + gold[i].file);
  		var entityList = "";
  		for(var j=0; j<theEntities.length; j++) {
  			var pieces = theEntities[j].split("/");
  			if (pieces.length == 0)
  				continue;
  			if (j != 0)
  				entityList += ", ";
			entityList += pieces[0];
		}
		console.log("candidates: " + entityList);
		//console.log("candidates: " + theEntities);

  		console.log("gold: " + gold[i].entities);
  		console.log(stats);

  		var precision = 0.0;
  		if (stats.observed != 0)
	  		precision = stats.true_positive / parseFloat(stats.observed);
  		var recall = 0.0;
		if (stats.expected != 0)
  			recall = stats.true_positive / parseFloat(stats.expected);
  		var f1 = 0.0;
  		if ( (recall != 0.0) && (precision != 0.0) )
  			f1 = 2*precision*recall / (precision+recall);

  		console.log(white+'%s\x1b[0m', "precision \t" + precision);
  		console.log(white+'%s\x1b[0m', "recall    \t" + recall);
  		console.log(white+'%s\x1b[0m', "f1-score  \t" + f1);

  		sum_precision += precision;
  		sum_recall += recall;
  		sum_true_positive += stats.true_positive;
  		sum_false_positive += stats.false_positive;
  		sum_observed += stats.observed;
  		sum_expected += stats.expected;
  	}

  	var macro_precision = sum_precision / gold.length;
  	var macro_recall = sum_recall / gold.length;
  	var macro_f1 = 0.0;
  	if ( (macro_recall != 0.0) && (macro_precision != 0.0) )
  		macro_f1 = 2*macro_precision*macro_recall / (macro_precision+macro_recall);

  	console.log(red+'%s\x1b[0m',"\n---------- macro-average -----------------");
  	console.log(bright+'%s\x1b[0m',"macro precision\t" + macro_precision);
  	console.log(bright+'%s\x1b[0m',"macro recall   \t" + macro_recall);
  	console.log(bright+'%s\x1b[0m',"macro f1-score \t" + macro_f1);

  	var micro_precision = sum_true_positive / parseFloat(sum_observed);
  	var micro_recall = sum_true_positive / parseFloat(sum_expected);
  	var micro_f1 = 0.0;
  	if ( (micro_recall != 0.0) && (micro_precision != 0.0) )
  		micro_f1 = 2*micro_precision*micro_recall / (micro_precision+micro_recall);

  	console.log(red+'%s\x1b[0m',"\n---------- micro-average -----------------");
  	console.log(bright+'%s\x1b[0m',"micro precision\t" + micro_precision);
  	console.log(bright+'%s\x1b[0m',"micro recall   \t" + micro_recall);
  	console.log(bright+'%s\x1b[0m',"micro f1-score \t" + micro_f1);
};

function computeMetrics(observed, gold) {
	var stats = new Object();
	stats.observed = observed.length;
	stats.expected = gold.length;
	var true_positive = 0;
	var false_positive = 0;
	if(observed.length > 0) {
		for(var i=0; i<observed.length; i++) {
			var pieces = observed[i].split("/");
			if (pieces.length != 2)
				continue;
			var scientificName = pieces[0];
			var actualName = pieces[1];
			if ( (gold.indexOf(scientificName) > -1) || (gold.indexOf(actualName) > -1) )
				true_positive += 1;
			else 
				false_positive += 1;
		}	
	}
	stats.true_positive = true_positive;
	stats.false_positive = false_positive;
	return stats;
}


function main() {
	var options = init();
	if (options.eval)
		evalNerd(options);
	else
		processNerd(options);
}

main();
