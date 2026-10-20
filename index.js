// Entry-point shim for platforms (e.g. Render) that run `node index.js`.
// server.js creates the HTTP server AND attaches the WebSocket signaling
// server — this shim only starts listening on process.env.PORT (or 3000).
// (Creating a separate http.createServer() here would serve HTTP but drop
// every WebSocket upgrade → "Signaling server unreachable".)
const handleRequest = require('./server.js');
const server = handleRequest.server;
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`AirStudio server running on http://0.0.0.0:${PORT}`);
});
