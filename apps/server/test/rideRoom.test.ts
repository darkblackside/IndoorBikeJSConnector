import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { PROTOCOL_VERSION, RIDE_ROOM, RideState } from "@indoor-bike/game-core/net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import type { RideRoom } from "../src/rooms/RideRoom.ts";

describe("RideRoom", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    colyseus = await boot(createServer(loadConfig({})));
  });
  afterAll(() => colyseus.shutdown());
  beforeEach(() => colyseus.cleanup());

  const join = (options: object) => colyseus.sdk.joinOrCreate(RIDE_ROOM, options, RideState);

  it("adds a rider and syncs their samples to the clients", async () => {
    const ann = await join({ protocol: PROTOCOL_VERSION, name: "Ann", weightKg: 62 });
    const bob = await join({ protocol: PROTOCOL_VERSION, name: "Bob" });
    expect(bob.roomId).toBe(ann.roomId);

    ann.send("sample", { power: 230, cadence: 92 });
    ann.send("ready", { ready: true });
    const room = colyseus.getRoomById<RideRoom>(ann.roomId);

    // Bob sees Ann's sample once the server's next state patch reaches him.
    await vi.waitFor(() => {
      const seenByBob = bob.state.riders.get(ann.sessionId);
      expect(seenByBob?.toJSON()).toMatchObject({ name: "Ann", weightKg: 62, power: 230, cadence: 92, ready: true });
    });
    expect(bob.state.riders.size).toBe(2);

    await bob.leave();
    await vi.waitFor(() => expect(room.state.riders.size).toBe(1));
    await vi.waitFor(() => expect(ann.state.riders.size).toBe(1));
  });

  it("turns away clients with another protocol version", async () => {
    await expect(join({ protocol: PROTOCOL_VERSION + 1, name: "Old" })).rejects.toThrow();
  });
});
