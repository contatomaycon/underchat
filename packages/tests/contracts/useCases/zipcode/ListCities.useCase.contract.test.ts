import 'reflect-metadata';

jest.mock('@core/services/zipcode.service', () => ({
  ZipcodeService: class {},
}));

import { ListCitiesUseCase } from '@core/useCases/zipcode/ListCities.useCase';

describe('ListCitiesUseCase', () => {
  it('delegates cities listing to zipcode service', async () => {
    const response = [{ city_id: '1', name: 'Sao Paulo' }];
    const zipcodeService = {
      listCities: jest.fn(async () => response),
    };
    const useCase = new ListCitiesUseCase(zipcodeService as never);
    const request = { state_id: 'SP' } as never;

    await expect(useCase.execute(request)).resolves.toEqual(response);
    expect(zipcodeService.listCities).toHaveBeenCalledWith(request);
  });
});
