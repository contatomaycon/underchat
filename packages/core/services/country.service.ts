import { injectable } from 'tsyringe';
import { CountryViewerExistsRepository } from '@core/repositories/country/CountryViewerExists.repository';

@injectable()
export class CountryService {
  constructor(
    private readonly CountryViewerExistsRepository: CountryViewerExistsRepository
  ) {}

  existsCountryById = async (countryId: number): Promise<boolean> => {
    return this.CountryViewerExistsRepository.existsCountryById(countryId);
  };
}
