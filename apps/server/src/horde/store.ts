import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** The persistent part of the horde world: all the sweat ever fed. */
export interface HordeStore {
  readonly total: number;
  add(sweat: number): void;
  /** Writes pending changes (no-op for the memory store). */
  flush(): Promise<void>;
  close(): Promise<void>;
}

export class MemoryHordeStore implements HordeStore {
  total: number;
  constructor(total = 0) {
    this.total = total;
  }
  add(sweat: number) {
    if (Number.isFinite(sweat) && sweat > 0) this.total += sweat;
  }
  async flush() {}
  async close() {}
}

interface SavedHorde {
  version: 1;
  total: number;
  updatedAt: string;
}

/**
 * Keeps the total in a small JSON file, written every few seconds when it changed (atomically: temp file + rename),
 * so a restart or a crash loses at most that much sweat.
 */
export class FileHordeStore extends MemoryHordeStore {
  private dirty = false;
  private timer: NodeJS.Timeout | undefined;
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    total: number,
    saveEveryMs: number,
  ) {
    super(total);
    this.timer = setInterval(() => void this.flush(), saveEveryMs);
    this.timer.unref();
  }

  static async open(path: string, saveEveryMs = 10_000): Promise<FileHordeStore> {
    let total = 0;
    try {
      const saved = JSON.parse(await readFile(path, "utf8")) as Partial<SavedHorde>;
      if (typeof saved.total === "number" && Number.isFinite(saved.total) && saved.total >= 0) total = saved.total;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`horde store: could not read ${path}, starting at 0`, e);
    }
    return new FileHordeStore(path, total, saveEveryMs);
  }

  override add(sweat: number) {
    const before = this.total;
    super.add(sweat);
    if (this.total !== before) this.dirty = true;
  }

  override flush(): Promise<void> {
    if (!this.dirty) return this.writing;
    this.dirty = false;
    const data: SavedHorde = { version: 1, total: this.total, updatedAt: new Date().toISOString() };
    this.writing = this.writing.then(async () => {
      try {
        await mkdir(dirname(this.path), { recursive: true });
        const tmp = `${this.path}.tmp`;
        await writeFile(tmp, JSON.stringify(data, null, 2));
        await rename(tmp, this.path);
      } catch (e) {
        this.dirty = true;
        console.error(`horde store: could not write ${this.path}`, e);
      }
    });
    return this.writing;
  }

  override async close() {
    clearInterval(this.timer);
    await this.flush();
  }
}
