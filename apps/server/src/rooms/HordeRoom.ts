import { Room, type Client } from "@colyseus/core";
import {
  BOT_PERSONAS,
  FRENZY,
  hordeLevel,
  RiderSession,
  type RiderInput,
  type SessionEvent,
} from "@indoor-bike/game-core/horde";
import {
  checkHordeJoin,
  checkSample,
  checkStart,
  HORDE_MAX_CLIENTS,
  HordeRider,
  HordeState,
  type HordeClientMessages,
  type HordeEffect,
  type HordeJoinOptions,
  type HordeServerMessages,
} from "@indoor-bike/game-core/net";
import { BotDirector, type Bot } from "../horde/bots.ts";
import type { HordeStore } from "../horde/store.ts";

/** What the room needs from outside (injected, so tests get a memory store and no bots). */
export interface HordeDeps {
  store: HordeStore;
  bots: boolean;
  rand: () => number;
  /** The persistent room (created at boot, never disposed, runs the bots). Set by the first room created. */
  main?: HordeRoom;
}

/** Simulation tick (ms). */
const TICK_MS = 250;
/** A sample older than this (ms) counts as "not pedalling" (dropped connection, closed tab, …). */
const SAMPLE_STALE_MS = 3000;
/** Number of ring colours the client knows. */
const COLORS = 12;

interface Person {
  session?: RiderSession;
  input?: RiderInput & { at: number };
}

/**
 * Feed the Horde: one shared world. Everyone connected watches; riders `start` a workout (or free play) with their
 * FTP and send samples. Every tick the server turns each rider's power into sweat (game-core `RiderSession`),
 * judges their blocks, runs the group frenzy and adds everything to the persistent total.
 *
 * No accounts: anyone may join (the WebSocket origin check in app.ts is the only gate). Light cheat protection
 * only, it's co-op: sweat is computed here from plausible samples, the FTP is fixed per session and range-checked,
 * absurd sustained intensities are capped (`GOVERNOR_LIMIT`), and message floods get the client disconnected.
 */
export class HordeRoom extends Room<{ state: HordeState }> {
  override maxClients = HORDE_MAX_CLIENTS;
  override maxMessagesPerSecond = 40;
  override state = new HordeState();

  declare deps: HordeDeps;
  private readonly people = new Map<string, Person>();
  private director?: BotDirector;
  private frenzyHold = 0;

  override messages = {
    start: (client: Client, message: HordeClientMessages["start"]) => {
      const person = this.people.get(client.sessionId);
      const rider = this.state.riders.get(client.sessionId);
      const options = checkStart(message);
      if (!person || !rider || !options || person.session) return;
      person.session = new RiderSession(options.ftp, options.workout, options.short);
      person.input = undefined;
      rider.active = true;
      rider.color = this.freeColor();
      this.writeRider(rider, person.session);
      this.effect({ kind: "joined", rider: client.sessionId, name: rider.name, workout: person.session.workout.title, bot: false });
    },
    sample: (client: Client, message: HordeClientMessages["sample"]) => {
      const person = this.people.get(client.sessionId);
      const sample = checkSample(message);
      if (!person?.session || !sample) return;
      person.input = {
        power: sample.power ?? 0,
        cadence: sample.cadence ?? 0,
        at: this.clock.currentTime,
      };
    },
    stop: (client: Client) => this.endSession(client),
  };

  override onCreate(): void {
    if (!this.deps.main) {
      // The first room is the persistent world: it stays open with nobody in it, so the bots keep riding.
      this.deps.main = this;
      this.autoDispose = false;
      if (this.deps.bots) {
        this.director = new BotDirector(BOT_PERSONAS, this.deps.rand, {
          arrive: (bot) => this.botArrived(bot),
          leave: (bot) => this.botLeft(bot),
        });
      }
    }
    this.syncTotals(false);
    this.setSimulationInterval((ms) => this.tick(ms / 1000), TICK_MS);
  }

  override onAuth(_client: Client, options: unknown): HordeJoinOptions {
    const checked = checkHordeJoin(options);
    if (!checked.ok) throw new Error(checked.error);
    return checked.value;
  }

  override onJoin(client: Client): void {
    const rider = new HordeRider();
    rider.name = (client.auth as HordeJoinOptions).name;
    rider.bot = false;
    rider.active = false;
    rider.multiplier = 1;
    this.state.riders.set(client.sessionId, rider);
    this.people.set(client.sessionId, {});
    this.director?.personArrived();
  }

  override onDrop(client: Client): void {
    // A phone losing Wi-Fi for a moment shouldn't end the ride: the session waits (paused) for 30 s.
    this.allowReconnection(client, 30);
  }

  override onLeave(client: Client): void {
    this.endSession(client, false);
    this.people.delete(client.sessionId);
    this.state.riders.delete(client.sessionId);
  }

  override async onDispose(): Promise<void> {
    if (this.deps.main === this) this.deps.main = undefined;
    await this.deps.store.flush();
  }

  // --- simulation ---------------------------------------------------------------------------

