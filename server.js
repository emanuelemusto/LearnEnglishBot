const express = require('express');
const bodyParser = require('body-parser');
const port = process.env.port || 80;
const app = express();

const { Connection, Request } = require("tedious");

//configurazione per connessione a db (username, password, server ecc.)
const config = {
  authentication: {
    options: {
      userName: "travelbot", // update me
      password: "Sqlserver24@" // update me
    },
    type: "default"
  },
  server: "sql-server-cloud-computing.database.windows.net", // update me
  options: {
    database: "flightBook", //update me
    encrypt: true
  }
};

const connection = new Connection(config);

//array che mantiene dati restituiti dalla query al db
var valore = [];

app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);
app.use(express.static(__dirname + "/views"));
app.use(bodyParser.json());


connection.on("connect", err => {
  if (err) {
    console.error(err.message);
  } else {
    queryDatabase();
  }
});

connection.connect();

//funzione che interroga il database e mantiene dati restituiti nell'array 'valore'
function queryDatabase() {

  // Read all rows from table
  const request = new Request(
    `SELECT top 10 * FROM [dbo].[frasi]
    order by newId()`,
    (err, rowCount) => {
      if (err) {
        console.error(err.message);
      } else {
        console.log(`${rowCount} row(s) returned`);
      }
    }
  );

  request.on("row", columns => {
    columns.forEach(column => {

      valore.push(column.value)
      console.log("%s\t%s", column.metadata.colName, column.value);
    });
  });

  request.on("done", function() {
      // chiude solo dopo che ha finito
      connection.close();
  
  });

  connection.execSql(request);
  return valore;
}

app.get('/', function(req, res){
  res.sendFile(__dirname + '/views/index.html')
});

//invio dati dal backend al fronted, dove saranno poi manipolati e mostrati a schermo
app.get('/datidb', function(req, res){
  res.json(queryDatabase());
});


app.listen(port, function(){
  console.log('Ok server: 3000');
});
