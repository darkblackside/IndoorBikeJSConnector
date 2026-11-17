/**
 * Room state, synchronised by Colyseus from the server to every client (binary delta patches). The server
 * owns it; clients only read it (`room.state`) and render.
 *
 * Defined with `schema()`/`t` instead of decorators, so it needs no special compiler settings and loads the
 * same in the browser and in Node.
 */
import { schema, t, type SchemaType } from "@colyseus/schema";

export const RiderState = schema(
  {
    name: t.string(),
    weightKg: t.float32(),
    ready: t.boolean(),
    /** Latest values from the rider's devices (0 until reported). */
    power: t.uint16(),
    cadence: t.uint8(),
    heartRate: t.uint8(),
    /** Distance along the shared route (metres). Set by the server's game loop (not implemented yet). */
    s: t.float64(),
    /** Distance to the horde behind this rider (metres). */
    gap: t.float32(),
    out: t.boolean(),
  },
  "RiderState",
);
export type RiderState = SchemaType<typeof RiderState>;

/** `lobby` until everyone is ready, then `riding`, then `finished`. */
export type RidePhase = "lobby" | "riding" | "finished";

export const RideState = schema(
  {
    phase: t.string().default("lobby"),
    /** Every client builds the same city from it: `new CityWorld(mulberry32(seed))`. */
    seed: t.uint32(),
    /** Riders by Colyseus session id. */
    riders: t.map(RiderState),
  },
  "RideState",
);
export type RideState = SchemaType<typeof RideState>;
