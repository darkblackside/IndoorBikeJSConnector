import { afterEach, describe, expect, it, vi } from "vitest";
import { IndoorBike, Trainer, type ProtocolName } from "../src/index.ts";
import {
  createSimulatedHeartRateMonitor,
  createSimulatedTrainer,
  FakeBluetooth,
  type SimulatedTrainer,
} from "../testing/index.ts";

/** Let queued microtasks/notifications and the command loop settle. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

async function connect(protocol: ProtocolName) {
  const bluetooth = new FakeBluetooth();
  const sim = bluetooth.add(createSimulatedTrainer(protocol));
  let clock = 0;
  const trainer = new Trainer({ bluetooth: bluetooth.asBluetooth(), now: () => clock, reconnectDelays: [0, 0] });
  await trainer.connect();
  const ride = async (seconds = 1) => {
    clock += seconds * 1000;
    sim.tick(seconds);
    await settle();
  };
  return { trainer, sim, ride };
}

const controllable: ProtocolName[] = ["ftms", "wahoo", "tacx-fec"];

describe.each(controllable)("%s trainer", (protocol) => {
  let sim: SimulatedTrainer;
  afterEach(() => sim?.stop());

  it("is detected and reports live data", async () => {
    const t = await connect(protocol);
    sim = t.sim;
    expect(t.trainer.status).toBe("connected");
    expect(t.trainer.protocolName).toBe(protocol);
    expect(t.trainer.capabilities).toEqual({ erg: true, simulation: true });
    for (let i = 0; i < 3; i++) await t.ride();
    expect(t.trainer.data.cadence).toBeCloseTo(90, 0);
    expect(t.trainer.data.speed).toBeCloseTo(33.3, 0);
    expect(t.trainer.data.power).toBeGreaterThan(0);
  });

  it("holds an ERG target", async () => {
    const t = await connect(protocol);
    sim = t.sim;
    t.trainer.setTargetPower(250);
    await settle();
    expect(sim.state.mode).toEqual({ kind: "erg", watts: 250 });
    await t.ride();
    await t.ride();
    expect(t.trainer.data.power).toBe(250);
  });

  it("follows simulated grade and free ride", async () => {
    const t = await connect(protocol);
    sim = t.sim;
    t.trainer.setSimulation({ grade: 4.5 });
    await settle();
    expect(sim.state.mode).toEqual({ kind: "simulation", grade: 4.5 });
    await t.ride();
    await t.ride();
    const climbing = t.trainer.data.power!;
    t.trainer.freeRide();
    await settle();
    expect(sim.state.mode).toEqual({ kind: "simulation", grade: 0 });
    await t.ride();
    await t.ride();
    expect(t.trainer.data.power!).toBeLessThan(climbing);
  });

  it("coalesces rapid updates and skips unchanged values", async () => {
    const t = await connect(protocol);
    sim = t.sim;
    const before = sim.state.commands.length;
    for (let w = 100; w <= 300; w += 10) t.trainer.setTargetPower(w);
    await settle();
    t.trainer.setTargetPower(300);
    await settle();
    const ergCommands = sim.state.commands.slice(before).filter((c) => c.startsWith("erg:"));
    expect(ergCommands.length).toBeLessThanOrEqual(2);
    expect(ergCommands.at(-1)).toBe("erg:300");
  });

  it("re-applies the mode after an automatic reconnect", async () => {
    const t = await connect(protocol);
    sim = t.sim;
    t.trainer.setTargetPower(180);
    await settle();
    const statuses: string[] = [];
    t.trainer.on("status", (s) => statuses.push(s));
    sim.state.mode = { kind: "none" }; // trainer forgets on power cycle
    sim.device.gatt.failNextConnects = 1;
    sim.device.drop();
    await settle();
    expect(statuses).toEqual(["reconnecting", "connected"]);
    expect(sim.state.mode).toEqual({ kind: "erg", watts: 180 });
  });

  it("releases control: lifts the ERG target, then only reads data", async () => {
    const t = await connect(protocol);
    sim = t.sim;
    t.trainer.setTargetPower(300);
    await settle();
    expect(t.trainer.ergActive).toBe(true);
    t.trainer.releaseControl();
    await settle();
    expect(t.trainer.ergActive).toBe(false);
    expect(t.trainer.mode).toEqual({ kind: "none" });
    expect(sim.state.mode).toEqual({ kind: "simulation", grade: 0 });
    const sent = sim.state.commands.length;
    sim.state.riderPower = 175;
    await t.ride();
    await t.ride();
    expect(t.trainer.data.power).toBe(175);
    t.trainer.releaseControl();
    await settle();
    expect(sim.state.commands.length).toBe(sent); // nothing more is sent
  });
});

describe("protocol handshakes", () => {
  it("FTMS requests control before commanding", async () => {
    const { sim, trainer } = await connect("ftms");
    trainer.setTargetPower(200);
    await settle();
    expect(sim.state.commands.slice(0, 3)).toEqual(["ftms:request-control", "ftms:start", "erg:200"]);
  });

  it("Wahoo unlocks first and enters SIM mode with rider weight", async () => {
    const { sim, trainer } = await connect("wahoo");
    trainer.setSimulation({ grade: 2 });
    await settle();
    expect(sim.state.commands).toEqual(["wahoo:unlock", "wahoo:wheel", "wahoo:sim-mode:84kg", "wahoo:wind", "sim:2"]);
    trainer.setSimulation({ grade: 3 }); // only the grade changes
    await settle();
    expect(sim.state.commands.at(-1)).toBe("sim:3");
    expect(sim.state.commands.filter((c) => c.startsWith("wahoo:sim-mode")).length).toBe(1);
  });

  it("FE-C sends user configuration once", async () => {
    const { sim, trainer } = await connect("tacx-fec");
    trainer.setSimulation({ grade: 1 });
    await settle();
    trainer.setTargetPower(150);
    await settle();
    expect(sim.state.commands).toEqual(["fec:user:75", "fec:wind", "sim:1", "erg:150"]);
  });

  it("a power meter connects read-only and rejects control", async () => {
    const { trainer, ride } = await connect("cycling-power");
    expect(trainer.protocolName).toBe("cycling-power");
    expect(trainer.capabilities).toEqual({ erg: false, simulation: false });
    const errors: Error[] = [];
    trainer.on("error", (e) => errors.push(e));
    trainer.setTargetPower(200);
    await settle();
    expect(errors[0]?.name).toBe("UnsupportedError");
    trainer.releaseControl(); // read-only use is fine and raises nothing
    await settle();
    expect(errors).toHaveLength(1);
    expect(trainer.ergActive).toBe(false);
    await ride();
    await ride();
    expect(trainer.data.power).toBeGreaterThan(0);
  });

  it("falls back from a failing FTMS to the Wahoo protocol on the same device", async () => {
    const bluetooth = new FakeBluetooth();
    const sim = bluetooth.add(createSimulatedTrainer("wahoo", "KICKR CORE"));
    // Same device additionally exposes FTMS whose control point never grants control.
    const ftms = createSimulatedTrainer("ftms");
    for (const [uuid, service] of ftms.device.services) {
      const copy = sim.device.addService(uuid);
      for (const [cu, c] of service.characteristics) {
        const cc = copy.addCharacteristic(cu, c.properties);
        cc.readData = c.readData;
        if (c.properties.indicate) cc.onWrite = (b) => cc.notify([0x80, b[0]!, 0x05]);
      }
    }
    const trainer = new Trainer({ bluetooth: bluetooth.asBluetooth() });
    const errors: string[] = [];
    trainer.on("error", (e) => errors.push(e.message));
    await trainer.connect();
    expect(trainer.protocolName).toBe("wahoo");
    expect(errors[0]).toMatch(/ftms: .*control not permitted/);
  });

  it("rejects devices without a known protocol", async () => {
    const bluetooth = new FakeBluetooth();
    const hrm = bluetooth.add(createSimulatedHeartRateMonitor());
    const trainer = new Trainer({ bluetooth: bluetooth.asBluetooth() });
    await expect(trainer.connect({ device: hrm.device.asBluetoothDevice() })).rejects.toThrow(/supported trainer/);
    expect(trainer.status).toBe("disconnected");
  });
});

describe("sharing the trainer with a watch (second FTMS client)", () => {
  async function setup(options: { exclusive?: boolean; watchFirst?: boolean } = {}) {
    const bluetooth = new FakeBluetooth();
    const sim = bluetooth.add(createSimulatedTrainer("ftms", "KICKR"));
    sim.state.exclusiveControl = options.exclusive ?? false;
    if (options.watchFirst) sim.state.otherHasControl = true;
    let clock = 0;
    const trainer = new Trainer({ bluetooth: bluetooth.asBluetooth(), now: () => clock, refreshInterval: 20 });
    const errors: string[] = [];
    trainer.on("error", (e) => errors.push(e.message));
    const controls: boolean[] = [];
    trainer.on("control", (c) => controls.push(c.ergActive));
    await trainer.connect();
    /** Let real time pass for the refresh timer while the injected clock moves on by `ms`. */
    const wait = async (ms: number) => {
      clock += ms;
      await new Promise((r) => setTimeout(r, 60));
      await settle();
    };
    return { sim, trainer, errors, controls, wait };
  }

  it("takes ERG back when the watch takes control and resets the trainer", async () => {
    const { sim, trainer, controls } = await setup();
    trainer.setTargetPower(200);
    await settle();
    expect(trainer.ergActive).toBe(true);
    sim.otherClient.takeControl(); // watch connects: Request Control + Reset
    await settle();
    expect(sim.state.mode).toEqual({ kind: "erg", watts: 200 });
    expect(sim.state.controlGranted).toBe(true);
    expect(trainer.ergActive).toBe(true);
    expect(controls.at(-1)).toBe(true);
    trainer.disconnect();
  });

  it("re-sends the target when the watch changes it", async () => {
    const { sim, trainer } = await setup();
    trainer.setTargetPower(200);
    await settle();
    sim.otherClient.takeControl({ reset: false, notify: false });
    sim.otherClient.setTargetPower(120);
    await settle();
    expect(sim.state.mode).toEqual({ kind: "erg", watts: 200 });
    trainer.disconnect();
  });

  it("restores a target that the trainer dropped silently (refresh)", async () => {
    const { sim, trainer, wait } = await setup();
    trainer.setTargetPower(200);
    await settle();
    sim.otherClient.takeControl({ notify: false });
    expect(sim.state.mode).toEqual({ kind: "none" });
    await wait(100);
    expect(sim.state.mode).toEqual({ kind: "erg", watts: 200 });
    trainer.disconnect();
  });

  it("connects read-only while the watch holds control, then takes over once it lets go", async () => {
    const { sim, trainer, errors, wait } = await setup({ exclusive: true, watchFirst: true });
    expect(trainer.status).toBe("connected");
    expect(trainer.protocolName).toBe("ftms");
    expect(trainer.capabilities).toEqual({ erg: false, simulation: false });
    expect(trainer.controlDenied).toBe(true);
    expect(errors[0]).toMatch(/ftms: .*control not permitted.*watch/);
    sim.tick();
    await settle();
    expect(trainer.data.cadence).toBe(90); // data flows anyway

    trainer.setTargetPower(200);
    await settle();
    expect(trainer.ergActive).toBe(false); // honest: the trainer does not hold 200 W
    expect(sim.state.mode).toEqual({ kind: "none" });
    const requests = sim.state.commands.filter((c) => c.startsWith("ftms:request")).length;
    trainer.setTargetPower(210);
    await settle();
    // Refused a moment ago: no new request per call
    expect(sim.state.commands.filter((c) => c.startsWith("ftms:request")).length).toBe(requests);

    sim.otherClient.release();
    await wait(6000);
    expect(sim.state.mode).toEqual({ kind: "erg", watts: 210 });
    expect(trainer.capabilities.erg).toBe(true);
    expect(trainer.controlDenied).toBe(false);
    expect(trainer.ergActive).toBe(true);
    trainer.disconnect();
  });

  it("gets control at once from trainers that hand it to the latest client", async () => {
    const { sim, trainer } = await setup({ watchFirst: true });
    expect(trainer.capabilities.erg).toBe(true);
    trainer.setTargetPower(150);
    await settle();
    expect(sim.state.mode).toEqual({ kind: "erg", watts: 150 });
    trainer.disconnect();
  });

  it("reports ERG as not working when the watch keeps control", async () => {
    const { sim, trainer, controls } = await setup({ exclusive: true });
    trainer.setTargetPower(200);
    await settle();
    expect(trainer.ergActive).toBe(true);
    sim.otherClient.takeControl();
    await settle();
    expect(trainer.ergActive).toBe(false);
    expect(trainer.controlDenied).toBe(true);
    expect(controls.at(-1)).toBe(false);
    trainer.disconnect();
  });
});

