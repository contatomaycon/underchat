import { container } from 'tsyringe';
import { WorkerCreateConsume } from '@core/consumer/worker/WorkerCreate.consume';

export default async function workerCreateConsume() {
  const workerCreateConsume = container.resolve(WorkerCreateConsume);

  await workerCreateConsume.execute();
}
