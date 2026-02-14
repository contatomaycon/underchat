import whatsappWeb from 'whatsapp-web.js';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { singleton, inject } from 'tsyringe';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { wwebjsEnvironment } from '@core/config/environments';
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EWppConnection } from '@core/common/enums/EWppConnection';
import { wppConnectionMappings } from '@core/mappings/wppConnection.mappings';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import { buildWppConnectionDocumentId } from '@core/common/functions/buildWppConnectionDocumentId';
import { triggerConnectionEstablished } from '../callbacks';
import { WwebjsIncomingMessageService } from './incoming.service';

const FOLDER = `/app/data/wwebjs/storage/${wwebjsEnvironment.wwebjsWorkerId}`;
const CHANNEL = workerCentrifugoQueue(wwebjsEnvironment.wwebjsAccountId);
const WORKER = wwebjsEnvironment.wwebjsWorkerId;
const ACCOUNT = wwebjsEnvironment.wwebjsAccountId;
const RETRY_DELAY = 2000;
const MAX_RETRIES = 5;

const { Client: ClientCtor, LocalAuth } = whatsappWeb;
type Client = InstanceType<typeof ClientCtor>;

@singleton()
export class WwebjsConnectionService {
  private client: Client | undefined;
  private status: Status = Status.initial;
  private code: ECodeMessage = ECodeMessage.awaitConnection;
  private connectionEstablished = false;
  private userRequestedDisconnect = false;
  private initialConnection = false;
  private connecting = false;
  private retryCount = 0;
  private currentPromise: Promise<IBaileysConnectionState> | undefined;
  private pendingResolve: ((s: IBaileysConnectionState) => void) | undefined;
  private lastPayload: string | null = null;
  private qrHash: string | undefined;
  private typeConnection: EBaileysConnectionType =
    EBaileysConnectionType.qrcode;

  constructor(
    @inject(CentrifugoService)
    private readonly centrifugo: CentrifugoService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(BalanceWorkerStatusGrpcClientService)
    private readonly balanceWorkerStatusGrpcClientService: BalanceWorkerStatusGrpcClientService,
    @inject(WwebjsIncomingMessageService)
    private readonly incomingMessageService: WwebjsIncomingMessageService
  ) {}

  get connected(): boolean {
    return this.connectionEstablished && this.status === Status.connected;
  }

  getStatus(): Status {
    return this.status;
  }

  getCode(): ECodeMessage {
    return this.code;
  }

  getSocket(): Client | undefined {
    return this.client;
  }

  clearUserRequestedDisconnect(): void {
    this.userRequestedDisconnect = false;
  }

  republishLastState(): void {
    if (!this.lastPayload || !this.initialConnection) {
      return;
    }

    try {
      const payload = JSON.parse(this.lastPayload) as IBaileysConnectionState;
      void this.centrifugo.publishSub(CHANNEL, payload).catch(() => {});
    } catch {}
  }

  hasSession(): boolean {
    const authPath = path.join(FOLDER, '.wwebjs_auth');
    const sessionPath = path.join(authPath, `session-${WORKER}`);
    return fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0;
  }

  async connect(input: IBaileysConnection): Promise<IBaileysConnectionState> {
    const {
      initial_connection: initialConnection = false,
      allow_restore: allowRestore = true,
      type: typeConnection = EBaileysConnectionType.qrcode,
      force_new: forceNew = false,
      requested_by_user: requestedByUser = false,
      from_disconnect_restart: fromDisconnectRestart = false,
    } = input;

    if (requestedByUser) {
      this.userRequestedDisconnect = false;
    }

    if (this.userRequestedDisconnect && !fromDisconnectRestart) {
      return this.state();
    }

    this.initialConnection = initialConnection;
    this.typeConnection = typeConnection;

    if (forceNew) {
      this.cancelAttempt(false);
    }

    if (this.connected) {
      return this.reportConnected();
    }

    if (this.connecting && this.currentPromise) {
      return this.currentPromise;
    }

    if (
      (this.status === Status.initial || this.status === Status.disconnected) &&
      allowRestore &&
      this.hasSession()
    ) {
      return this.startConnection();
    }

    return this.startConnection();
  }

  async disconnect(input: IBaileysConnection): Promise<void> {
    const {
      initial_connection: initialConnection = false,
      disconnected_user: disconnectedUser = false,
    } = input;

    this.initialConnection = initialConnection;
    this.connectionEstablished = false;

    if (disconnectedUser) {
      this.userRequestedDisconnect = true;
    }

    await this.safeDestroy();
    this.cancelAttempt(false);
    this.clearFolder();

    this.saveLogWppConnection({
      worker_id: WORKER,
      status: this.status,
      code: this.code?.toString(),
      message: 'WwebjsConnectionService disconnected',
      date: new Date(),
    });

    this.setStatus(Status.disconnected, ECodeMessage.connectionClosed);

    const payload: IBaileysConnectionState = {
      status: this.status,
      worker_id: WORKER,
      account_id: ACCOUNT,
      code: this.code,
      disconnected_user: disconnectedUser,
      worker_status_id: EWorkerStatus.disponible,
    };

    this.publishSub(payload, true);

    await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(payload);

    const shouldReconnect = this.initialConnection && !disconnectedUser;

    if (shouldReconnect) {
      this.connect({
        initial_connection: true,
      });
    }
  }

