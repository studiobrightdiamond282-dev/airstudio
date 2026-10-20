// Entry-point shim for platforms (e.g. Render) that run `node index.js`.
// AirStudio's actual server lives in server.js, which starts listening
// on process.env.PORT (or 3000) when required.
require('./server.js');
