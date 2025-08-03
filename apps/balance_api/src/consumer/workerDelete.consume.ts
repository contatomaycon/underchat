import { container } from 'tsyringe';
import { WorkerDeleterConsume } from '@core/consumer/worker/WorkerDeleter.consume';

export default async function workerDeleteConsume() {
  const workerDeleterConsume = container.resolve(WorkerDeleterConsume);

  await workerDeleterConsume.execute();
}
