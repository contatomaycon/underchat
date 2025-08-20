import { injectable } from 'tsyringe';
import { ZipcodeResponseSchema } from '@core/schema/zipcode/viewZipcode/response.schema';
import { ZipcodeService } from '@core/services/zipcode.service';
import { ViewZipcodeRequest } from '@core/schema/zipcode/viewZipcode/request.schema';

@injectable()
export class ZipcodeViewerUseCase {
  constructor(private readonly zipcodeService: ZipcodeService) {}

  async execute(
    request: ViewZipcodeRequest
  ): Promise<ZipcodeResponseSchema | null> {
    const response = await this.zipcodeService.viewZipcode(request);

    if (!response) {
      const zipcodeResponse = await this.zipcodeService.searchZipCodeApi(
        request.zipcode
      );

      return zipcodeResponse;
    }

    return response;
  }
}
