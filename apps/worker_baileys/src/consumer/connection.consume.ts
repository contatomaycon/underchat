import { container } from 'tsyringe';
import { WorkerConnectionStatusConsume } from '@core/consumer/worker/WorkerConnectionStatus.consume';

export default async function connectionConsume() {
  const workerConnectionStatusConsume = container.resolve(
    WorkerConnectionStatusConsume
  );

  await workerConnectionStatusConsume.execute();
}