  private tick(dt: number) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 1); // a stalled event loop must not hand out a burst of sweat
    this.director?.tick(dt);
    const bonus = this.updateFrenzy(dt);
    const now = this.clock.currentTime;
    let fed = 0;
    let rate = 0;

    for (const [id, person] of this.people) {
      const session = person.session;
      const rider = this.state.riders.get(id);
      if (!session || !rider) continue;
      const fresh = person.input && now - person.input.at <= SAMPLE_STALE_MS ? person.input : undefined;
      const before = session.sweat;
      const events = session.tick(dt, fresh, bonus);
      fed += session.sweat - before;
      rate += session.rate;
      rider.cadence = Math.round(fresh?.cadence ?? 0);
      this.writeRider(rider, session);
      this.handle(id, rider, events);
    }

    for (const bot of this.director?.riding ?? []) {
      const session = bot.ride!.session;
      const rider = this.state.riders.get(bot.id);
      if (!rider) continue;
      const input = this.director!.input(bot, dt);
      const before = session.sweat;
      const events = session.tick(dt, input, bonus);
      fed += session.sweat - before;
      rate += session.rate;
      rider.cadence = input.cadence;
      this.writeRider(rider, session);
      this.handle(bot.id, rider, events);
      if (session.done) this.director!.finish(bot);
    }

    this.deps.store.add(fed);
    this.state.rate = rate;
    this.syncTotals(true);
  }

  /** Counts riders on target; returns the sweat bonus for this tick. */
  private updateFrenzy(dt: number): number {
    const sessions = [...[...this.people.values()].map((p) => p.session), ...(this.director?.riding ?? []).map((b) => b.ride!.session)];
    const onTarget = sessions.filter((s) => s?.onTarget).length;
    const wasOn = this.state.frenzy > 0;
    if (onTarget >= FRENZY.minRiders) {
      this.frenzyHold += dt;
      if (this.frenzyHold >= FRENZY.holdSeconds) this.state.frenzy = FRENZY.seconds;
    } else {
      this.frenzyHold = 0;
      this.state.frenzy = Math.max(0, this.state.frenzy - dt);
    }
    const on = this.state.frenzy > 0;
    if (on !== wasOn) this.effect({ kind: "frenzy", on, riders: onTarget });
    return on ? FRENZY.multiplier : 1;
  }

  private handle(id: string, rider: HordeRider, events: SessionEvent[]) {
    for (const e of events) {
      if (e.type === "block") {
        this.effect({ kind: "block", rider: id, label: e.label, hit: e.hit, multiplier: e.multiplier, streak: e.streak });
      } else if (e.type === "done") {
        const client = this.clients.getById(id);
        if (client) this.endSession(client);
        else this.effect({ kind: "done", rider: id, name: rider.name, sweat: Math.round(rider.sweat) });
      }
    }
  }

  private syncTotals(announce: boolean) {
    const total = this.deps.store.total;
    const level = hordeLevel(total);
    if (announce && level.level > this.state.level) this.effect({ kind: "level", level: level.level, name: level.name });
    this.state.total = total;
    this.state.level = level.level;
    this.state.levelName = level.name;
    this.state.levelFloor = level.floor;
    this.state.levelNext = level.next;
  }

  // --- riders -------------------------------------------------------------------------------

  private endSession(client: Client, notify = true) {
    const person = this.people.get(client.sessionId);
    const rider = this.state.riders.get(client.sessionId);
    const session = person?.session;
    if (!person || !session) return;
    person.session = undefined;
    person.input = undefined;
    const summary = session.summary();
    if (notify) this.sendTo(client, "summary", summary);
    this.effect({ kind: "done", rider: client.sessionId, name: rider?.name ?? "", sweat: summary.sweat });
    if (rider) {
      rider.active = false;
      rider.rate = 0;
      rider.onTarget = false;
    }
  }

  private botArrived(bot: Bot) {
    const rider = new HordeRider();
    rider.name = bot.persona.name;
    rider.bot = true;
    rider.active = true;
    rider.color = this.freeColor();
    this.writeRider(rider, bot.ride!.session);
    this.state.riders.set(bot.id, rider);
    this.effect({ kind: "joined", rider: bot.id, name: rider.name, workout: bot.ride!.session.workout.title, bot: true });
  }

  private botLeft(bot: Bot) {
    const rider = this.state.riders.get(bot.id);
    if (rider) this.effect({ kind: "done", rider: bot.id, name: rider.name, sweat: Math.round(rider.sweat) });
    this.state.riders.delete(bot.id);
  }

  private freeColor(): number {
    const used = new Set([...this.state.riders.values()].filter((r) => r.active).map((r) => r.color));
    for (let c = 0; c < COLORS; c++) if (!used.has(c)) return c;
    return Math.floor(this.deps.rand() * COLORS);
  }

  private writeRider(r: HordeRider, s: RiderSession) {
    const b = s.block;
    r.active = !s.done;
    r.paused = s.paused;
    r.workout = s.workout.id;
    r.workoutTitle = s.workout.title;
    r.short = s.short;
    r.blockIndex = s.blockIndex;
    r.blockCount = s.workout.blocks.length;
    r.blockLabel = b.label;
    r.blockKind = b.kind;
    r.blockLeft = s.blockLeft;
    r.blockSeconds = b.seconds;
    r.low = b.low;
    r.high = b.high;
    r.nextLabel = s.nextBlock?.label ?? "";
    r.elapsed = s.t;
    r.total = s.totalSeconds;
    r.intensity = s.intensity;
    r.power = Math.round(s.power);
    r.onTarget = s.onTarget;
    r.multiplier = s.multiplier;
    r.streak = s.streak;
    r.sweat = s.sweat;
    r.rate = s.rate;
    r.governed = s.governed;
  }

  private effect(e: HordeEffect) {
    this.broadcast("effect", e);
  }

  private sendTo<K extends keyof HordeServerMessages>(client: Client, type: K, message: HordeServerMessages[K]) {
    client.send(type, message);
  }
}
