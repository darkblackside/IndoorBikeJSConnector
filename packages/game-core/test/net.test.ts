import { Decoder, Encoder } from "@colyseus/schema";
import { describe, expect, it } from "vitest";
import { checkJoinOptions, checkSample, PROTOCOL_VERSION, RideState, RiderState } from "../src/net/index.ts";

describe("net: join options", () => {
  it("accepts a valid join and trims the name", () => {
    expect(checkJoinOptions({ protocol: PROTOCOL_VERSION, name: "  Ann ", weightKg: 70 })).toEqual({
      ok: true,
      value: { protocol: PROTOCOL_VERSION, name: "Ann", weightKg: 70 },
    });
  });

  it.each([undefined, null, {}, { protocol: 0, name: "x" }, { protocol: PROTOCOL_VERSION, name: " " }, { protocol: PROTOCOL_VERSION, name: "x", weightKg: 5 }])(
    "rejects %j",
    (o) => expect(checkJoinOptions(o).ok).toBe(false),
  );
});

describe("net: samples", () => {
  it("keeps plausible values and drops nonsense", () => {
    expect(checkSample({ power: 250, cadence: 90 })).toEqual({ power: 250, cadence: 90, heartRate: undefined });
    for (const bad of [null, "x", { power: -1 }, { power: 1e6 }, { cadence: Number.NaN }, { heartRate: "120" }]) {
      expect(checkSample(bad)).toBeUndefined();
    }
  });
});

describe("net: room state", () => {
  it("syncs from the server's encoder to a client decoder", () => {
    const server = new RideState();
    server.seed = 1234;
    const rider = new RiderState();
    rider.name = "Ann";
    rider.power = 210;
    server.riders.set("abc", rider);

    const encoder = new Encoder(server);
    const client = new RideState();
    const decoder = new Decoder(client);
    decoder.decode(encoder.encodeAll());

    expect(client.phase).toBe("lobby");
    expect(client.seed).toBe(1234);
    expect(client.riders.get("abc")?.name).toBe("Ann");
    expect(client.riders.get("abc")?.power).toBe(210);
  });
});
