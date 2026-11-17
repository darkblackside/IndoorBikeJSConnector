/**
 * Turns a recorded ride (the ramp test, the 20-minute FTP test, …) into an activity file for Strava, Garmin Connect,
 * TrainingPeaks, intervals.icu…
 *
 * - FIT (binary, Garmin's format): the best supported one. Indoor cycling, one lap per warm-up/ramp step (or per
 *   block, for other games), power, cadence, heart rate, speed and distance per second.
 * - TCX (XML): the same data for tools that don't read FIT.
 *
 * GPX is not offered: it is a GPS format whose points require coordinates, so an indoor ride without a
 * route would need a made-up track on the map.
 */
import { rampStateAt, speedFromPower, type RampConfig, type Sample } from "./ramp.ts";

export interface ActivityPoint {
  /** Seconds since the start. */
  t: number;
  power: number;
  heartRate?: number;
  cadence?: number;
  /** m/s */
  speed: number;
  /** metres since the start */
  distance: number;
}

export interface ActivityLap {
  /** Seconds since the start. */
  start: number;
  duration: number;
  points: ActivityPoint[];
  summary: ActivitySummary;
}

export interface ActivitySummary {
  duration: number;
  /** metres */
  distance: number;
  avgPower?: number;
  maxPower?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgCadence?: number;
  maxCadence?: number;
  /** m/s */
  avgSpeed?: number;
  maxSpeed?: number;
  /** kJ of mechanical work */
  work: number;
  /** kcal; ≈ kJ of work (about 24 % efficiency, 1 kcal = 4.184 kJ) */
  calories: number;
}

export interface Activity {
  /** Wall-clock start. */
  start: Date;
  points: ActivityPoint[];
  laps: ActivityLap[];
  summary: ActivitySummary;
}

/** Speed of a sample in m/s: the trainer's, or from the power (flat-road physics) when it reports none. */
export const sampleSpeed = (s: Sample): number => (s.speed !== undefined ? s.speed / 3.6 : speedFromPower(s.power));

/** Metres ridden over the samples, the same way the exported activity counts them. */
export function trackDistance(samples: readonly Sample[]): number {
  let d = 0;
  for (let i = 1; i < samples.length; i++) d += sampleSpeed(samples[i]!) * (samples[i]!.t - samples[i - 1]!.t);
  return d;
}

/**
 * Build the activity from the 1 Hz samples. Speed comes from the trainer when it reports one,
 * otherwise from the power (flat-road physics), so the activity has a plausible distance.
 *
 * Laps: a ramp config gives one lap per warm-up / ramp step; a list of lap start times (seconds since the start,
 * ascending) gives one lap per entry that has samples, for games with their own structure (e.g. one per block).
 */
export function buildActivity(
  samples: readonly Sample[],
  laps: RampConfig | readonly number[],
  start: Date,
  duration?: number,
): Activity {
  let distance = 0;
  const points: ActivityPoint[] = samples.map((s, i) => {
    const speed = sampleSpeed(s);
    const dt = i === 0 ? 0 : s.t - samples[i - 1]!.t;
    distance += speed * dt;
    return { t: s.t, power: s.power, heartRate: s.heartRate, cadence: s.cadence, speed, distance };
  });
  const end = Math.max(duration ?? 0, (points.at(-1)?.t ?? 0) + (points.length ? 1 : 0));
  const lapOf = Array.isArray(laps) ? lapIndexIn(laps as readonly number[]) : (t: number) => rampStateAt(laps as RampConfig, t).step;
  return { start, points, laps: splitLaps(points, lapOf, end), summary: summarize(points, end, distance) };
}

/** Lap number of a time for a list of ascending lap start times (before the first start: lap 0). */
const lapIndexIn = (starts: readonly number[]) => (t: number) => {
  let i = 0;
  while (i + 1 < starts.length && starts[i + 1]! <= t) i++;
  return i;
};

