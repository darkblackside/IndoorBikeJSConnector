import { createServer } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
await createServer(config).listen(config.port);
console.log(`indoor-bike server on ws://localhost:${config.port} (origins: ${config.allowedOrigins.join(", ")})`);
