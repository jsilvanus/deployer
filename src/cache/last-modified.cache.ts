export class LastModifiedCache {
  private readonly map = new Map<string, Date>();

  touch(key: string, date: Date = new Date()): void {
    const existing = this.map.get(key);
    // Never go backwards — guards against out-of-order updateStatus calls
    if (!existing || date > existing) {
      this.map.set(key, date);
    }
  }

  get(key: string): Date | undefined {
    return this.map.get(key);
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}
