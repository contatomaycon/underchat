import { injectable, inject } from 'tsyringe';
import {
  WwebjsHelpersService,
  type WwebjsProviderInvocationBoundary,
} from './helpers.service';

@injectable()
export class WwebjsProfileService {
  constructor(
    @inject(WwebjsHelpersService)
    private readonly helpers: WwebjsHelpersService
  ) {}

  async updateProfileName(
    name: string,
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<void> {
    await this.helpers.updateProfileName(name, beforeProviderInvoke);
  }

  async updateProfileStatus(
    status: string,
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<void> {
    await this.helpers.updateProfileStatus(status, beforeProviderInvoke);
  }

  async updateProfilePicture(
    photoUrl: string,
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<void> {
    await this.helpers.updateProfilePicture(photoUrl, beforeProviderInvoke);
  }

  async removeProfilePicture(
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<void> {
    await this.helpers.removeProfilePicture(beforeProviderInvoke);
  }
}
