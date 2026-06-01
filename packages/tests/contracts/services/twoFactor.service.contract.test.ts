import 'reflect-metadata';
import { TwoFactorService } from '@core/services/twoFactor.service';

describe('TwoFactorService', () => {
  it('delegates viewer and updater methods', async () => {
    const findTwoFactorByCode = jest.fn(async () => ({ id: '1' }));
    const findActiveValidationByCode = jest.fn(async () => ({ id: 'active' }));
    const findActiveValidationByCodeAndWorkerId = jest.fn(async () => ({
      id: 'active-worker',
    }));
    const findTwoFactorByCodeAndEmailPhone = jest.fn(async () => ({ id: '2' }));
    const findTwoFactorByTokenAndEmailPhone = jest.fn(async () => ({
      id: '3',
    }));
    const updateDeletedAt = jest.fn(async () => undefined);
    const updateValidatedAt = jest.fn(async () => undefined);

    const service = new TwoFactorService(
      {
        findTwoFactorByCode,
        findActiveValidationByCode,
        findActiveValidationByCodeAndWorkerId,
        findTwoFactorByCodeAndEmailPhone,
        findTwoFactorByTokenAndEmailPhone,
      } as never,
      { updateDeletedAt, updateValidatedAt } as never
    );

    await expect(service.findTwoFactorByCode('111111')).resolves.toEqual({
      id: '1',
    });
    await expect(service.findActiveValidationByCode('111111')).resolves.toEqual(
      {
        id: 'active',
      }
    );
    await expect(
      service.findActiveValidationByCodeAndWorkerId('111111', 'worker-1')
    ).resolves.toEqual({
      id: 'active-worker',
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
    await expect(
      service.updateValidatedAt('tf1', '2026-01-01')
    ).resolves.toBeUndefined();
    expect(findActiveValidationByCodeAndWorkerId).toHaveBeenCalledWith(
      '111111',
      'worker-1'
    );
  });
});
