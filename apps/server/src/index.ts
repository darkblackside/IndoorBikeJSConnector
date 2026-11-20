import { createServer, openHordeWorld } from "./app.ts";
import { loadConfig } from "./config.ts";
import { FileHordeStore, MemoryHordeStore } from "./horde/store.ts";

const config = loadConfig();
const hordeStore = config.hordeDataFile ? await FileHordeStore.open(config.hordeDataFile) : new MemoryHordeStore();
await createServer(config, { hordeStore }).listen(config.port);
await openHordeWorld();
console.log(
  `indoor-bike server on ws://localhost:${config.port} (origins: ${config.allowedOrigins.join(", ")}; ` +
    `horde: ${Math.round(hordeStore.total)} sweat in ${config.hordeDataFile || "memory"}, bots ${config.hordeBots ? "on" : "off"})`,
);
// Colyseus disposes the rooms on SIGINT/SIGTERM (which flushes the store); this covers the rest.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void hordeStore.close());
