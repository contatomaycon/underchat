import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { currentTime } from '@core/common/functions/currentTime';
import { ApiKeyKeyGeneratorRepository } from '@core/repositories/apiKey/ApiKeyKeyGenerator.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('node:crypto', () => ({
  randomBytes: jest.fn(),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('ApiKeyKeyGeneratorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns generated key when one row is updated', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new ApiKeyKeyGeneratorRepository(db as never);
    const randomBytesMock = randomBytes as unknown as jest.Mock;
    randomBytesMock.mockReturnValue({
      toString: jest.fn(() => 'generated-key-1'),
    });
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T17:00:00.000Z');

    await expect(repository.generateNewKey('acc-1')).resolves.toBe(
      'generated-key-1'
    );
    expect(set).toHaveBeenCalledWith({
      key: 'generated-key-1',
      updated_at: '2026-04-21T17:00:00.000Z',
    });
  });

  it('returns null when no rows are updated', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new ApiKeyKeyGeneratorRepository(db as never);
    const randomBytesMock = randomBytes as unknown as jest.Mock;
    randomBytesMock.mockReturnValue({
      toString: jest.fn(() => 'generated-key-2'),
    });
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T17:15:00.000Z');

    await expect(repository.generateNewKey('acc-1')).resolves.toBeNull();
  });
});
