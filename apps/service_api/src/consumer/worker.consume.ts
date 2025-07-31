import { container } from 'tsyringe';
import { WorkerConnectionConsume } from '@core/consumer/worker/WorkerConnection.consume';

export default async function workerConsume() {
  const workerConnectionConsume = container.resolve(WorkerConnectionConsume);

  await workerConnectionConsume.execute();
}
