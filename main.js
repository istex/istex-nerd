'use strict';

/* Module Require */
var mkdirp = require('mkdirp'),
  mustache = require('mustache'),
  request = require('request'),
  FormData = require('form-data'),
  async = require('async'),
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
    "full": true,
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
	  	files
	  	.filter(function (file) {
        	return fs.statSync(options.inPath + "/" + file).isFile();
		})
		.filter(function (file) {
        	return file.endsWith(".pdf");
		})
	  	.forEach(file => {
	  		var form = new FormData();
	  		if (options.profile && (options.profile == "species"))
				form.append("query", JSON.stringify(NERD_QUERY_SPECIES));
			else
				form.append("query", JSON.stringify(NERD_QUERY));
			form.append("file", fs.createReadStream(options.inPath+"/"+file));
			//console.log("Processing: " + options.inPath+"/"+file);
			form.submit(NERD_URL+"/disambiguate", function(err, res, body) {
				console.log("Processing: " + options.inPath+"/"+file);
				res.setEncoding('utf8');
  				console.log(res.statusCode);

  				// write JSON reponse 
  				var body = "";
			  	res.on("data", function (chunk) {
    				body += chunk				;
  				});
  				res.on("end", function () {
  					//console.log(body);
  					mkdirp(options.outPath, function(err, made) {
					    // I/O error
					    if (err) 
					      	return cb(err);

	  					var jsonFilePath = options.outPath+"/"+file.replace(".pdf", ".json");
	  					fs.writeFile(jsonFilePath, body, 'utf8', 
	  						function(err) { 
	  							if (err) { 
	  								console.log(err);
	  							} 
	  							console.log("JSON response written under: " + jsonFilePath); 
	  						});
		  			
	  					var jsonBody = JSON.parse(body);

				        // create and write the TEI fragment
		  				var teiFilePath = file.replace(".pdf", ".tei");
		  				var localOptionsTei = new Object();
		  				localOptionsTei.outPath = options.outPath;
		  				localOptionsTei.output = teiFilePath;
		  				// complete the options object with information to creating the TEI
						localOptionsTei.template = "resources/nerd.template.tei.xml";

	  					var dataTei = new Object();
	  					dataTei.date = new Date().toISOString();
	  					dataTei.entities = [];
	  					buildEntityDistribution(dataTei.entities, options.profile, jsonBody);
	  					// render each entity as a TEI <term> element 
	  					dataTei.line = function () {
	  						return "<term key=\"" + this.wikidataId + 
	  							"\" cert=\"" + this.confidence + "\">" + 
	  							this.terms[0] + "</term>";
							}
	  					writeFormattedStuff(dataTei, localOptionsTei, function(err) { 
							if (err) { 
								console.log(err);
							} 
							console.log("TEI standoff fragment written under: " + 
								localOptionsTei.outPath + "/" + localOptionsTei.output); 
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
							if (this.preferedTerm)
								theLine += this.preferedTerm + "\t";
							theLine += this.terms.join(", ");
							return theLine;	
						}
	  					writeFormattedStuff(dataCsv, localOptionsCsv, function(err) { 
							if (err) { 
								console.log(err);
							} 
							console.log("CSV file written under: " + 
								localOptionsCsv.outPath + "/" + localOptionsCsv.output); 
						});
	  				});
  				});
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
		} else if (process.argv[i-1] == "-out") {
			options.outPath = process.argv[i];
		} else if (process.argv[i-1] == "-p") {
			options.profile = process.argv[i];
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

		if (item.preferedTerm)
			theEntity.preferedTerm = item.preferedTerm;

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

		if (item.preferedTerm)
			theEntity.preferedTerm = item.preferedTerm;

		if (profile == "species") {
			if (item.P105)
				theEntity.P105 = item.P105;
			if (item.P225)
				theEntity.P225 = item.P225;
		}

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
