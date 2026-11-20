/**
 * Protocol of the Feed the Horde room: one persistent, always-open world everyone feeds together. No accounts:
 * anyone can join with a display name, watch, and start riding with their FTP.
 *
 * The server counts the sweat from the samples (clients never report sweat), checks every message and keeps the
 * running total on disk.
 */
import { schema, t, type SchemaType } from "@colyseus/schema";
import { FTP_MAX, FTP_MIN } from "../horde/sweat.ts";
import { isWorkoutId, type WorkoutId } from "../horde/workouts.ts";
import type { SessionSummary } from "../horde/session.ts";
import { checkSample, PROTOCOL_VERSION, type RiderSample } from "./messages.ts";

/** Room name the server registers; clients `joinOrCreate` it. */
export const HORDE_ROOM = "horde";

/** Most clients (riders + spectators) in one horde room. */
export const HORDE_MAX_CLIENTS = 64;

export interface HordeJoinOptions {
  protocol: number;
  name: string;
}

export interface StartOptions {
  workout: WorkoutId;
  short: boolean;
  ftp: number;
}

/** Client -> server messages, by type. */
export interface HordeClientMessages {
  /** Start riding (fixes the FTP for the session). */
  start: StartOptions;
  /** Device data, a few times per second while riding. */
  sample: RiderSample;
  /** Stop riding (back to spectating). */
  stop: Record<string, never>;
}

/** Server -> client messages, by type. */
export interface HordeServerMessages {
  /** Broadcast: something worth an effect on every screen. */
  effect: HordeEffect;
  /** To the rider only, when their session ends. */
  summary: SessionSummary;
}

export type HordeEffect =
  | { kind: "block"; rider: string; label: string; hit: boolean; multiplier: number; streak: number }
  | { kind: "frenzy"; on: boolean; riders: number }
  | { kind: "level"; level: number; name: string }
  | { kind: "joined"; rider: string; name: string; workout: string; bot: boolean }
  | { kind: "done"; rider: string; name: string; sweat: number };

const MAX_NAME = 24;

/** Display name: printable characters only, trimmed, at most 24 characters. */
export function cleanName(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const name = v.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, "").trim().slice(0, MAX_NAME);
  return name || undefined;
}

export function checkHordeJoin(o: unknown): { ok: true; value: HordeJoinOptions } | { ok: false; error: string } {
  if (typeof o !== "object" || o === null) return { ok: false, error: "missing join options" };
  const { protocol, name } = o as Record<string, unknown>;
  if (protocol !== PROTOCOL_VERSION) return { ok: false, error: `protocol ${String(protocol)} != ${PROTOCOL_VERSION}` };
  return { ok: true, value: { protocol, name: cleanName(name) ?? "Guest" } };
}

export function checkStart(o: unknown): StartOptions | undefined {
  if (typeof o !== "object" || o === null) return undefined;
  const { workout, short, ftp } = o as Record<string, unknown>;
  if (!isWorkoutId(workout)) return undefined;
  if (typeof ftp !== "number" || !Number.isFinite(ftp) || ftp < FTP_MIN || ftp > FTP_MAX) return undefined;
  return { workout, short: short === true, ftp: Math.round(ftp) };
}

export { checkSample };

export const HordeRider = schema(
  {
    name: t.string(),
    bot: t.boolean(),
    /** Riding (on the ring) or only watching. */
    active: t.boolean(),
    /** Not pedalling for a few seconds: the workout clock waits. */
    paused: t.boolean(),
    workout: t.string(),
    workoutTitle: t.string(),
    short: t.boolean(),
    blockIndex: t.uint16(),
    blockCount: t.uint16(),
    blockLabel: t.string(),
    blockKind: t.string(),
    /** Seconds left in the block and its length. */
    blockLeft: t.float32(),
    blockSeconds: t.float32(),
    /** Target band (fraction of FTP); 0/0 in free play. */
    low: t.float32(),
    high: t.float32(),
    nextLabel: t.string(),
    /** Workout clock and length (s); total 0 in free play. */
    elapsed: t.float32(),
    total: t.float32(),
    /** Smoothed power / FTP. */
    intensity: t.float32(),
    power: t.uint16(),
    cadence: t.uint8(),
    onTarget: t.boolean(),
    multiplier: t.float32(),
    streak: t.uint16(),
    /** Sweat this session and per second right now. */
    sweat: t.float64(),
    rate: t.float32(),
    /** Capped by the plausibility check (FTP set too low?). */
    governed: t.boolean(),
    /** Stable colour slot for the ring. */
    color: t.uint8(),
  },
  "HordeRider",
);
export type HordeRider = SchemaType<typeof HordeRider>;

export const HordeState = schema(
  {
    /** All the sweat ever fed (persistent). */
    total: t.float64(),
    level: t.uint16(),
    levelName: t.string(),
    levelFloor: t.float64(),
    levelNext: t.float64(),
    /** Sweat per second of everyone right now. */
    rate: t.float32(),
    /** Seconds of group frenzy left (0: none). */
    frenzy: t.float32(),
    /** Riders by Colyseus session id (bots: "bot-…"). */
    riders: t.map(HordeRider),
  },
  "HordeState",
);
export type HordeState = SchemaType<typeof HordeState>;
