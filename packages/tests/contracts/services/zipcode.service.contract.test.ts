import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
  },
}));

import axios from 'axios';
import { ZipcodeService } from '@core/services/zipcode.service';

describe('ZipcodeService', () => {
  it('maps ViaCep response when successful', async () => {
    const get = jest.fn(async () => ({
      status: 200,
      data: {
        cep: '01.234-567',
        logradouro: 'Rua A',
        complemento: 'Sala 1',
        bairro: 'Centro',
        localidade: 'Sao Paulo',
        uf: 'SP',
      },
    }));

    (axios.create as jest.Mock).mockReturnValue({ get });

    const service = new ZipcodeService(
      { zipcodeView: jest.fn() } as never,
      { listStates: jest.fn() } as never,
      { listCities: jest.fn() } as never
    );

    await expect(service.searchZipCodeApi('01234-567')).resolves.toEqual({
      zipcode: '01234567',
      address_1: 'Rua A',
      address_2: 'Sala 1',
      district: 'Centro',
      city: 'Sao Paulo',
      state: 'SP',
    });
    expect(get).toHaveBeenCalledWith('/ws/01234-567/json/');
  });

  it('returns null when via cep returns erro flag', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      get: jest.fn(async () => ({ status: 200, data: { erro: true } })),
    });

    const service = new ZipcodeService(
      { zipcodeView: jest.fn() } as never,
      { listStates: jest.fn() } as never,
      { listCities: jest.fn() } as never
    );

    await expect(service.searchZipCodeApi('00000-000')).resolves.toBeNull();
  });

  it('delegates local repositories', async () => {
    const zipcodeView = jest.fn(async () => ({ zipcode: '1' }));
    const listStates = jest.fn(async () => [{ state: 'SP' }]);
    const listCities = jest.fn(async () => [{ city: 'Sao Paulo' }]);

    const service = new ZipcodeService(
      { zipcodeView } as never,
      { listStates } as never,
      { listCities } as never
    );

    await expect(
      service.viewZipcode({ zipcode: '1' } as never)
    ).resolves.toEqual({
      zipcode: '1',
    });
    await expect(service.listStates({} as never)).resolves.toEqual([
      { state: 'SP' },
    ]);
    await expect(service.listCities({} as never)).resolves.toEqual([
      { city: 'Sao Paulo' },
    ]);
  });
});
