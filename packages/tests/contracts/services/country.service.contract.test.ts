import 'reflect-metadata';
import { CountryService } from '@core/services/country.service';

describe('CountryService', () => {
  it('delegates existsCountryById to repository', async () => {
    const existsCountryById = jest.fn(async () => true);
    const service = new CountryService({ existsCountryById } as never);

    await expect(service.existsCountryById(55)).resolves.toBe(true);
    expect(existsCountryById).toHaveBeenCalledWith(55);
  });
});