/** One lap per run of points with the same lap number, as a smart trainer app would record it. */
function splitLaps(points: readonly ActivityPoint[], lapOf: (t: number) => number, end: number): ActivityLap[] {
  const laps: ActivityLap[] = [];
  let current: number | undefined;
  for (const p of points) {
    const n = lapOf(p.t);
    const lap = laps.at(-1);
    if (lap && n === current) lap.points.push(p);
    else laps.push({ start: p.t, duration: 0, points: [p], summary: summarize([], 0, 0) });
    current = n;
  }
  laps.forEach((lap, i) => {
    lap.duration = (laps[i + 1]?.start ?? end) - lap.start;
    const before = i === 0 ? 0 : laps[i - 1]!.points.at(-1)!.distance;
    lap.summary = summarize(lap.points, lap.duration, lap.points.at(-1)!.distance - before);
  });
  return laps;
}

export function summarize(points: readonly ActivityPoint[], duration: number, distance: number): ActivitySummary {
  const stats = (values: (number | undefined)[]) => {
    const v = values.filter((x): x is number => x !== undefined);
    if (!v.length) return { avg: undefined, max: undefined };
    return { avg: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v) };
  };
  const power = stats(points.map((p) => p.power));
  const hr = stats(points.map((p) => p.heartRate));
  // Coasting zeros would pull the average cadence down; devices and Strava leave them out too.
  const cadence = stats(points.map((p) => (p.cadence ? p.cadence : undefined)));
  const speed = stats(points.map((p) => p.speed));
  const work = points.reduce((a, p) => a + p.power, 0) / 1000; // 1 s per point
  const round = (v: number | undefined) => (v === undefined ? undefined : Math.round(v));
  return {
    duration,
    distance,
    avgPower: round(power.avg),
    maxPower: round(power.max),
    avgHeartRate: round(hr.avg),
    maxHeartRate: round(hr.max),
    avgCadence: round(cadence.avg),
    maxCadence: round(cadence.max),
    avgSpeed: speed.avg,
    maxSpeed: speed.max,
    work,
    calories: Math.round(work / 4.184 / 0.24),
  };
}

// ---------------------------------------------------------------------------------------------
// FIT
// ---------------------------------------------------------------------------------------------

/** Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
const FIT_EPOCH = 631065600;
const fitTime = (date: Date) => Math.round(date.getTime() / 1000) - FIT_EPOCH;

const Base = { enum: 0x00, uint8: 0x02, uint16: 0x84, uint32: 0x86, uint32z: 0x8c } as const;
type BaseType = keyof typeof Base;
const SIZE: Record<BaseType, number> = { enum: 1, uint8: 1, uint16: 2, uint32: 4, uint32z: 4 };
const INVALID: Record<BaseType, number> = { enum: 0xff, uint8: 0xff, uint16: 0xffff, uint32: 0xffffffff, uint32z: 0 };

const Msg = { fileId: 0, session: 18, lap: 19, record: 20, event: 21, activity: 34 } as const;
const Event = { timer: 0, session: 8, lap: 9, activity: 26 } as const;
const EventType = { start: 0, stop: 1, stopAll: 4 } as const;
const SPORT_CYCLING = 2;
const SUB_SPORT_INDOOR_CYCLING = 6;

/** Field: [field number, base type]. */
type FieldDef = readonly [number, BaseType];

class FitWriter {
  private bytes: number[] = [];
  private nextLocal = 0;

  /** Write a definition message; returns its local message type. */
  define(globalMessage: number, fields: readonly FieldDef[]): { local: number; fields: readonly FieldDef[] } {
    const local = this.nextLocal++ & 0x0f;
    this.bytes.push(0x40 | local, 0, 0, globalMessage & 0xff, globalMessage >> 8, fields.length);
    for (const [num, type] of fields) this.bytes.push(num, SIZE[type], Base[type]);
    return { local, fields };
  }

  /** Write a data message; undefined/non-finite values are written as the type's "invalid" value. */
  data(def: { local: number; fields: readonly FieldDef[] }, values: readonly (number | undefined)[]): void {
    this.bytes.push(def.local);
    def.fields.forEach(([, type], i) => {
      const raw = values[i];
      let v = raw === undefined || !Number.isFinite(raw) ? INVALID[type] : Math.round(raw);
      if (raw !== undefined && Number.isFinite(raw)) v = Math.min(Math.max(v, 0), INVALID[type] === 0 ? 0xffffffff : INVALID[type] - 1);
      for (let b = 0; b < SIZE[type]; b++) this.bytes.push((v / 2 ** (8 * b)) & 0xff);
    });
  }

