import 'reflect-metadata';
import { ApiService } from '@core/services/api.service';

describe('ApiService', () => {
  it('delegates jwt and api key lookups', async () => {
    const findByJwt = jest.fn(async () => ({ permission: true }));
    const findByKey = jest.fn(async () => ({ key: true }));
    const service = new ApiService(
      { find: findByJwt } as never,
      { find: findByKey } as never
    );

    await expect(
      service.findApiByJwt('u-1', 'mod' as never, 'mod' as never)
    ).resolves.toEqual({ permission: true });
    await expect(
      service.findApiByKeyApi('api-key', 'mod', 'mod' as never)
    ).resolves.toEqual({ key: true });
  });
});
