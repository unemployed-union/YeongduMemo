export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

/** Serializes writes so an older slow save can never overwrite a newer draft. */
export class Autosave<T> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: T | undefined;
  private chain: Promise<void> = Promise.resolve();
  private revision = 0;
  constructor(
    private save: (value: T) => Promise<void>,
    private status: (state: SaveState) => void,
    private delay = 400,
  ) {}

  update(value: T) {
    this.revision++;
    this.pending = value;
    this.status('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => undefined);
    }, this.delay);
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    const value = this.pending;
    const revision = this.revision;
    this.pending = undefined;
    if (value === undefined) return this.chain;
    this.chain = this.chain
      .catch(() => undefined)
      .then(async () => {
        this.status('saving');
        try {
          await this.save(value);
          this.status(
            this.pending === undefined && revision === this.revision ? 'saved' : 'pending',
          );
        } catch (error) {
          if (this.pending === undefined && revision === this.revision) this.pending = value;
          this.status('error');
          throw error;
        }
      });
    return this.chain;
  }
}
