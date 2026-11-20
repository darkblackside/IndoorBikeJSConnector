/**
 * The rider's profile in this browser (localStorage, no account): the FTP from the last test (or typed in) and the
 * display name for the online games. The FTP tests save their result here; Feed the Horde reads it.
 */

export type FtpSource = "ftp20" | "zombie-ramp" | "manual";

export interface StoredFtp {
  watts: number;
  source: FtpSource;
  /** ISO date of the test / entry. */
  date: string;
}

const FTP_KEY = "indoor-bike.ftp";
const NAME_KEY = "indoor-bike.name";

/** localStorage can be missing or throw (private mode, blocked storage): everything here then just does nothing. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function loadFtp(): StoredFtp | undefined {
  try {
    const v = JSON.parse(read(FTP_KEY) ?? "null") as Partial<StoredFtp> | null;
    if (v && typeof v.watts === "number" && v.watts >= 50 && v.watts <= 600) {
      return { watts: Math.round(v.watts), source: v.source ?? "manual", date: v.date ?? "" };
    }
  } catch {
    /* corrupt entry */
  }
  return undefined;
}

export function saveFtp(watts: number, source: FtpSource) {
  if (!(watts >= 50 && watts <= 600)) return;
  write(FTP_KEY, JSON.stringify({ watts: Math.round(watts), source, date: new Date().toISOString() } satisfies StoredFtp));
}

export const loadName = () => read(NAME_KEY) ?? "";
export const saveName = (name: string) => write(NAME_KEY, name.trim().slice(0, 24));

/** Generic JSON storage for small per-game things (records, view settings). */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = read(key);
    return v === null ? fallback : { ...fallback, ...(JSON.parse(v) as T) };
  } catch {
    return fallback;
  }
}
export const saveJson = (key: string, value: unknown) => write(key, JSON.stringify(value));