  file(): Uint8Array<ArrayBuffer> {
    const header = [14, 0x20, 2132 & 0xff, 2132 >> 8, ...u32(this.bytes.length), 0x2e, 0x46, 0x49, 0x54]; // ".FIT"
    const headerCrc = fitCrc(header);
    const body = [...header, headerCrc & 0xff, headerCrc >> 8, ...this.bytes];
    const crc = fitCrc(body.slice(14));
    return Uint8Array.from([...body, crc & 0xff, crc >> 8]);
  }
}

const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01,
  0x8801, 0x4400,
];

/** CRC-16 as defined by the FIT protocol. */
export function fitCrc(bytes: ArrayLike<number>, crc = 0): number {
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    let tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf]!;
    tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf]!;
  }
  return crc;
}

/** Encode the activity as a FIT activity file (indoor cycling). */
export function encodeFit(a: Activity): Uint8Array<ArrayBuffer> {
  const w = new FitWriter();
  const start = fitTime(a.start);
  const at = (t: number) => start + Math.round(t);
  const end = at(a.summary.duration);
  const ms = (s: number) => s * 1000;

  const fileId = w.define(Msg.fileId, [[0, "enum"], [1, "uint16"], [2, "uint16"], [3, "uint32z"], [4, "uint32"]]);
  w.data(fileId, [4 /* activity */, 255 /* development */, 0, (start & 0x7fffffff) || 1, start]);

  const event = w.define(Msg.event, [[253, "uint32"], [0, "enum"], [1, "enum"]]);
  w.data(event, [start, Event.timer, EventType.start]);

  const record = w.define(Msg.record, [
    [253, "uint32"],
    [3, "uint8"], // heart_rate
    [4, "uint8"], // cadence
    [5, "uint32"], // distance, 1/100 m
    [6, "uint16"], // speed, 1/1000 m/s
    [7, "uint16"], // power
  ]);
  const lap = w.define(Msg.lap, [
    [253, "uint32"],
    [0, "enum"], // event
    [1, "enum"], // event_type
    [2, "uint32"], // start_time
    [7, "uint32"], // total_elapsed_time, ms
    [8, "uint32"], // total_timer_time, ms
    [9, "uint32"], // total_distance, 1/100 m
    [11, "uint16"], // total_calories
    [13, "uint16"], // avg_speed
    [14, "uint16"], // max_speed
    [15, "uint8"], // avg_heart_rate
    [16, "uint8"], // max_heart_rate
    [17, "uint8"], // avg_cadence
    [18, "uint8"], // max_cadence
    [19, "uint16"], // avg_power
    [20, "uint16"], // max_power
    [25, "enum"], // sport
  ]);
  for (const l of a.laps) {
    for (const p of l.points) {
      w.data(record, [at(p.t), p.heartRate, p.cadence, p.distance * 100, p.speed * 1000, p.power]);
    }
    const s = l.summary;
    w.data(lap, [
      at(l.start + l.duration),
      Event.lap,
      EventType.stop,
      at(l.start),
      ms(l.duration),
      ms(l.duration),
      s.distance * 100,
      s.calories,
      s.avgSpeed === undefined ? undefined : s.avgSpeed * 1000,
      s.maxSpeed === undefined ? undefined : s.maxSpeed * 1000,
      s.avgHeartRate,
      s.maxHeartRate,
      s.avgCadence,
      s.maxCadence,
      s.avgPower,
      s.maxPower,
      SPORT_CYCLING,
    ]);
  }

  w.data(event, [end, Event.timer, EventType.stopAll]);

  const s = a.summary;
  const session = w.define(Msg.session, [
    [253, "uint32"],
    [0, "enum"], // event
    [1, "enum"], // event_type
    [2, "uint32"], // start_time
    [5, "enum"], // sport
    [6, "enum"], // sub_sport
    [7, "uint32"], // total_elapsed_time
    [8, "uint32"], // total_timer_time
    [9, "uint32"], // total_distance
    [11, "uint16"], // total_calories
    [14, "uint16"], // avg_speed
    [15, "uint16"], // max_speed
    [16, "uint8"], // avg_heart_rate
    [17, "uint8"], // max_heart_rate
    [18, "uint8"], // avg_cadence
    [19, "uint8"], // max_cadence
    [20, "uint16"], // avg_power
    [21, "uint16"], // max_power
    [25, "uint16"], // first_lap_index
    [26, "uint16"], // num_laps
  ]);
  w.data(session, [
    end,
    Event.session,
    EventType.stop,
    start,
    SPORT_CYCLING,
    SUB_SPORT_INDOOR_CYCLING,
    ms(s.duration),
    ms(s.duration),
    s.distance * 100,
    s.calories,
    s.avgSpeed === undefined ? undefined : s.avgSpeed * 1000,
    s.maxSpeed === undefined ? undefined : s.maxSpeed * 1000,
    s.avgHeartRate,
    s.maxHeartRate,
    s.avgCadence,
    s.maxCadence,
    s.avgPower,
    s.maxPower,
    0,
    a.laps.length,
  ]);

  const activity = w.define(Msg.activity, [
    [253, "uint32"],
    [0, "uint32"], // total_timer_time
    [1, "uint16"], // num_sessions
    [2, "enum"], // type: manual
    [3, "enum"], // event
    [4, "enum"], // event_type
    [5, "uint32"], // local_timestamp
  ]);
  const localOffset = -a.start.getTimezoneOffset() * 60;
  w.data(activity, [end, ms(s.duration), 1, 0, Event.activity, EventType.stop, end + localOffset]);

  return w.file();
}

