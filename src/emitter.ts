type Listener<T> = (payload: T) => void;

/** Small typed event emitter. `on` returns an unsubscribe function. */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener as Listener<never>);
    return () => this.off(type, listener);
  }

  once<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, listener: Listener<Events[K]>): void {
    this.listeners.get(type)?.delete(listener as Listener<never>);
  }

  protected emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (error) {
        // A throwing game callback must not break the Bluetooth event pipeline.
        console.error(error);
      }
    }
  }
}
