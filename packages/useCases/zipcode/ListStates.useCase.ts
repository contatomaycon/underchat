import { injectable, inject } from 'tsyringe';
import { ZipcodeService } from '@core/services/zipcode.service';
import { ListStatesRequest } from '@core/schema/zipcode/listStates/request.schema';
import { StateListResponse } from '@core/schema/zipcode/listStates/response.schema';

@injectable()
export class ListStatesUseCase {
  constructor(
    @inject(ZipcodeService)
    private readonly zipcodeService: ZipcodeService
  ) {}

  async execute(request: ListStatesRequest): Promise<StateListResponse> {
    return this.zipcodeService.listStates(request);
  }
}
