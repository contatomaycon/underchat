import { injectable, inject } from 'tsyringe';
import { BaileysHelpersService } from './helpers.service';

@injectable()
export class BaileysProfileService {
  constructor(
    @inject(BaileysHelpersService)
    private readonly baileysHelpersService: BaileysHelpersService
  ) {}

  async updateProfileName(
    name: string,
    beforeProviderInvoke?: () => Promise<void>
  ): Promise<void> {
    if (beforeProviderInvoke) {
      await this.baileysHelpersService.updateProfileName(
        name,
        beforeProviderInvoke
      );
      return;
    }
    await this.baileysHelpersService.updateProfileName(name);
  }

  async updateProfileStatus(
    status: string,
    beforeProviderInvoke?: () => Promise<void>
  ): Promise<void> {
    if (beforeProviderInvoke) {
      await this.baileysHelpersService.updateProfileStatus(
        status,
        beforeProviderInvoke
      );
      return;
    }
    await this.baileysHelpersService.updateProfileStatus(status);
  }

  async updateProfilePicture(
    photoUrl: string,
    beforeProviderInvoke?: () => Promise<void>
  ): Promise<void> {
    if (beforeProviderInvoke) {
      await this.baileysHelpersService.updateProfilePicture(
        photoUrl,
        beforeProviderInvoke
      );
      return;
    }
    await this.baileysHelpersService.updateProfilePicture(photoUrl);
  }

  async removeProfilePicture(
    beforeProviderInvoke?: () => Promise<void>
  ): Promise<void> {
    const jid = this.baileysHelpersService.getOwnJid();
    if (beforeProviderInvoke) {
      await this.baileysHelpersService.removeProfilePicture(
        jid,
        beforeProviderInvoke
      );
      return;
    }
    await this.baileysHelpersService.removeProfilePicture(jid);
  }
}
