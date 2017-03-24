var mongodb = require("mongodb");
var designs = require("./designs.json");
var async = require('asyncawait/async');
var await = require('asyncawait/await');

var url = 'mongodb://localhost:27017/orbitalFederates';

var MongoClient = mongodb.MongoClient;

MongoClient.connect(url, async(function (err, db) {
    if (err) {
        console.log('Unable to connect to the mongoDB server. Error:', err);
    } else {
        console.log('Connection established to', url);

        var collection = db.collection('designs');
        var currentDesignId = 0;

        for(var design of designs){
            if(!await(collection.findOne(design))){
                design.designId = currentDesignId;
                await(collection.insertOne(design));
                ++currentDesignId;
            }
        }

        db.close();
        console.log("Connection closed");
    }
}));