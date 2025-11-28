import { singleton } from 'tsyringe';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { PresenceService } from '@core/services/presence.service';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { IPresenceMessage } from '@core/common/interfaces/IPresenceMessage';
import { UserAccountViewerRepository } from '@core/repositories/user/UserAccountViewer.repository';

@singleton()
export class PresenceCentrifugoConsume {
  private isRunning = false;

  constructor(
    private readonly centrifugoService: CentrifugoService,
    private readonly presenceService: PresenceService,
    private readonly userAccountViewerRepository: UserAccountViewerRepository
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;

    const channel = 'presence:updates';

    try {
      await this.centrifugoService.onMessage(channel, async (data: unknown) => {
        await this.handlePresenceMessage(data);
      });
    } catch (error) {
      console.error('Failed to subscribe to presence channel', error);
      this.isRunning = false;
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }

  private async handlePresenceMessage(data: unknown): Promise<void> {
    try {
      if (!data || typeof data !== 'object') return;

      const message = data as IPresenceMessage;

      if (
        message.event !== 'presence_update' ||
        !message.user_id ||
        !message.status
      ) {
        return;
      }

      const accountId = await this.userAccountViewerRepository.getUserAccountId(
        message.user_id
      );

      if (!accountId) {
        console.warn(
          `Invalid user_id in presence message: ${message.user_id} - user does not exist or was deleted`
        );
        return;
      }

      const validStatuses = [
        EChatUserStatus.online,
        EChatUserStatus.away,
        EChatUserStatus.busy,
        EChatUserStatus.do_not_disturb,
        EChatUserStatus.offline,
      ];

      if (!validStatuses.includes(message.status)) {
        return;
      }

      if (message.is_heartbeat) {
        await this.presenceService.heartbeat(message.user_id);
      } else {
        switch (message.status) {
          case EChatUserStatus.online:
            await this.presenceService.setUserOnline(message.user_id);
            break;
          case EChatUserStatus.away:
            await this.presenceService.setUserAway(message.user_id);
            break;
          case EChatUserStatus.busy:
            await this.presenceService.setUserBusy(message.user_id);
            break;
          case EChatUserStatus.do_not_disturb:
            await this.presenceService.setUserDoNotDisturb(message.user_id);
            break;
          case EChatUserStatus.offline:
            await this.presenceService.setUserOffline(message.user_id);
            break;
        }
      }
    } catch (error) {
      console.error('Failed to handle presence message', error);
    }
  }
}