describe("spin-down calibration", () => {
  async function run(protocol: ProtocolName, options: { fails?: boolean } = {}) {
    const t = await connect(protocol);
    t.sim.state.spinDownFails = options.fails;
    const phases: string[] = [];
    t.trainer.on("spinDown", (p) => {
      phases.push(p.phase);
      if (p.phase === "done" || p.phase === "failed") expect(t.trainer.spinningDown).toBe(false);
    });
    t.trainer.setTargetPower(200);
    await settle();
    const done = t.trainer.spinDown();
    await settle();
    expect(t.trainer.spinningDown).toBe(true);
    expect(t.trainer.ergActive).toBe(false);
    t.sim.state.cadence = 60; // ~22 km/h: too slow
    await t.ride();
    t.sim.state.cadence = 90; // ~33 km/h: fast enough
    await t.ride();
    t.sim.state.cadence = 0; // stop pedalling, coast
    await t.ride();
    const result = await done;
    await settle();
    return { ...t, result, phases };
  }

  it.each(["ftms", "tacx-fec"] as const)("%s: guides speed-up, coast, done; then restores ERG", async (protocol) => {
    const { trainer, sim, result, phases } = await run(protocol);
    expect(trainer.spinDownSupported).toBe(true);
    expect(result.ok).toBe(true);
    expect(phases).toEqual(["starting", "speed-up", "coast", "done"]);
    expect(sim.state.commands).toContain("spin-down:start");
    expect(sim.state.commands).toContain("spin-down:done");
    // ERG was held back during the spin-down and comes back afterwards
    const start = sim.state.commands.indexOf("spin-down:start");
    expect(sim.state.commands.slice(start).filter((c) => c === "erg:200")).toHaveLength(1);
    expect(sim.state.commands.at(-1)).toBe("erg:200");
    expect(sim.state.mode).toEqual({ kind: "erg", watts: 200 });
    expect(trainer.ergActive).toBe(true);
    if (protocol === "tacx-fec") expect(result.spinDownTime).toBe(9000);
  });

  it("FTMS reports the target speed window", async () => {
    const t = await connect("ftms");
    const progress: unknown[] = [];
    t.trainer.on("spinDown", (p) => progress.push(p));
    void t.trainer.spinDown();
    await settle();
    expect(progress[1]).toEqual({ phase: "speed-up", targetSpeed: { low: 25, high: 30 } });
    t.trainer.cancelSpinDown();
    await settle();
  });

  it.each(["ftms", "tacx-fec"] as const)("%s: reports a failed spin-down", async (protocol) => {
    const { result, phases } = await run(protocol, { fails: true });
    expect(result.ok).toBe(false);
    expect(phases.at(-1)).toBe("failed");
  });

  it("can be cancelled and times out", async () => {
    const t = await connect("ftms");
    const cancelled = t.trainer.spinDown();
    await settle();
    t.trainer.cancelSpinDown();
    expect(await cancelled).toEqual({ ok: false, message: "cancelled" });
    await settle();
    expect(t.sim.state.commands.at(-1)).toBe("spin-down:cancel");
    expect(await t.trainer.spinDown({ timeout: 10 })).toEqual({ ok: false, message: "timed out" });
    expect(t.trainer.spinningDown).toBe(false);
  });

  it("ends when the connection drops", async () => {
    const t = await connect("ftms");
    const done = t.trainer.spinDown();
    await settle();
    t.sim.device.drop();
    expect(await done).toEqual({ ok: false, message: "connection lost" });
  });

  it("is not offered by Wahoo legacy and power meters", async () => {
    for (const protocol of ["wahoo", "cycling-power"] as const) {
      const { trainer } = await connect(protocol);
      expect(trainer.spinDownSupported).toBe(false);
      await expect(trainer.spinDown()).rejects.toThrow(/not supported/);
      trainer.disconnect();
    }
  });
});

