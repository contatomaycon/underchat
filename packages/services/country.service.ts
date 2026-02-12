import { injectable, inject } from 'tsyringe';
import { CountryViewerExistsRepository } from '@core/repositories/country/CountryViewerExists.repository';

@injectable()
export class CountryService {
  constructor(
    @inject(CountryViewerExistsRepository)
    private readonly CountryViewerExistsRepository: CountryViewerExistsRepository
  ) {}

  existsCountryById = async (countryId: number): Promise<boolean> => {
    return this.CountryViewerExistsRepository.existsCountryById(countryId);
  };
}
