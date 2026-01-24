import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ReleaseService } from '@core/services/release.service';

@injectable()
export class ReleaseDeleterUseCase {
  constructor(private readonly releaseService: ReleaseService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    releaseId: string,
    userId: string
  ): Promise<true | 'not_found' | 'forbidden'> {
    return this.releaseService.deleteRelease(releaseId, userId);
  }
}
