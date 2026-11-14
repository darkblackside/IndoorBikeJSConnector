import { Characteristic, fec, ftms, Service, type ProtocolName } from "../src/index.ts";
import {
  encodeCyclingPowerMeasurement,
  encodeFecGeneral,
  encodeFecTrainer,
  encodeHeartRate,
  encodeIndoorBikeData,
} from "./encoders.ts";
import { FakeDevice, type FakeCharacteristic } from "./fakeGatt.ts";

export type SimulatedMode =
  | { kind: "none" }
  | { kind: "erg"; watts: number }
  | { kind: "simulation"; grade: number };

export interface SimulatedTrainerState {
  mode: SimulatedMode;
  /** Rider's cadence; change it to simulate pedalling harder/slower. */
  cadence: number;
  power: number;
  speed: number;
  distance: number;
  /** Seconds simulated so far. */
  time: number;
  /** FTMS: control requested; Wahoo: unlocked. Commands before that are rejected/ignored. */
  controlGranted: boolean;
  /** Decoded commands received, for assertions. */
  commands: string[];
}

export interface SimulatedDevice {
  device: FakeDevice;
  /** Advance the simulation and send one data notification. */
  tick(dtSeconds?: number): void;
  /** Tick every `intervalMs` until stop() is called. */
  start(intervalMs?: number): void;
  stop(): void;
}

export interface SimulatedTrainer extends SimulatedDevice {
  protocol: ProtocolName;
  state: SimulatedTrainerState;
}

const TOTAL_MASS = 84; // kg
const G = 9.81;

/** Power needed to ride at `speedKmh` on `grade` % (rolling + gravity + aero). */
function simulatedPower(speedKmh: number, grade: number, crr = 0.004, cw = 0.51): number {
  const v = speedKmh / 3.6;
  const slope = Math.atan(grade / 100);
  return Math.max(0, v * (TOTAL_MASS * G * (Math.sin(slope) + crr * Math.cos(slope))) + cw * v ** 3);
}

/**
 * A trainer that behaves like the real thing on the BLE level for the given protocol:
 * same services/characteristics, packets, control handshake. ERG holds the target,
 * SIM derives power from grade at a speed proportional to cadence.
 */
export function createSimulatedTrainer(protocol: ProtocolName, name = defaultName(protocol)): SimulatedTrainer {
  const device = new FakeDevice(name);
  const state: SimulatedTrainerState = {
    mode: { kind: "none" },
    cadence: 90,
    power: 0,
    speed: 0,
    distance: 0,
    time: 0,
    controlGranted: false,
    commands: [],
  };
  let wheelRevs = 0;
  let crankRevs = 0;
  let fecEvents = 0;
  let notify: (() => void) | undefined;

  const step = (dt: number) => {
    state.time += dt;
    state.speed = state.cadence * 0.37; // ~33 km/h at 90 rpm
    const m = state.mode;
    state.power =
      state.cadence === 0
        ? 0
        : m.kind === "erg"
          ? m.watts
          : simulatedPower(state.speed, m.kind === "simulation" ? m.grade : 0);
    state.distance += (state.speed / 3.6) * dt;
    wheelRevs = state.distance / 2.096;
    crankRevs += (state.cadence / 60) * dt;
  };

  const command = (description: string, mode?: SimulatedMode) => {
    state.commands.push(description);
    if (mode) state.mode = mode;
  };

  switch (protocol) {
    case "ftms": {
      const svc = device.addService(Service.fitnessMachine);
      const data = svc.addCharacteristic(Characteristic.indoorBikeData, { notify: true });
      const feature = svc.addCharacteristic(Characteristic.fitnessMachineFeature, { read: true });
      feature.readData = () => Uint8Array.of(0x02, 0x40, 0, 0, 0x08, 0x20, 0, 0); // cadence+power; power target + sim
      const range = svc.addCharacteristic(Characteristic.supportedPowerRange, { read: true });
      range.readData = () => Uint8Array.of(0, 0, 0xd0, 0x07, 1, 0); // 0–2000 W
      const cp = svc.addCharacteristic(Characteristic.fitnessMachineControlPoint, { write: true, indicate: true });
      cp.onWrite = (b) => {
        const op = b[0]!;
        const respond = (result: number) => cp.notify([0x80, op, result]);
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        if (op === ftms.FtmsOpCode.RequestControl) {
          state.controlGranted = true;
          command("ftms:request-control");
          return respond(ftms.FtmsResult.Success);
        }
        if (!state.controlGranted) return respond(ftms.FtmsResult.ControlNotPermitted);
        switch (op) {
          case ftms.FtmsOpCode.StartOrResume:
            command("ftms:start");
            return respond(ftms.FtmsResult.Success);
          case ftms.FtmsOpCode.SetTargetPower: {
            const watts = v.getInt16(1, true);
            command(`erg:${watts}`, { kind: "erg", watts });
            return respond(ftms.FtmsResult.Success);
          }
          case ftms.FtmsOpCode.SetIndoorBikeSimulation: {
            const grade = v.getInt16(3, true) / 100;
            command(`sim:${grade}`, { kind: "simulation", grade });
            return respond(ftms.FtmsResult.Success);
          }
          default:
            return respond(ftms.FtmsResult.OpCodeNotSupported);
        }
      };
      notify = () =>
        data.notify(
          encodeIndoorBikeData({ speed: state.speed, cadence: state.cadence, power: state.power, distance: state.distance }),
        );
      break;
    }

    case "wahoo":
    case "cycling-power": {
      const svc = device.addService(Service.cyclingPower);
      const measurement = svc.addCharacteristic(Characteristic.cyclingPowerMeasurement, { notify: true });
      if (protocol === "wahoo") {
        const control = svc.addCharacteristic(Characteristic.wahooTrainer, { write: true, notify: true });
        control.onWrite = (b) => onWahooWrite(control, b, state, command);
      }
      notify = () =>
        measurement.notify(
          encodeCyclingPowerMeasurement({
            power: state.power,
            // Like a real sensor: count whole revolutions, timestamp = when the last one completed.
            wheel: revolutionEvent(wheelRevs, state.speed / 3.6 / 2.096, state.time, 2048),
            crank: revolutionEvent(crankRevs, state.cadence / 60, state.time, 1024),
          }),
        );
      break;
    }

    case "tacx-fec": {
      const svc = device.addService(Service.tacxFec);
      const read = svc.addCharacteristic(Characteristic.tacxFecRead, { notify: true });
      const write = svc.addCharacteristic(Characteristic.tacxFecWrite, { writeWithoutResponse: true });
      write.onWrite = (b) => {
        const page = fec.unwrapFecMessage(new DataView(b.buffer, b.byteOffset, b.byteLength));
        if (!page) return command("fec:invalid");
        switch (page.getUint8(0)) {
          case fec.FecPage.TargetPower: {
            const watts = page.getUint16(6, true) / 4;
            return command(`erg:${watts}`, { kind: "erg", watts });
          }
          case fec.FecPage.TrackResistance: {
            const grade = Math.round(page.getUint16(5, true) - 20000) / 100;
            return command(`sim:${grade}`, { kind: "simulation", grade });
          }
          case fec.FecPage.WindResistance:
            return command("fec:wind");
          case fec.FecPage.UserConfiguration:
            return command(`fec:user:${page.getUint16(1, true) / 100}`);
        }
      };
      let alternate = false;
      notify = () => {
        alternate = !alternate;
        read.notify(
          alternate
            ? encodeFecTrainer({ cadence: state.cadence, power: state.power, events: fecEvents++ })
            : encodeFecGeneral({ speed: state.speed, distance: state.distance, elapsed: state.time }),
        );
      };
      break;
    }
  }

  return { protocol, state, device, ...ticker(device, (dt) => (step(dt), notify?.())) };
}

