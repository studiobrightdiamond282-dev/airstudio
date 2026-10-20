// Entry-point shim for platforms (e.g. Render) that run `node index.js`.
// server.js exports a request handler; this shim creates the HTTP server
// and starts listening on process.env.PORT (or 3000).
const http = require('http');
const handleRequest = require('./server.js');
const server = http.createServer(handleRequest);
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`AirStudio server running on http://0.0.0.0:${PORT}`);
});
