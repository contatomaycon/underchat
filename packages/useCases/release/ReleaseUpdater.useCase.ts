import { injectable } from 'tsyringe';
import { ReleaseService } from '@core/services/release.service';
import { EditReleaseBodyRequest } from '@core/schema/release/editRelease/request.schema';

@injectable()
export class ReleaseUpdaterUseCase {
  constructor(private readonly releaseService: ReleaseService) {}

  async execute(
    releaseId: string,
    userId: string,
    input: EditReleaseBodyRequest
  ): Promise<true | 'not_found' | 'forbidden'> {
    return this.releaseService.updateRelease(releaseId, userId, input);
  }
}
