import 'reflect-metadata';
import { ZipcodeViewRepository } from '@core/repositories/zipcode/ZipcodeView.repository';

describe('ZipcodeViewRepository', () => {
  it('returns null when zipcode is not found', async () => {
    const repository = new ZipcodeViewRepository({
      query: {
        zipcode: {
          findFirst: jest.fn(async () => null),
        },
      },
    } as never);

    await expect(
      repository.zipcodeView({ zipcode: '01001000', country_id: 1 } as never)
    ).resolves.toBeNull();
  });

  it('maps zipcode with district/city/state fallback to null', async () => {
    const repository = new ZipcodeViewRepository({
      query: {
        zipcode: {
          findFirst: jest.fn(async () => ({
            zipcode: '01001000',
            address_1: 'Praça da Sé',
            address_2: null,
            zcd: null,
            zcz: { city: 'São Paulo' },
            zcs: null,
          })),
        },
      },
    } as never);

    await expect(
      repository.zipcodeView({ zipcode: '01001000', country_id: 1 } as never)
    ).resolves.toEqual({
      zipcode: '01001000',
      address_1: 'Praça da Sé',
      address_2: null,
      district: null,
      city: 'São Paulo',
      state: null,
    });
  });
});
