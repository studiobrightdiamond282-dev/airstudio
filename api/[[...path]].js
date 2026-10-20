// Vercel catch-all serverless function for /api/* routes.
// Exports the AirStudio request handler from server.js.
const handleRequest = require('../server.js');
module.exports = handleRequest;
