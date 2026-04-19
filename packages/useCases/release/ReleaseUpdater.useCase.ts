import { injectable, inject } from 'tsyringe';
import { ReleaseService } from '@core/services/release.service';
import { EditReleaseBodyRequest } from '@core/schema/release/editRelease/request.schema';

@injectable()
export class ReleaseUpdaterUseCase {
  constructor(
    @inject(ReleaseService)
    private readonly releaseService: ReleaseService
  ) {}

  async execute(
    releaseId: string,
    userId: string,
    input: EditReleaseBodyRequest
  ): Promise<true | 'not_found' | 'forbidden' | 'invalid_reminder'> {
    return this.releaseService.updateRelease(releaseId, userId, input);
  }
}
