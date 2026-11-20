import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { BOT_PERSONAS, mulberry32 } from "@indoor-bike/game-core";
import { HORDE_ROOM, HordeState, PROTOCOL_VERSION, type HordeEffect } from "@indoor-bike/game-core/net";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { BotDirector, type Bot } from "../src/horde/bots.ts";
import { FileHordeStore, MemoryHordeStore } from "../src/horde/store.ts";

describe("HordeRoom", () => {
  let colyseus: ColyseusTestServer;
  const store = new MemoryHordeStore(1234);
  beforeAll(async () => {
    colyseus = await boot(createServer(loadConfig({ HORDE_BOTS: "0" }), { hordeStore: store }));
  });
  afterAll(() => colyseus.shutdown());
  beforeEach(() => colyseus.cleanup());

  const join = (name: unknown = "Ann") => colyseus.sdk.joinOrCreate(HORDE_ROOM, { protocol: PROTOCOL_VERSION, name }, HordeState);

  it("lets anyone watch, then ride and feed the shared total", async () => {
    const ann = await join("Ann");
    const bob = await join(null);
    expect(bob.roomId).toBe(ann.roomId);
    await vi.waitFor(() => expect(ann.state.total).toBe(1234));
    await vi.waitFor(() => expect(ann.state.riders.get(bob.sessionId)?.name).toBe("Guest"));
    expect(ann.state.riders.get(ann.sessionId)?.active).toBe(false);

    const effects: HordeEffect[] = [];
    bob.onMessage("effect", (e: HordeEffect) => effects.push(e));
    ann.send("start", { workout: "threshold", short: true, ftp: 200 });
    const feed = setInterval(() => ann.send("sample", { power: 200, cadence: 90 }), 100);
    try {
      await vi.waitFor(
        () => {
          const seen = bob.state.riders.get(ann.sessionId);
          expect(seen?.toJSON()).toMatchObject({ active: true, workout: "threshold", blockLabel: "Warm-up", power: 200 });
          expect(seen!.sweat).toBeGreaterThan(0);
          expect(bob.state.total).toBeGreaterThan(1234);
        },
        { timeout: 3000 },
      );
    } finally {
      clearInterval(feed);
    }
    expect(effects).toContainEqual(expect.objectContaining({ kind: "joined", rider: ann.sessionId, bot: false }));

    // Stopping sends the rider a summary and takes them off the ring.
    const summary = new Promise((resolve) => ann.onMessage("summary", resolve));
    ann.send("stop", {});
    expect(await summary).toMatchObject({ workout: "threshold", short: true });
    await vi.waitFor(() => expect(bob.state.riders.get(ann.sessionId)?.active).toBe(false));
    expect(store.total).toBeGreaterThan(1234);
  });

  it("ignores invalid starts and samples", async () => {
    const ann = await join();
    ann.send("start", { workout: "free", ftp: 5000 });
    ann.send("sample", { power: 99999 });
    ann.send("start", { workout: "teleport", ftp: 200 });
    await new Promise((r) => setTimeout(r, 400));
    expect(ann.state.riders.get(ann.sessionId)?.name).toBe("Ann");
    expect(ann.state.riders.get(ann.sessionId)?.active).toBe(false);
  });

  it("turns away clients with another protocol version", async () => {
    await expect(colyseus.sdk.joinOrCreate(HORDE_ROOM, { protocol: 0, name: "x" }, HordeState)).rejects.toThrow();
  });
});

describe("BotDirector", () => {
  it("sends company when a person arrives and lets bots come and go", () => {
    const arrived: Bot[] = [];
    const left: Bot[] = [];
    const director = new BotDirector(BOT_PERSONAS, mulberry32(3), { arrive: (b) => arrived.push(b), leave: (b) => left.push(b) });
    director.personArrived();
    for (let t = 0; t < 30 && !arrived.length; t += 1) director.tick(1);
    expect(arrived.length).toBe(1);

    // Ride a few hours of simulated time: bots finish workouts and come back.
    for (let t = 0; t < 4 * 3600; t += 1) {
      director.tick(1);
      for (const bot of director.riding) {
        const s = bot.ride!.session;
        s.tick(1, director.input(bot, 1));
        if (s.done) director.finish(bot);
      }
    }
    expect(left.length).toBeGreaterThan(3);
    expect(new Set(arrived.map((b) => b.id)).size).toBe(BOT_PERSONAS.length);
  });
});

describe("FileHordeStore", () => {
  it("keeps the total across restarts", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "horde-")), "sub", "horde.json");
    const a = await FileHordeStore.open(path);
    expect(a.total).toBe(0);
    a.add(41.5);
    a.add(-10);
    a.add(Number.NaN);
    await a.close();
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 1, total: 41.5 });
    const b = await FileHordeStore.open(path);
    expect(b.total).toBe(41.5);
    await b.close();
  });
});
