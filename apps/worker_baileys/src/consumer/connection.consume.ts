import { container } from 'tsyringe';
import { ConnectionStatusConsume } from '@core/consumer/worker/ConnectionStatus.consume';

export default async function connectionConsume() {
  const connectionStatusConsume = container.resolve(ConnectionStatusConsume);

  await connectionStatusConsume.execute();
}
