import { injectable } from 'tsyringe';
import { BaileysHelpersService } from './helpers.service';

@injectable()
export class BaileysProfileService {
  constructor(private readonly baileysHelpersService: BaileysHelpersService) {}

  async updateProfileName(name: string): Promise<void> {
    await this.baileysHelpersService.updateProfileName(name);
  }

  async updateProfileStatus(status: string): Promise<void> {
    await this.baileysHelpersService.updateProfileStatus(status);
  }

  async updateProfilePicture(photoUrl: string): Promise<void> {
    await this.baileysHelpersService.updateProfilePicture(photoUrl);
  }
}
