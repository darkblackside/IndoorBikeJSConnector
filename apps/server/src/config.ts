/** Server settings from the environment. */
export interface ServerConfig {
  /** Port the HTTP/WebSocket server will listen on. */
  port: number;
  /** Browser origins allowed to open a WebSocket (the web app's dev server and the GitHub Pages site). */
  allowedOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 8787);
  return {
    port: Number.isInteger(port) && port > 0 ? port : 8787,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:5173,https://darkblackside.github.io")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
