/** Server settings from the environment. */
export interface ServerConfig {
  /** Port the HTTP/WebSocket server will listen on. */
  port: number;
  /** Browser origins allowed to open a WebSocket besides the server's own pages (default: the web app's dev server). */
  allowedOrigins: string[];
  /** Where the horde's total sweat is kept (JSON). Empty: in memory only (tests). */
  hordeDataFile: string;
  /** Run the simulated riders in the horde room. */
  hordeBots: boolean;
  /** Built web app to serve over HTTP (apps/web/dist). Empty: serve no frontend (dev: Vite serves it). */
  webDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 8787);
  return {
    port: Number.isInteger(port) && port > 0 ? port : 8787,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:5173")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    hordeDataFile: env.HORDE_DATA_FILE ?? "data/horde.json",
    hordeBots: !["0", "false", "off", "no"].includes((env.HORDE_BOTS ?? "1").toLowerCase()),
    webDir: env.WEB_DIR ?? "",
  };
}
