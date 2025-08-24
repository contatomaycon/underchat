import { delay } from './delay';

export function startHeartbeat(heartbeat: () => Promise<void>): () => void {
  let active = true;

  (async () => {
    while (active) {
      try {
        await heartbeat();
      } catch {}

      await delay(3000);
    }
  })();

  return () => {
    active = false;
  };
}
