import 'reflect-metadata';
import { TwoFactorService } from '@core/services/twoFactor.service';

describe('TwoFactorService', () => {
  it('delegates viewer and updater methods', async () => {
    const findTwoFactorByCode = jest.fn(async () => ({ id: '1' }));
    const findTwoFactorByCodeAndEmailPhone = jest.fn(async () => ({ id: '2' }));
    const findTwoFactorByTokenAndEmailPhone = jest.fn(async () => ({
      id: '3',
    }));
    const updateDeletedAt = jest.fn(async () => undefined);

    const service = new TwoFactorService(
      {
        findTwoFactorByCode,
        findTwoFactorByCodeAndEmailPhone,
        findTwoFactorByTokenAndEmailPhone,
      } as never,
      { updateDeletedAt } as never
    );

    await expect(service.findTwoFactorByCode('111111')).resolves.toEqual({
      id: '1',
    });
    await expect(
      service.findTwoFactorByCodeAndEmailPhone({ code: '1' } as never)
    ).resolves.toEqual({ id: '2' });
    await expect(
      service.findTwoFactorByTokenAndEmailPhone({ token: 't' } as never)
    ).resolves.toEqual({ id: '3' });
    await expect(
      service.updateDeletedAt('tf1', '2026-01-01')
    ).resolves.toBeUndefined();
  });
});
