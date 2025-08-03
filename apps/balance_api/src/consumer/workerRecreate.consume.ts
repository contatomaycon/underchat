import { container } from 'tsyringe';
import { WorkerRecreateConsume } from '@core/consumer/worker/WorkerRecreate.consume';

export default async function workerRecreateConsume() {
  const workerRecreateConsume = container.resolve(WorkerRecreateConsume);

  await workerRecreateConsume.execute();
}
