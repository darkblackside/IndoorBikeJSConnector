// Placeholder entry point of the multiplayer server. It only proves the workspace wiring (config +
// shared protocol from @indoor-bike/game-core); the WebSocket server comes later (see ../README.md).
import { PROTOCOL_VERSION } from "@indoor-bike/game-core/net";
import { loadConfig } from "./config.ts";

const config = loadConfig();
console.log(
  `indoor-bike server: not implemented yet (protocol v${PROTOCOL_VERSION}, would listen on :${config.port}, ` +
    `origins ${config.allowedOrigins.join(", ")})`,
);
