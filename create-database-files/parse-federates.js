var mongodb = require("mongodb");
var federates = require("./federates.json");
var async = require('asyncawait/async');
var await = require('asyncawait/await');

var url = 'mongodb://155.246.39.17:27017/orbitalFederates';

var MongoClient = mongodb.MongoClient;

MongoClient.connect(url, async(function (err, db) {
    if (err) {
        console.log('Unable to connect to the mongoDB server. Error:', err);
    } else {
        console.log('Connection established to', url);

        var collection = db.collection('federates');

        var currentFederateId = 0;

        for(var federate of federates){
            if(!await(collection.findOne(federate))){
                federate.federateId = currentFederateId;
                await(collection.insertOne(federate));
                ++currentFederateId;
            }
        }


        db.close();
        console.log("Connection closed");
    }
}));