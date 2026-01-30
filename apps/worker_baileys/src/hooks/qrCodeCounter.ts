export class QrCodeCounter {
  private static count = 0;
  private static readonly maxGenerations = 5;

  static increment(): number {
    this.count++;
    return this.count;
  }

  static getCount(): number {
    return this.count;
  }

  static hasReachedLimit(): boolean {
    return this.count >= this.maxGenerations;
  }

  static reset(): void {
    this.count = 0;
  }

  static getMaxGenerations(): number {
    return this.maxGenerations;
  }
}
