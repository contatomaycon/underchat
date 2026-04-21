import 'reflect-metadata';
import { ApiKeyService } from '@core/services/apiKey.service';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mocked-uuid'),
}));

describe('ApiKeyService', () => {
  it('creates and deletes api key via repositories', async () => {
    const createApiKey = jest.fn(async () => 'key-1');
    const deleteApiKeyById = jest.fn(async () => true);
    const service = new ApiKeyService(
      { createApiKey } as never,
      { deleteApiKeyById } as never
    );

    await expect(service.createApiKey('a-1', 'Main')).resolves.toBe('key-1');
    await expect(service.deleteApiKey('a-1')).resolves.toBe(true);
  });
});
