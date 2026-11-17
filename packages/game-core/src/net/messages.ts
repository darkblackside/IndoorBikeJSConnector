/**
 * DRAFT of the multiplayer wire protocol (client <-> server over WebSocket). Nothing sends these yet: they are
 * here so the client and the server share one definition from the start. Change freely until the server exists,
 * then bump `PROTOCOL_VERSION` on every incompatible change.
 *
 * Messages are JSON objects with a `type` discriminator. Times are in milliseconds; distances in metres.
 */
export const PROTOCOL_VERSION = 1;

export type PlayerId = string;
export type RoomId = string;

/** What a rider's devices report, sent by the client a few times per second. */
export interface RiderSample {
  /** Client clock (ms) when the sample was taken. */
  t: number;
  power?: number;
  cadence?: number;
  heartRate?: number;
}

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  /** Needed for W/kg and speed-from-power. */
  weightKg?: number;
}

/** Per-player state in a snapshot. */
export interface PlayerState {
  id: PlayerId;
  /** Distance along the shared route. */
  s: number;
  /** Power the server uses for this player (smoothed). */
  power: number;
  /** Distance to the horde behind this player. */
  gap: number;
  out: boolean;
}

// --- client -> server -------------------------------------------------------------------
export type ClientMessage =
  | { type: "hello"; protocol: number; name: string; weightKg?: number }
  | { type: "join"; room: RoomId }
  | { type: "leave" }
  | { type: "ready"; ready: boolean }
  | { type: "sample"; sample: RiderSample }
  | { type: "ping"; t: number };

// --- server -> client -------------------------------------------------------------------
export type ServerMessage =
  | { type: "welcome"; protocol: number; you: PlayerId }
  | { type: "error"; code: "protocol-mismatch" | "room-full" | "bad-message" | "not-in-room"; message: string }
  | { type: "room"; room: RoomId; players: PlayerInfo[]; ready: PlayerId[] }
  /** Everyone gets the same `seed`, so every client builds the same city (`CityWorld` with `mulberry32(seed)`). */
  | { type: "start"; seed: number; startsAt: number }
  | { type: "snapshot"; tick: number; t: number; players: PlayerState[] }
  | { type: "finish"; ranking: PlayerId[] }
  | { type: "pong"; t: number; serverTime: number };

export type Message = ClientMessage | ServerMessage;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Parses an incoming frame into a message with a string `type`. Only the envelope is checked here; validating
 * each message's fields is the receiver's job (the server must not trust clients).
 */
export function parseMessage<T extends Message>(data: string): T | undefined {
  try {
    const v: unknown = JSON.parse(data);
    return isObject(v) && typeof v.type === "string" ? (v as unknown as T) : undefined;
  } catch {
    return undefined;
  }
}

export const encodeMessage = (m: Message): string => JSON.stringify(m);
