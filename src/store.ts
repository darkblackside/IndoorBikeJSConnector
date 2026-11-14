import type { PowerRange } from "./ftms/controlPoint.ts";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface Connection {
  status: ConnectionStatus;
  name?: string;
}

export interface State {
  trainer: Connection;
  heartRateMonitor: Connection;
  /** Live values, undefined until a device reports them. */
  power?: number;
  cadence?: number;
  speed?: number;
  heartRate?: number;
  distance?: number;
  /** ERG target in watts; undefined = free ride (no target sent). */
  targetPower?: number;
  /** Functional Threshold Power in watts. */
  ftp: number;
  /** Trainer accepted control (FTMS Request Control succeeded). */
  ergAvailable: boolean;
  powerRange?: PowerRange;
  /** Most recent first. */
  log: string[];
}

type Listener = (state: Readonly<State>, previous: Readonly<State>) => void;

const FTP_KEY = "indoorbike.ftp";
const MAX_LOG = 50;

function loadFtp(): number {
  try {
    const value = Number(localStorage.getItem(FTP_KEY));
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
    // storage unavailable (private mode etc.) – fall through to default
  }
  return 200;
}

/** Minimal observable store: one state object, shallow updates, synchronous listeners. */
export class Store {
  private state: State = {
    trainer: { status: "disconnected" },
    heartRateMonitor: { status: "disconnected" },
    ftp: loadFtp(),
    ergAvailable: false,
    log: [],
  };
  private listeners = new Set<Listener>();

  get(): Readonly<State> {
    return this.state;
  }

  update(patch: Partial<State>): void {
    const previous = this.state;
    this.state = { ...previous, ...patch };
    if (patch.ftp !== undefined && patch.ftp !== previous.ftp) {
      try {
        localStorage.setItem(FTP_KEY, String(patch.ftp));
      } catch {
        // ignore
      }
    }
    for (const listener of this.listeners) listener(this.state, previous);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  log(message: string): void {
    const line = `${new Date().toLocaleTimeString()}  ${message}`;
    console.info(message);
    this.update({ log: [line, ...this.state.log].slice(0, MAX_LOG) });
  }
}
