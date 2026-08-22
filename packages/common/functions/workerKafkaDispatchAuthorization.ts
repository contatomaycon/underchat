type WorkerKafkaDispatchAuthorizationListener = (authorized: boolean) => void;

let authorized = false;
let generation = 0;
const listeners = new Set<WorkerKafkaDispatchAuthorizationListener>();

export interface IWorkerKafkaDispatchAuthorizationState {
  authorized: boolean;
  generation: number;
}

export function isWorkerKafkaDispatchAuthorized(): boolean {
  return authorized;
}

export function getWorkerKafkaDispatchAuthorizationState(): IWorkerKafkaDispatchAuthorizationState {
  return { authorized, generation };
}

export function setWorkerKafkaDispatchAuthorized(value: boolean): void {
  if (authorized === value) {
    return;
  }

  authorized = value;
  generation += 1;
  for (const listener of listeners) {
    try {
      listener(value);
    } catch {}
  }
}

export function subscribeWorkerKafkaDispatchAuthorization(
  listener: WorkerKafkaDispatchAuthorizationListener
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
