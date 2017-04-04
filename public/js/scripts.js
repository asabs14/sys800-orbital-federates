"use strict";

function httpGetAsync(theUrl, callback) {
        
    let xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/query", true);
    xhr.setRequestHeader('Content-Type', 'application/JSON');
    xhr.onreadystatechange = function () {
        if (this.readyState != 4) return;
        if (this.status == 200) {
            callback(this.responseText);
        }
    };
    xhr.send(JSON.stringify({'query': theUrl}));
}

function submitQuery() {

    const federateQuery = document.getElementById('federate-query').value;
    console.log(federateQuery);

    httpGetAsync(federateQuery, function(response){
        document.getElementById("query-result").innerHTML = JSON.stringify(JSON.parse(response),null,4);
    });
}