import { injectable } from 'tsyringe';
import { NotificationMessageViewerRepository } from '@core/repositories/notifications/NotificationMessageViewer.repository';
import { UserMasterViewerRepository } from '@core/repositories/user/UserMasterViewer.repository';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { notificationMappings } from '@core/mappings/notification.mappings';
import { WorkerActiveByAccountViewerRepository } from '@core/repositories/worker/WorkerActiveByAccountViewer.repository';
import { UserService } from './user.service';
import { normalizePhoneToJid } from '@core/common/functions/normalizePhoneToJid';
import { UserInfoViewerRepository } from '@core/repositories/user/UserInfoViewer.repository';
import { WorkerNameViewerRepository } from '@core/repositories/worker/WorkerNameViewer.repository';
import { INotificationMessage } from '@core/common/interfaces/INotificationMessage';

@injectable()
export class NotificationMessageService {
  constructor(
    private readonly notificationMessageViewerRepository: NotificationMessageViewerRepository,
    private readonly userMasterViewerRepository: UserMasterViewerRepository,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly workerActiveByAccountViewerRepository: WorkerActiveByAccountViewerRepository,
    private readonly userService: UserService,
    private readonly userInfoViewerRepository: UserInfoViewerRepository,
    private readonly workerNameViewerRepository: WorkerNameViewerRepository
  ) {}

  async sendNotificationMessage(
    notificationId: string,
    accountId: string
  ): Promise<boolean> {
    const notification =
      await this.notificationMessageViewerRepository.findNotificationById(
        notificationId
      );

    if (!notification) {
      throw new Error('Notification not found');
    }

    const masterUser =
      await this.userMasterViewerRepository.findMasterUserByAccountId(
        accountId
      );

    if (!masterUser) {
      throw new Error('Master user not found for account');
    }

    const userInfo = await this.userInfoViewerRepository.findUserInfoByUserId(
      masterUser.user_id
    );
    if (!userInfo) {
      throw new Error('User info not found');
    }

    const phone = this.userService.getUserPhoneDecrypted(userInfo.phone);
    if (!phone) {
      throw new Error('User phone not found');
    }

    const workerId =
      notification.worker_id || (await this.getFirstActiveWorkerId(accountId));
    if (!workerId) {
      throw new Error('No active worker found for account');
    }

    const workerName =
      await this.workerNameViewerRepository.findWorkerNameById(workerId);
    if (!workerName) {
      throw new Error('Worker not found');
    }

    const fullName = userInfo.name || userInfo.last_name || null;
    const remoteJid = normalizePhoneToJid(phone, userInfo.phone_ddi) || null;

    const notificationMessage: INotificationMessage = {
      id: notification.notification_id,
      notification_id: notification.notification_id,
      message_key: {
        remote_jid: remoteJid,
      },
      account: {
        id: accountId,
        name: masterUser.account_name,
      },
      worker: {
        id: workerId,
        name: workerName || null,
      },
      notification_type: {
        id: notification.notification_type_id,
        name: notification.nnt?.name || '',
      },
      message: notification.message,
      name: fullName,
      phone: phone,
      date: new Date().toISOString(),
    };

    console.log('notificationMessage');
    console.dir(notificationMessage, { depth: null, colors: true });

    await this.elasticDatabaseService.indices(
      EElasticIndex.notification,
      notificationMappings()
    );

    await this.elasticDatabaseService.update(
      EElasticIndex.notification,
      notificationMessage,
      notification.notification_id
    );

    const kafkaTopic =
      this.kafkaBaileysQueueService.workerSendMessage(workerId);
    await this.streamProducerService.send(kafkaTopic, notificationMessage);

    return true;
  }

  private async getFirstActiveWorkerId(
    accountId: string
  ): Promise<string | null> {
    const workers =
      await this.workerActiveByAccountViewerRepository.viewWorkerActiveByAccount(
        accountId
      );

    if (!workers || workers.length === 0) {
      return null;
    }

    return workers[0].worker_id;
  }
}
