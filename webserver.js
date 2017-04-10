const async = require('asyncawait/async');
const await = require('asyncawait/await');
const bodyParser = require('body-parser');
const cache = require("express-cache-response");
const compression = require('compression');
const engine = require('express-dot-engine');
const express = require('express');
const fs = require('fs');
const minify = require('express-minify');
const path = require('path');
const PORT = process.env.PORT || 3000;
const mongodb = require("mongodb");

const url = 'mongodb://155.246.39.17:27017/orbitalFederates';

let MongoClient = mongodb.MongoClient;

let app = express();

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

    app.engine('dot', engine.__express);
    app.set('views', path.join(__dirname, './views'));
    app.set('view engine', 'dot');

    // Gets a list of all files under folder including children of subfolders
    function walkSync(dir, prepend = "", fileList = []) {
        for (const file of fs.readdirSync(dir)) {
            if (fs.statSync(path.join(dir, file)).isDirectory()) {
                fileList = walkSync(path.join(dir, file), path.join(prepend, file), fileList);
            } else {
                fileList = fileList.concat(path.join(prepend, file));
            }
        }

        return fileList;
    }

    // Set up dot.js to translate link to page address
    if (fs.existsSync(path.join(__dirname, "./views"))) {
        walkSync(path.join(__dirname, "./views")).forEach((filePathOrig) => {
            // Files is an array of filename
            let filePath = filePathOrig.replace(/\.dot$/, ""); // Remove .dot at end of file names

            filePath = filePath.replace("\\", "/"); // Replace \ with /
            filePath = filePath.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"); // Escape regex operators in filePath
            filePath = filePath.replace(/(index)?$/, "($1(\.html)?)?"); // Make index and .html optional in the filePath
            let filePathRegex = new RegExp(`^\/${filePath}$`); // Set up regex matching for app get route

            // Set up route for each page
            app.get(filePathRegex, function (req, res, next) {
                res.render(filePathOrig);
            });
        });
    }
    // Serve static content:
    app.use(express.static(path.join(__dirname, "./public"), {
        extensions: ["html", "htm"]
    }));

    function parseContext (state, line) {
        let terms = line.split(" ");
        if (terms.length > 1) {
            error.push(`Too many arguments in CONTEXT`);
            return;
        }
        state.context = line;
    }

    const parseFind = async(function (state, line, error) {
        let query = {};
        // Split by OR
        let terms = line.match(/(("(?:\\"|[^"])*")+|[^|])+/g);
        let orList = [];
        // For every OR
        for (let i = 0; i < terms.length; ++i) {
            // Split by AND
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
            state.result = await (collection.find(query).toArray());
        } catch (err) {
            error.push(err.message);
            return;
        }

        console.log(JSON.stringify(query));
        return;
    });

    const lookUpInDB = async(function(result, lookupArgs, pullFromCollection, error) {
    let lookupFieldList = [];
        try {
            lookupFieldList = result[lookupArgs[0]];
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
        if (lookupArgs.length === 4) {
            result[lookupArgs[3].trim()] = newList;
            delete result[lookupArgs[0]];
        } else {
            result[lookupArgs[0]] = newList;
        }
    });

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
        let promiseList = [];
        for (let i = 0; i < state.result.length; ++i) {
            promiseList.push(lookUpInDB(state.result[i], lookupArgs, pullFromCollection, error));
        }
        await(promiseList);
        return;
    });

    function parseFilter (state, line) {

    }

    const parseLine = async(function (line, error) {
        let state = {"context": "", "result": []};
        lines = line.split("\n");
        for (var i = 0; i < lines.length; ++i) {
            let line = lines[i].split(":",2);
            let fn = line[0];
            if (line.length <= 1) {
                error.push(`No argument given on ${line}`);
                return "";
            }
            let arg = line[1];
            arg = arg.trim();
            switch(line[0].trim().toLowerCase()) {
                case "context":
                    parseContext(state, arg);
                    break;
                case "find":
                    await (parseFind(state, arg, error));
                    if (error.length > 0) return "";
                    break;
                case "lookup":
                    await (parseLookup(state, arg, error));
                    if (error.length > 0) return "";
                    break;
                case "filter":
                    parseFilter(state, arg, error);
                    break;
                default:
                    error.push(`No function given on ${line}`);
                    return "";
            }
        }
        return state.result;
    });

    app.post("/api/query", bodyParser.json(), async (function (req, res) {
        let error = [];
        let result = await (parseLine(req.body.query, error));
        if (error.length > 0) {
            res.send({Error: error});
        } else {
            res.send(result);
        }
    }));

    app.listen(PORT, function () {
        console.log(`Example app listening on port ${PORT}`);
    })
}

MongoClient.connect(url, function (err, db) {
    if (err) {
        console.log('Unable to connect to the mongoDB server. Error:', err);
    } else {
        startWebserver(db);
    }
});