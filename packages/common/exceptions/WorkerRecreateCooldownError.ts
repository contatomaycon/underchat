export class WorkerRecreateCooldownError extends Error {
  constructor(
    message: string,
    public readonly recreateAvailableAt: string | null
  ) {
    super(message);
    this.name = 'WorkerRecreateCooldownError';
  }
}
