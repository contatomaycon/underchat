import 'reflect-metadata';
import { IntegrationAvailableChannelsListerRepository } from '@core/repositories/integration/IntegrationAvailableChannelsLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('IntegrationAvailableChannelsListerRepository', () => {
  it('returns mapped channels', async () => {
    const { db } = createSelectDbMock([
      { id: 'worker-1', name: 'Channel A', number: '551199' },
      { id: 'worker-2', name: 'Channel B', number: '551188' },
    ]);
    const repository = new IntegrationAvailableChannelsListerRepository(
      db as never
    );

    await expect(repository.listAvailableChannels('acc-1')).resolves.toEqual([
      { id: 'worker-1', name: 'Channel A', number: '551199' },
      { id: 'worker-2', name: 'Channel B', number: '551188' },
    ]);
  });

  it('returns empty array when no channels are found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new IntegrationAvailableChannelsListerRepository(
      db as never
    );

    await expect(repository.listAvailableChannels('acc-1')).resolves.toEqual(
      []
    );
  });
});
