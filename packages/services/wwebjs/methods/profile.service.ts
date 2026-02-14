import { injectable, inject } from 'tsyringe';
import { WwebjsHelpersService } from './helpers.service';

@injectable()
export class WwebjsProfileService {
  constructor(
    @inject(WwebjsHelpersService)
    private readonly helpers: WwebjsHelpersService
  ) {}

  async updateProfileName(name: string): Promise<void> {
    await this.helpers.updateProfileName(name);
  }

  async updateProfileStatus(status: string): Promise<void> {
    await this.helpers.updateProfileStatus(status);
  }

  async updateProfilePicture(photoUrl: string): Promise<void> {
    await this.helpers.updateProfilePicture(photoUrl);
  }

  async removeProfilePicture(): Promise<void> {
    await this.helpers.removeProfilePicture();
  }
}
