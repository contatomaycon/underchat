import { injectable, inject } from 'tsyringe';
import { ZipcodeService } from '@core/services/zipcode.service';
import { ListCitiesRequest } from '@core/schema/zipcode/listCities/request.schema';
import { CityListResponse } from '@core/schema/zipcode/listCities/response.schema';

@injectable()
export class ListCitiesUseCase {
  constructor(
    @inject(ZipcodeService)
    private readonly zipcodeService: ZipcodeService
  ) {}

  async execute(request: ListCitiesRequest): Promise<CityListResponse> {
    return this.zipcodeService.listCities(request);
  }
}
