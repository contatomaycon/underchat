import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { ApiKeyCreatorRepository } from '@core/repositories/apiKey/ApiKeyCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

jest.mock('node:crypto', () => ({
  randomBytes: jest.fn(),
}));

describe('ApiKeyCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates api key and returns generated id', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new ApiKeyCreatorRepository(db as never);
    const uuidMock = uuidv7 as unknown as jest.Mock;
    uuidMock.mockReturnValue('api-key-id-1');
    const randomBytesMock = randomBytes as unknown as jest.Mock;
    randomBytesMock.mockReturnValue({
      toString: jest.fn(() => 'hex-key-1'),
    });

    await expect(
      repository.createApiKey('acc-1', 'Integration A')
    ).resolves.toBe('api-key-id-1');

    expect(values).toHaveBeenCalledWith({
      api_key_id: 'api-key-id-1',
      account_id: 'acc-1',
      key: 'hex-key-1',
      name: 'Integration A',
    });
  });

  it('returns null when insert fails', async () => {
    const { db } = createInsertDbMock(undefined);
    const repository = new ApiKeyCreatorRepository(db as never);
    const uuidMock = uuidv7 as unknown as jest.Mock;
    uuidMock.mockReturnValue('api-key-id-2');
    const randomBytesMock = randomBytes as unknown as jest.Mock;
    randomBytesMock.mockReturnValue({
      toString: jest.fn(() => 'hex-key-2'),
    });

    await expect(
      repository.createApiKey('acc-1', 'Integration B')
    ).resolves.toBeNull();
  });
});
