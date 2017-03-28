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

    app.post("/api/query", function (req, res) {
        let collection = db.collection("designs");
        collection.find({}).toArray(function (err, result) {
            if (err) {
                console.log(err);
            } else if (result.length) {
                console.log('Found:', result);
                console.log(result);
                res.json(result);
            } else {
                console.log('No document(s) found with defined "find" criteria!');
                res.json("No results found...");
            }
        });
        //res.json([{"this": "that"},{"this": "that again"}]);
    });

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