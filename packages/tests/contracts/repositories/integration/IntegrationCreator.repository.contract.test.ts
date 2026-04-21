import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { IntegrationCreatorRepository } from '@core/repositories/integration/IntegrationCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

jest.mock('node:crypto', () => ({
  randomBytes: jest.fn(),
}));

describe('IntegrationCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates integration and returns api key id', async () => {
    const { db, values, execute } = createInsertDbMock({ rowCount: 1 });
    const repository = new IntegrationCreatorRepository(db as never);

    const uuidMock = uuidv7 as unknown as jest.Mock;
    uuidMock.mockReturnValue('api-key-id-1');

    const randomBytesMock = randomBytes as unknown as jest.Mock;
    randomBytesMock.mockReturnValue({
      toString: jest.fn(() => 'hex-key'),
    } as never);

    await expect(
      repository.createIntegration('account-1', 'My integration', 'worker-1')
    ).resolves.toBe('api-key-id-1');

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        api_key_id: 'api-key-id-1',
        account_id: 'account-1',
        worker_id: 'worker-1',
        key: 'hex-key',
        name: 'My integration',
      })
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns null when insert execution has no result', async () => {
    const { db } = createInsertDbMock(undefined);
    const repository = new IntegrationCreatorRepository(db as never);

    const uuidMock = uuidv7 as unknown as jest.Mock;
    uuidMock.mockReturnValue('api-key-id-2');

    const randomBytesMock = randomBytes as unknown as jest.Mock;
    randomBytesMock.mockReturnValue({
      toString: jest.fn(() => 'hex-key-2'),
    } as never);

    await expect(
      repository.createIntegration('account-1', 'Integration B', 'worker-2')
    ).resolves.toBeNull();
  });
});
