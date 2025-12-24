const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);

app.use(express.static(__dirname)); // Serve arquivos estáticos (imagens, css, js)

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CAT MARIO SERVER NA PORTA: ${PORT}`);
});