  reconnect(input: IBaileysConnection): void {
    const { initial_connection: initialConnection = true } = input;

    this.connect({
      initial_connection: initialConnection,
    }).catch(() => {
      this.saveLogWppConnection({
        worker_id: WORKER,
        status: this.status ?? Status.disconnected,
        code: this.code ?? ECodeMessage.connectionLost,
        message: 'Reconnect failed',
        date: new Date(),
      });
    });
  }

  private startConnection(): Promise<IBaileysConnectionState> {
    this.prepareFolder();
    this.connecting = true;
    this.retryCount = 0;
    this.currentPromise = this.createAndWaitClient().finally(() => {
      this.connecting = false;
      this.currentPromise = undefined;
    });

    return this.currentPromise;
  }

  private prepareFolder(): void {
    if (!fs.existsSync(FOLDER)) {
      fs.mkdirSync(FOLDER, { recursive: true });
    }
  }

  private clearFolder(): void {
    if (!fs.existsSync(FOLDER)) {
      return;
    }

    for (const f of fs.readdirSync(FOLDER)) {
      try {
        fs.rmSync(path.join(FOLDER, f), { recursive: true, force: true });
      } catch {}
    }
  }

  private createAndWaitClient(): Promise<IBaileysConnectionState> {
    return new Promise<IBaileysConnectionState>((resolve) => {
      this.pendingResolve = resolve;

      const authPath = path.join(FOLDER, `.wwebjs_auth`);
      const client = new ClientCtor({
        authStrategy: new LocalAuth({
          clientId: WORKER,
          dataPath: authPath,
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
          ],
        },
      });

      this.client = client;

      client.on('qr', async (qr: string) => {
        if (this.typeConnection !== EBaileysConnectionType.qrcode) {
          return;
        }

        const hash = qr.slice(-20);
        if (hash === this.qrHash) {
          return;
        }

        this.qrHash = hash;
        this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);

        const img = await QRCode.toDataURL(qr);

        const payload: IBaileysConnectionState = {
          status: this.status,
          code: this.code,
          qrcode: img,
          worker_id: WORKER,
          account_id: ACCOUNT,
          worker_status_id: EWorkerStatus.disponible,
        };

        this.publishSub(payload);

        if (!this.initialConnection) {
          this.saveLogWppConnection({
            worker_id: WORKER,
            status: this.status,
            code: this.code?.toString(),
            message: 'QR Code received',
            date: new Date(),
          });
        }

        this.pendingResolve?.(this.state(img));
        this.pendingResolve = undefined;
      });

      client.on('ready', () => {
        this.qrHash = undefined;
        this.setStatus(Status.connected, ECodeMessage.connectionEstablished);
        this.connectionEstablished = true;
        this.incomingMessageService.bindTo(client);

        const phone = getPhoneNumber(this.client?.info?.wid?._serialized);

        const payload: IBaileysConnectionState = {
          status: this.status,
          worker_id: WORKER,
          account_id: ACCOUNT,
          code: this.code,
          phone,
          worker_status_id: EWorkerStatus.online,
        };

        this.publishSub(payload);
        triggerConnectionEstablished();
        this.pendingResolve?.(this.state());
        this.pendingResolve = undefined;
      });

      client.on('disconnected', (reason: string) => {
        this.connectionEstablished = false;
        const statusCode = this.mapDisconnectReason(reason);
        this.setStatus(Status.disconnected, statusCode);

        const isMismatchedStatus =
          statusCode === ECodeMessage.loggedOut ||
          statusCode === ECodeMessage.multideviceMismatch ||
          statusCode === ECodeMessage.badSession ||
          statusCode === ECodeMessage.connectionReplaced;

        const workerStatusId = isMismatchedStatus
          ? EWorkerStatus.mismatched
          : EWorkerStatus.offline;

        const payload: IBaileysConnectionState = {
          status: this.status,
          worker_id: WORKER,
          account_id: ACCOUNT,
          code: statusCode,
          worker_status_id: workerStatusId,
        };

        this.publishSub(payload, true);

        this.saveLogWppConnection({
          worker_id: WORKER,
          status: this.status,
          code: this.code?.toString(),
          message: reason ?? 'Wwebjs disconnected',
          date: new Date(),
        });

        this.balanceWorkerStatusGrpcClientService
          .notifyWorkerStatus(payload)
          .catch(() => {});

        if (isMismatchedStatus) {
          this.updateWorkerMismatchedStatus();
        }

        if (statusCode === ECodeMessage.loggedOut) {
          if (!this.initialConnection) {
            this.clearFolder();
          }

          const logoutPayload: IBaileysConnectionState = {
            status: this.status,
            worker_id: WORKER,
            code: statusCode,
            disconnected_user: true,
            account_id: ACCOUNT,
            worker_status_id: EWorkerStatus.mismatched,
          };

          this.publishSub(logoutPayload, true);
          this.balanceWorkerStatusGrpcClientService
            .notifyWorkerStatus(logoutPayload)
            .catch(() => {});
        }

        this.pendingResolve?.(this.state());
        this.pendingResolve = undefined;

        this.incomingMessageService.unbind();
        this.client = undefined;

        if (this.retryCount < MAX_RETRIES) {
          this.retryCount++;
          const retryPayload: IBaileysConnectionState = {
            status: Status.connecting,
            worker_id: WORKER,
            account_id: ACCOUNT,
            code: ECodeMessage.awaitConnection,
            attempt: this.retryCount,
            max_attempts: MAX_RETRIES,
            seconds_until_next_attempt: Math.ceil(RETRY_DELAY / 1000),
          };
          this.publishSub(retryPayload, true);

          setTimeout(() => {
            this.connect({
              initial_connection: this.initialConnection,
            }).catch(() => {});
          }, RETRY_DELAY);
        }
      });

      client.on('auth_failure', () => {
        this.setStatus(Status.disconnected, ECodeMessage.badSession);
        this.pendingResolve?.(this.state());
        this.pendingResolve = undefined;
      });

      client.initialize().catch((err) => {
        this.setStatus(Status.disconnected, ECodeMessage.connectionLost);
        this.pendingResolve?.(this.state());
        this.pendingResolve = undefined;
        this.saveLogWppConnection({
          worker_id: WORKER,
          status: Status.disconnected,
          code: ECodeMessage.connectionLost,
          message: err instanceof Error ? err.message : String(err),
          date: new Date(),
        });
      });
    });
  }

  private mapDisconnectReason(reason: string): ECodeMessage {
    const lower = reason?.toLowerCase() ?? '';
    if (lower.includes('logged') || lower.includes('logout')) {
      return ECodeMessage.loggedOut;
    }
    if (lower.includes('replaced') || lower.includes('connectionreplaced')) {
      return ECodeMessage.connectionReplaced;
    }
    if (lower.includes('multidevice') || lower.includes('mismatch')) {
      return ECodeMessage.multideviceMismatch;
    }
    if (lower.includes('restart')) {
      return ECodeMessage.restartRequired;
    }
    return ECodeMessage.connectionLost;
  }

  private cancelAttempt(skipDestroy = false): void {
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;
    this.currentPromise = undefined;
    this.connecting = false;
    this.connectionEstablished = false;
    this.incomingMessageService.unbind();

    if (!skipDestroy && this.client) {
      this.client.destroy().catch(() => {});
      this.client = undefined;
    }
  }

  private async safeDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.destroy();
    } catch {
      this.saveLogWppConnection({
        worker_id: WORKER,
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        message: 'Error during destroy',
        date: new Date(),
      });
    }

    this.client = undefined;
    this.setStatus(Status.disconnected, ECodeMessage.loggedOut);
  }

  private reportConnected(): IBaileysConnectionState {
    if (this.initialConnection) {
      this.lastPayload = null;

      const payload = {
        status: this.status,
        code: ECodeMessage.connectionEstablished,
        worker_id: WORKER,
        account_id: ACCOUNT,
        phone: getPhoneNumber(this.client?.info?.wid?._serialized),
        worker_status_id: EWorkerStatus.online,
      };

      this.publishSub(payload);
    }

    return this.state();
  }

  private setStatus(s: Status, c?: ECodeMessage): void {
    this.status = s;
    if (c) {
      this.code = c;
    }
  }

  private state(qr?: string): IBaileysConnectionState {
    const result: IBaileysConnectionState = {
      status: this.status,
      worker_id: WORKER,
      account_id: ACCOUNT,
      qrcode: qr,
      code: this.code,
    };
    if (this.status === Status.connecting) {
      result.attempt = this.retryCount + 1;
      result.max_attempts = MAX_RETRIES;
    }
    return result;
  }

  private publishSub(payload: IBaileysConnectionState, force = false): void {
    if (!this.initialConnection && !force) {
      return;
    }

    const data = JSON.stringify(payload);
    if (data === this.lastPayload && !force) {
      return;
    }

    this.lastPayload = data;
    void this.centrifugo.publishSub(CHANNEL, payload).catch(() => {});
  }

  private async updateWorkerMismatchedStatus(): Promise<void> {
    const payload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: Status.disconnected,
      worker_id: WORKER,
      account_id: ACCOUNT,
      worker_status_id: EWorkerStatus.mismatched,
    };

    this.publishSub(payload);
    await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(payload);
  }

  private readonly saveLogWppConnection = async (
    wppLog: EWppConnection
  ): Promise<boolean> => {
    const mappings = wppConnectionMappings();
    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.wpp_connection,
      mappings
    );

    if (!result || !wppLog) {
      return false;
    }

    const documentId = buildWppConnectionDocumentId(ACCOUNT, wppLog.worker_id);

    const updateResult = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.wpp_connection,
      documentId,
      wppLog as unknown as Record<string, unknown>,
      { upsert: true, maxRetries: 5 }
    );

    return (
      updateResult === 'updated' ||
      updateResult === 'created' ||
      updateResult === 'noop'
    );
  };
}
