/**
 * Generic pool. The world never allocates meshes during a run: every train,
 * obstacle, coin and particle comes from here and goes back on recycle.
 */
export class ObjectPool<T> {
  private free: T[] = [];
  private liveCount = 0;

  constructor(
    private readonly factory: () => T,
    private readonly onAcquire?: (item: T) => void,
    private readonly onRelease?: (item: T) => void,
    prewarm = 0,
  ) {
    for (let i = 0; i < prewarm; i++) this.free.push(this.factory());
  }

  acquire(): T {
    const item = this.free.pop() ?? this.factory();
    this.liveCount++;
    this.onAcquire?.(item);
    return item;
  }

  release(item: T): void {
    this.onRelease?.(item);
    this.liveCount--;
    this.free.push(item);
  }

  get stats(): { live: number; pooled: number } {
    return { live: this.liveCount, pooled: this.free.length };
  }
}

/** Pool keyed by archetype id, used for obstacles and props. */
export class KeyedPool<T> {
  private pools = new Map<string, ObjectPool<T>>();

  constructor(
    private readonly factory: (key: string) => T,
    private readonly onAcquire?: (item: T) => void,
    private readonly onRelease?: (item: T) => void,
  ) {}

  acquire(key: string): T {
    let pool = this.pools.get(key);
    if (!pool) {
      pool = new ObjectPool<T>(() => this.factory(key), this.onAcquire, this.onRelease);
      this.pools.set(key, pool);
    }
    return pool.acquire();
  }

  release(key: string, item: T): void {
    this.pools.get(key)?.release(item);
  }

  get totals(): { live: number; pooled: number; keys: number } {
    let live = 0;
    let pooled = 0;
    for (const pool of this.pools.values()) {
      live += pool.stats.live;
      pooled += pool.stats.pooled;
    }
    return { live, pooled, keys: this.pools.size };
  }
}