describe("IndoorBike facade", () => {
  it("merges trainer and heart rate strap data", async () => {
    const bluetooth = new FakeBluetooth();
    const sim = bluetooth.add(createSimulatedTrainer("ftms"));
    const hrm = bluetooth.add(createSimulatedHeartRateMonitor());
    const bike = new IndoorBike({ bluetooth: bluetooth.asBluetooth() });
    const onData = vi.fn();
    bike.on("data", onData);
    await bike.connectTrainer();
    await bike.connectHeartRateMonitor();
    bike.setTargetPower(210);
    await settle();
    sim.tick();
    hrm.bpm = 133;
    hrm.tick();
    await settle();
    expect(bike.data).toMatchObject({ power: 210, cadence: 90, heartRate: 133 });
    expect(onData).toHaveBeenCalled();

    const statuses: unknown[] = [];
    bike.on("status", (s) => statuses.push(s));
    bike.disconnect();
    await settle();
    expect(statuses).toEqual([
      { device: "trainer", status: "disconnected" },
      { device: "heartRateMonitor", status: "disconnected" },
    ]);
    expect(bike.data).toEqual({});
  });

  it("does not auto-reconnect after an explicit disconnect", async () => {
    const bluetooth = new FakeBluetooth();
    const sim = bluetooth.add(createSimulatedTrainer("ftms"));
    const bike = new IndoorBike({ bluetooth: bluetooth.asBluetooth(), reconnectDelays: [0] });
    await bike.connectTrainer();
    bike.disconnect();
    await settle();
    expect(sim.device.gatt.connected).toBe(false);
    expect(bike.trainer.status).toBe("disconnected");
  });
});
