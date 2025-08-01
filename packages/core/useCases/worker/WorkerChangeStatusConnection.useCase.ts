import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { IUpdateWorkerPhoneConnection } from '@core/common/interfaces/IUpdateWorkerPhoneConnection';
import { ICreateWorkerPhoneConnection } from '@core/common/interfaces/ICreateWorkerPhoneConnection';
import moment from 'moment';
import { currentTime } from '@core/common/functions/currentTime';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';

@injectable()
export class WorkerChangeStatusConnectionUseCase {
  constructor(
    private readonly workerService: WorkerService,
    private readonly streamProducerService: StreamProducerService,
    private readonly centrifugoService: CentrifugoService
  ) {}

  private readonly MAX_ATTEMPTS = 3;
  private readonly WINDOW_MINUTES = 30;

  private cleanPhoneNumber(phone?: string): string {
    return phone ? phone.replace(/\D/g, '') : '';
  }

  private isWindowExpired(firstAttemptDate: string): boolean {
    const firstAttempt = moment(firstAttemptDate);
    return (
      !firstAttempt.isValid() ||
      moment().diff(firstAttempt, 'minutes') > this.WINDOW_MINUTES
    );
  }

  private secondsUntilWindowExpires(firstAttemptDate: string): number {
    const firstAttempt = moment(firstAttemptDate);
    const elapsedSeconds = moment().diff(firstAttempt, 'seconds');

    const windowSeconds = this.WINDOW_MINUTES * 60;
    const remaining = windowSeconds - elapsedSeconds;

    return remaining > 0 ? remaining : 0;
  }

  private async createPhoneConnectionRecord(
    workerId: string,
    number: string
  ): Promise<void> {
    const payload: ICreateWorkerPhoneConnection = {
      worker_id: workerId,
      number,
      attempt: 1,
    };

    await this.workerService.createWorkerPhoneConnection(payload);
  }

  private async resetPhoneConnectionRecord(
    record: { worker_phone_connection_id: string },
    workerId: string,
    number: string
  ): Promise<void> {
    const payload: IUpdateWorkerPhoneConnection = {
      worker_phone_connection_id: record.worker_phone_connection_id,
      worker_id: workerId,
      number,
      attempt: 1,
      attempt_date: currentTime(),
    };

    await this.workerService.updateWorkerPhoneConnection(payload);
  }

  private async incrementPhoneConnectionRecord(
    record: {
      worker_phone_connection_id: string;
      attempt: number;
      date_attempt: string;
    },
    workerId: string,
    number: string
  ): Promise<void> {
    const payload: IUpdateWorkerPhoneConnection = {
      worker_phone_connection_id: record.worker_phone_connection_id,
      worker_id: workerId,
      number,
      attempt: record.attempt + 1,
      attempt_date: record.date_attempt,
    };

    await this.workerService.updateWorkerPhoneConnection(payload);
  }

  async updatePhoneConnection(input: StatusConnectionWorkerRequest): Promise<{
    canProceed: boolean;
    secondsUntilNextAttempt: number;
  }> {
    if (!input?.phone_connection) {
      return {
        canProceed: false,
        secondsUntilNextAttempt: 0,
      };
    }

    const cleanPhone = this.cleanPhoneNumber(input.phone_connection);
    const record =
      await this.workerService.viewWorkerPhoneConnection(cleanPhone);

    if (!record) {
      await this.createPhoneConnectionRecord(input.worker_id, cleanPhone);

      return {
        canProceed: true,
        secondsUntilNextAttempt: 0,
      };
    }

    if (this.isWindowExpired(record.date_attempt)) {
      await this.resetPhoneConnectionRecord(
        record,
        input.worker_id,
        cleanPhone
      );

      return {
        canProceed: true,
        secondsUntilNextAttempt: 0,
      };
    }

    if (this.isWindowExpired(record.date_attempt)) {
      await this.resetPhoneConnectionRecord(
        record,
        input.worker_id,
        cleanPhone
      );

      return {
        canProceed: true,
        secondsUntilNextAttempt: 0,
      };
    }

    if (record.attempt >= this.MAX_ATTEMPTS) {
      return {
        canProceed: false,
        secondsUntilNextAttempt: this.secondsUntilWindowExpires(
          record.date_attempt
        ),
      };
    }

    await this.incrementPhoneConnectionRecord(
      record,
      input.worker_id,
      cleanPhone
    );

    return {
      canProceed: true,
      secondsUntilNextAttempt: 0,
    };
  }

  private async validate(
    t: TFunction<'translation', undefined>,
    input: StatusConnectionWorkerRequest,
    accountId: string,
    isAdministrator: boolean
  ) {
    const existsWorkerAccountById = await this.workerService.existsWorkerById(
      isAdministrator,
      accountId,
      input.worker_id
    );

    if (!existsWorkerAccountById) {
      throw new Error(t('worker_not_found'));
    }

    if (
      input.type === EBaileysConnectionType.phone &&
      !input.phone_connection
    ) {
      throw new Error(t('phone_connection_required'));
    }
  }

  private async onChangeConnectionStatus(
    t: TFunction<'translation', undefined>,
    input: StatusConnectionWorkerRequest
  ): Promise<void> {
    try {
      const cleanPhone = this.cleanPhoneNumber(input.phone_connection);
      const payload: StatusConnectionWorkerRequest = {
        worker_id: input.worker_id,
        status: input.status,
        type: input.type,
        phone_connection: cleanPhone,
      };

      await this.streamProducerService.send(
        `worker.${input.worker_id}.status`,
        payload,
        input.worker_id
      );
    } catch {
      throw new Error(t('kafka_error'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    input: StatusConnectionWorkerRequest
  ): Promise<boolean> {
    if (input.type === EBaileysConnectionType.phone) {
      const canPhoneConnection = await this.updatePhoneConnection(input);

      if (!canPhoneConnection.canProceed) {
        const payload: IBaileysConnectionState = {
          status: EBaileysConnectionStatus.initial,
          worker_id: input.worker_id,
          seconds_until_next_attempt:
            canPhoneConnection.secondsUntilNextAttempt,
          code: ECodeMessage.phoneNotAvailable,
        };

        this.centrifugoService.publish(
          `worker_${input.worker_id}_qrcode`,
          payload
        );

        return true;
      }
    }

    await this.validate(t, input, accountId, isAdministrator);
    await this.onChangeConnectionStatus(t, input);

    return true;
  }
}
