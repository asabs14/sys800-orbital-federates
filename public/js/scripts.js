"use strict";

function httpGetAsync(theUrl, callback) {
        
        let xmlHttp = new XMLHttpRequest();
        xmlHttp.onreadystatechange = function() { 
            if (xmlHttp.readyState == 4 && xmlHttp.status == 200)
                callback(xmlHttp.responseText);
        }
        xmlHttp.open("GET", theUrl, true); // true for asynchronous 
        xmlHttp.send(null);
}

function submitQuery() {

    const federateQuery = document.getElementById('federate-query').value;

    /*
    httpGetAsync(federateQuery, function(response){
        // Pretty-print JSON; response is a list of JSON objects
        for(let result in response) {

            // TODO: put the below pretty-print into results
            JSON.stringify(result, null, 2);

        }
    });
    */

    document.getElementById("query-result").innerHTML = JSON.stringify({"stuff": "stuff", "Did it work?": "Yes it did, good job"}, null, 2);
}