// ---------------------------------------------------------------------------------------------
// TCX
// ---------------------------------------------------------------------------------------------

/** Encode the activity as Garmin Training Center XML (power and speed in the ActivityExtension). */
export function encodeTcx(a: Activity, notes?: string): string {
  const iso = (t: number) => new Date(a.start.getTime() + Math.round(t) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const n = (v: number, d = 0) => v.toFixed(d);
  const hr = (tag: string, v: number | undefined) =>
    v === undefined ? "" : `<${tag}><Value>${Math.round(v)}</Value></${tag}>`;
  const laps = a.laps
    .map((l) => {
      const s = l.summary;
      const points = l.points
        .map(
          (p) =>
            `<Trackpoint><Time>${iso(p.t)}</Time><DistanceMeters>${n(p.distance, 1)}</DistanceMeters>` +
            hr("HeartRateBpm", p.heartRate) +
            (p.cadence === undefined ? "" : `<Cadence>${Math.min(254, Math.round(p.cadence))}</Cadence>`) +
            `<Extensions><ns3:TPX><ns3:Speed>${n(p.speed, 2)}</ns3:Speed><ns3:Watts>${Math.round(p.power)}</ns3:Watts></ns3:TPX></Extensions>` +
            `</Trackpoint>`,
        )
        .join("\n          ");
      return `      <Lap StartTime="${iso(l.start)}">
        <TotalTimeSeconds>${n(l.duration, 1)}</TotalTimeSeconds>
        <DistanceMeters>${n(s.distance, 1)}</DistanceMeters>
        ${s.maxSpeed === undefined ? "" : `<MaximumSpeed>${n(s.maxSpeed, 2)}</MaximumSpeed>`}
        <Calories>${s.calories}</Calories>
        ${hr("AverageHeartRateBpm", s.avgHeartRate)}${hr("MaximumHeartRateBpm", s.maxHeartRate)}
        <Intensity>Active</Intensity>
        ${s.avgCadence === undefined ? "" : `<Cadence>${s.avgCadence}</Cadence>`}
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
          ${points}
        </Track>
        <Extensions><ns3:LX>${s.avgPower === undefined ? "" : `<ns3:AvgWatts>${s.avgPower}</ns3:AvgWatts>`}${
          s.maxPower === undefined ? "" : `<ns3:MaxWatts>${s.maxPower}</ns3:MaxWatts>`
        }</ns3:LX></Extensions>
      </Lap>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>${iso(0)}</Id>
${laps}
${notes ? `      <Notes>${escapeXml(notes)}</Notes>\n` : ""}    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
