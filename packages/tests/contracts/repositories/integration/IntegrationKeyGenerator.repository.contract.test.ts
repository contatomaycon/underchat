import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { currentTime } from '@core/common/functions/currentTime';
import { IntegrationKeyGeneratorRepository } from '@core/repositories/integration/IntegrationKeyGenerator.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('node:crypto', () => ({
  randomBytes: jest.fn(),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('IntegrationKeyGeneratorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns generated key when update affects one row', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new IntegrationKeyGeneratorRepository(db as never);
    const randomBytesMock = randomBytes as unknown as jest.Mock;
    randomBytesMock.mockReturnValue({
      toString: jest.fn(() => 'new-key-1'),
    });
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T21:10:00.000Z');

    await expect(repository.generateNewKey('acc-1', 'api-key-1')).resolves.toBe(
      'new-key-1'
    );
    expect(set).toHaveBeenCalledWith({
      key: 'new-key-1',
      updated_at: '2026-04-21T21:10:00.000Z',
    });
  });

  it('returns null when update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new IntegrationKeyGeneratorRepository(db as never);
    const randomBytesMock = randomBytes as unknown as jest.Mock;
    randomBytesMock.mockReturnValue({
      toString: jest.fn(() => 'new-key-2'),
    });
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T21:11:00.000Z');

    await expect(
      repository.generateNewKey('acc-1', 'api-key-1')
    ).resolves.toBeNull();
  });
});
