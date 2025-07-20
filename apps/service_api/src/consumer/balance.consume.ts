import { container } from 'tsyringe';
import { BalanceCreatorConsume } from '@core/consumer/balance/BalanceCreator.consume';

export default async function balanceConsume() {
  const balanceCreatorConsume = container.resolve(BalanceCreatorConsume);

  await balanceCreatorConsume.execute();
}
