import 'reflect-metadata';

jest.mock('@core/services/zipcode.service', () => ({
  ZipcodeService: class {},
}));

import { ZipcodeViewerUseCase } from '@core/useCases/zipcode/ZipcodeViewer.useCase';

describe('ZipcodeViewerUseCase', () => {
  it('returns zipcode from local service when it exists', async () => {
    const zipcode = { zipcode: '01001000', city: 'Sao Paulo' };
    const zipcodeService = {
      viewZipcode: jest.fn(async () => zipcode),
      searchZipCodeApi: jest.fn(),
    };
    const useCase = new ZipcodeViewerUseCase(zipcodeService as never);

    await expect(
      useCase.execute({ zipcode: '01001000' } as never)
    ).resolves.toEqual(zipcode);
    expect(zipcodeService.searchZipCodeApi).not.toHaveBeenCalled();
  });

  it('uses external api when zipcode is not found locally', async () => {
    const apiZipcode = { zipcode: '01001000', city: 'Sao Paulo' };
    const zipcodeService = {
      viewZipcode: jest.fn(async () => null),
      searchZipCodeApi: jest.fn(async () => apiZipcode),
    };
    const useCase = new ZipcodeViewerUseCase(zipcodeService as never);

    await expect(
      useCase.execute({ zipcode: '01001000' } as never)
    ).resolves.toEqual(apiZipcode);
    expect(zipcodeService.searchZipCodeApi).toHaveBeenCalledWith('01001000');
  });
});
