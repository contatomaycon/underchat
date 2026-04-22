import 'reflect-metadata';

jest.mock('@core/services/zipcode.service', () => ({
  ZipcodeService: class {},
}));

import { ListStatesUseCase } from '@core/useCases/zipcode/ListStates.useCase';

describe('ListStatesUseCase', () => {
  it('delegates states listing to zipcode service', async () => {
    const response = [{ state_id: 'SP', name: 'Sao Paulo' }];
    const zipcodeService = {
      listStates: jest.fn(async () => response),
    };
    const useCase = new ListStatesUseCase(zipcodeService as never);
    const request = { country_id: 55 } as never;

    await expect(useCase.execute(request)).resolves.toEqual(response);
    expect(zipcodeService.listStates).toHaveBeenCalledWith(request);
  });
});
