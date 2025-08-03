import { container } from 'tsyringe';
import { WorkerConsume } from '@core/consumer/worker/Worker.consume';

export default async function workerConsume() {
  const workerConsume = container.resolve(WorkerConsume);

  await workerConsume.execute();
}
