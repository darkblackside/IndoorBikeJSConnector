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
