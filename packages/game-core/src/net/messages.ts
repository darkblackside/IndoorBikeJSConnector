/**
 * Multiplayer protocol shared by the web client and the Colyseus server (apps/server). Colyseus handles the
 * transport (WebSocket), rooms, joining/leaving and syncing the room state (see `state.ts`); what is left to
 * define here is the room name, the join options and the messages clients send.
 *
 * Bump `PROTOCOL_VERSION` on every incompatible change: the server turns away clients with another version.
 */
export const PROTOCOL_VERSION = 1;

/** Room name the server registers and clients join (`client.joinOrCreate(RIDE_ROOM, joinOptions)`). */
export const RIDE_ROOM = "ride";

/** Most riders in one room. */
export const MAX_RIDERS = 8;

/** Options a client passes when joining a ride room. */
export interface JoinOptions {
  protocol: number;
  name: string;
  /** Needed for W/kg and speed-from-power. */
  weightKg?: number;
}

/** What a rider's devices report; clients send it a few times per second. */
export interface RiderSample {
  power?: number;
  cadence?: number;
  heartRate?: number;
}

/** Client -> server messages (`room.send(type, payload)`), by type. */
export interface ClientMessages {
  sample: RiderSample;
  ready: { ready: boolean };
}

const MAX_NAME = 24;

/** Validated join options, or an error message. The server must not trust anything a client sends. */
export function checkJoinOptions(o: unknown): { ok: true; value: JoinOptions } | { ok: false; error: string } {
  if (typeof o !== "object" || o === null) return { ok: false, error: "missing join options" };
  const { protocol, name, weightKg } = o as Record<string, unknown>;
  if (protocol !== PROTOCOL_VERSION) return { ok: false, error: `protocol ${String(protocol)} != ${PROTOCOL_VERSION}` };
  if (typeof name !== "string" || !name.trim()) return { ok: false, error: "name required" };
  if (weightKg !== undefined && !(typeof weightKg === "number" && weightKg >= 20 && weightKg <= 250)) {
    return { ok: false, error: "weightKg out of range" };
  }
  return { ok: true, value: { protocol, name: name.trim().slice(0, MAX_NAME), weightKg } };
}

const inRange = (v: unknown, max: number): v is number | undefined =>
  v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max);

/** Validated sample (plausible ranges only), or undefined to drop it. */
export function checkSample(m: unknown): RiderSample | undefined {
  if (typeof m !== "object" || m === null) return undefined;
  const { power, cadence, heartRate } = m as Record<string, unknown>;
  if (!inRange(power, 3000) || !inRange(cadence, 250) || !inRange(heartRate, 250)) return undefined;
  return { power, cadence, heartRate };
}
