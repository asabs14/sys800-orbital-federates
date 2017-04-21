const async = require('asyncawait/async');
const await = require('asyncawait/await');
const bodyParser = require('body-parser');
const cache = require("express-cache-response");
const compression = require('compression');
const express = require('express');
const fs = require('fs');
const minify = require('express-minify');
const path = require('path');
const PORT = process.env.PORT || 3000;
const mongodb = require("mongodb");

const url = 'mongodb://155.246.39.17:27017/orbitalFederates';

let MongoClient = mongodb.MongoClient;

let app = express();

// Webserver starts configuring after connection is established to MongoDB on Stevens network
function startWebserver(db) {
    if (process.env.NODE_ENV === "production") {
        
        // Serve cached static responses to reduce overhead:
        app.use(cache());

        // Enables gzip compression:
        app.use(compression());

        // Set up minify:
        app.use(minify({
            cache: false // false means it caches in memory
        }));
    }

    // Serve static content:
    app.use(express.static(path.join(__dirname, "./public"), {
        extensions: ["html", "htm"]
    }));

    /* Query Parsing Algorithms */

    /*
    Input: state({ context: (string), results: (list) }), line(string), error(list)
    Output: none
    Purpose: Takes in the argument from a CONTEXT function and changes the state.context to reflect the request
    */
    function parseContext (state, line, error) {
        let terms = line.split(" ");
        // Mongo collections are always one word
        if (terms.length > 1) {
            error.push(`Too many arguments in CONTEXT`);
            return;
        }
        state.context = line;
    }

    /*
    Input: state({ context: (string), results: (list) }), line(string), error(list)
    Output: none
    Purpose: Takes in the argument from a FIND function, formulates a Mongo query, queries the MongoDB, puts the results into state.results
    */
    const parseFind = async(function (state, line, error) {
        let query = {};
        // Split by OR, ignoring characters in quotes
        let terms = line.match(/(("(?:\\"|[^"])*")+|[^|])+/g);
        let orList = [];
        // For every OR
        for (let i = 0; i < terms.length; ++i) {
            // Split by AND, ignoring characters in quotes
            terms[i] = terms[i].trim();
            terms[i] = terms[i].match(/(("(?:\\"|[^"])*")+|[^&])+/g);
            let andList = [];
            // For every AND
            for (let j = 0; j < terms[i].length; ++j) {
                terms[i][j] = terms[i][j].trim();
                let matches = terms[i][j].match(/^(.+?)([><!]=?|==)(.+?)$/);
                if (!matches || matches.length !== 4) {
                    error.push(`Comparison statement not valid on Find: ${terms[i][j]}`);
                    return;
                }
                matches[1] = matches[1].trim();
                matches[2] = matches[2].trim();
                matches[3] = matches[3].trim();
                let oper = matches[2];
                switch(oper) {
                    case ">":
                        oper = "$gt";
                        break;
                    case "<":
                        oper = "$lt";
                        break;
                    case ">=":
                        oper = "$gte";
                        break;
                    case "<=":
                        oper = "$lte";
                        break;
                    case "==":
                        oper = "$eq";
                        break;
                    case "!=":
                        oper = "$ne";
                        break;
                    default:
                        error.push(`Equality operator not valid on Find: ${terms[i][j]}`);
                        return;
                }
                try {
                    matches[3] = JSON.parse(matches[3]);
                } catch (err) {
                    error.push(err.message);
                    return;
                }
                // Start creating Mongo Query
                if (matches[1].includes("@len")) {
                    matches[1] = matches[1].slice(0,-4);
                    andList.push({$where: `this.${matches[1]}.length${matches[2]}${matches[3]}`});
                } else {
                    andList.push({[matches[1]]: {[oper]: matches[3]}});
                }
            }
            if (andList.length === 1) {
                orList.push(andList[0]);
            } else {
                orList.push({$and: andList});
            }
        }
        if (orList.length === 1) {
            query = orList[0];
        } else {
            query.$or = orList;
        }

        // Check for context before querying
        if (!state.context) {
            error.push(`No context stated`);
            return;
        }

        // Query database
        let collection = db.collection(state.context);
        if (!collection) {
            error.push(`Context does not exist in database`);
            return;
        }
        try {
            state.results = await (collection.find(query).toArray());
        } catch (err) {
            error.push(err.message);
            return;
        }
        
        return;
    });

    /*
    Input: results(list), lookupArgs(list), pullFromCollection(string), error(list)
    Output: none
    Purpose: Performs Mongo queries to replace referenced ids in "results" with actual objects from the "pullFromCollection"
    */
    const lookUpInDB = async(function(results, lookupArgs, pullFromCollection, error) {
        let lookupFieldList = [];
        try {
            lookupFieldList = results[lookupArgs[0]];
        } catch (err) {
            error.push(err.message);
            return;
        }
        let newList = [];
        for (let j = 0; j < lookupFieldList.length; ++j) {
            let replaceFieldList = [];
            try {
                replaceFieldList = await (pullFromCollection.find({ [lookupArgs[2]]: lookupFieldList[j] }).toArray());
            } catch(err) {
                error.push(err.message);
                return;
            }
            if (replaceFieldList.length === 1) replaceFieldList = replaceFieldList[0];
            newList.push(replaceFieldList);
        }
        // Replace the field name in "results" that was looked up if the user has provided a new name for it
        if (lookupArgs.length === 4) {
            results[lookupArgs[3].trim()] = newList;
            delete results[lookupArgs[0]];
        } else {
            results[lookupArgs[0]] = newList;
        }
    });

    /*
    Input: state({ context: (string), results: (list) }), line(string), error(list)
    Output: none
    Purpose: Takes in the argument from a LOOKUP function, formulates a Mongo query, queries the MongoDB, 
        puts the results into appropriate field in state.results and replaces field if necessary
    */
    const parseLookup = async(function(state, line, error) {
        // Check for current context
        if (!state.context) {
            error.push(`No context stated`);
            return;
        }
        // Check for valid lookup
        const lookupArgs = line.split(",");
        if (lookupArgs.length < 3) {
            error.push(`Not enough arguments for LOOKUP`);
            return;
        }
        lookupArgs[1] = lookupArgs[1].trim();
        let pullFromCollection = db.collection(lookupArgs[1]);
        if (!pullFromCollection) {
            error.push(`Context ${lookupArgs[1]} does not exist in database`);
            return;
        }
        
        lookupArgs[0] = lookupArgs[0].trim();
        lookupArgs[2] = lookupArgs[2].trim();
        // Array of promises to be executed synchronously
        let promiseList = [];
        for (let i = 0; i < state.results.length; ++i) {
            promiseList.push(lookUpInDB(state.results[i], lookupArgs, pullFromCollection, error));
        }
        // Wait for lookups to finish
        await(promiseList);
        return;
    });

    /*
    Input: state({ context: (string), results: (list) }), line(string), error(list)
    Output: none
    Purpose: Allows the user to run custom JavaScript on each result to filter results (especially after lookup) 
    */
    function parseWhere (state, line, error) {
        // Create a function using the user's input
        const userFunction = new Function (`return ${line};`);
        // Run the function on each result. If the function returns boolean "true", the result stays, if "false", it is removed
        state.results = state.results.filter(function (result) {
            // Calls user defined function with each corresponding "result" becoming "this" in the scope of each run of the user defined function
            return userFunction.call(result);
        });
    }

    /*
    Input: query(string), error(list)
    Output: state.results(list)
    Purpose: Parse a query and return the results
    */
    const parseQuery = async(function (query, error) {
        // Main object to handle context and results
        let state = {"context": "", "results": []};
        lines = query.split("\n");
        for (var i = 0; i < lines.length; ++i) {
            let line = lines[i].split(":",2);
            let fn = line[0].trim().toLowerCase();
            if (line.length <= 1) {
                error.push(`No argument given on ${line}`);
                return "";
            }
            let arg = line[1];
            arg = arg.trim();
            switch(fn) {
                case "context":
                    parseContext(state, arg, error);
                    break;
                case "find":
                    await (parseFind(state, arg, error));
                    if (error.length > 0) return "";
                    break;
                case "lookup":
                    await (parseLookup(state, arg, error));
                    if (error.length > 0) return "";
                    break;
                case "where":
                    parseWhere(state, arg, error);
                    break;
                default:
                    error.push(`No function given on ${line}`);
                    return "";
            }
        }
        return state.results;
    });

    // Receive POST from client
    app.post("/api/query", bodyParser.json(), async (function (req, res) {
        let error = [];
        let results = await (parseQuery(req.body.query, error));

        // If there are errors
        if (error.length > 0) {
            res.send({Error: error});
        } else {
            res.send(results);
        }
    }));

    app.listen(PORT, function () {
        console.log(`Example app listening on port ${PORT}`);
    })
}

// Webserver starts here
MongoClient.connect(url, function (err, db) {
    if (err) {
        console.log('Unable to connect to the mongoDB server. Error:', err);
    } else {
        startWebserver(db);
    }
});