function revolutionEvent(revs: number, perSecond: number, now: number, ticksPerSecond: number) {
  const whole = Math.floor(revs);
  const at = perSecond > 0 ? now - (revs - whole) / perSecond : now;
  return { revolutions: whole, eventTime: Math.round(Math.max(0, at) * ticksPerSecond) };
}

function onWahooWrite(
  control: FakeCharacteristic,
  b: Uint8Array,
  state: SimulatedTrainerState,
  command: (d: string, m?: SimulatedMode) => void,
) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const op = b[0]!;
  if (op === 0x20) {
    state.controlGranted = b[1] === 0xee && b[2] === 0xfc;
    command("wahoo:unlock");
  } else if (!state.controlGranted) {
    command("wahoo:ignored-locked");
    return;
  } else if (op === 0x42) {
    const watts = v.getUint16(1, true);
    command(`erg:${watts}`, { kind: "erg", watts });
  } else if (op === 0x43) {
    command(`wahoo:sim-mode:${v.getUint16(1, true) / 100}kg`);
  } else if (op === 0x46) {
    const grade = Math.round(((v.getUint16(1, true) * 2) / 65535 - 1) * 10000) / 100;
    command(`sim:${grade}`, { kind: "simulation", grade });
  } else if (op === 0x47) {
    command("wahoo:wind");
  } else if (op === 0x48) {
    command("wahoo:wheel");
  }
  control.notify([0x01, op]); // ack
}

export function createSimulatedHeartRateMonitor(name = "Simulated HRM"): SimulatedDevice & { bpm: number } {
  const device = new FakeDevice(name);
  const svc = device.addService(Service.heartRate);
  const measurement = svc.addCharacteristic(Characteristic.heartRateMeasurement, { notify: true });
  const sim = {
    bpm: 120,
    device,
    ...ticker(device, () => measurement.notify(encodeHeartRate(Math.round(sim.bpm)))),
  };
  return sim;
}

function ticker(device: FakeDevice, onTick: (dt: number) => void) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let last = 0;
  return {
    tick(dt = 1) {
      if (device.gatt.connected) onTick(dt);
    },
    start(intervalMs = 250) {
      clearInterval(timer);
      last = performance.now();
      timer = setInterval(() => {
        const now = performance.now();
        if (device.gatt.connected) onTick((now - last) / 1000);
        last = now;
      }, intervalMs);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}

function defaultName(protocol: ProtocolName): string {
  return {
    ftms: "Simulated FTMS trainer",
    wahoo: "Simulated KICKR (legacy)",
    "tacx-fec": "Simulated Tacx",
    "cycling-power": "Simulated power meter",
  }[protocol];
}
