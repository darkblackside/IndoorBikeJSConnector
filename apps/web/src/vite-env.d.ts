/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the multiplayer server (apps/server), e.g. wss://ride.example.com. */
  readonly VITE_SERVER_URL?: string;
}
