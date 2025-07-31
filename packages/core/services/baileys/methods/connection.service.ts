import {
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import P from 'pino';
import fs from 'fs';
import path from 'path';
import { injectable } from 'tsyringe';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { baileysEnvironment } from '@core/config/environments';
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { BaileysHelpersService } from './helpers.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysUpdateEvent } from '@core/common/interfaces/IBaileysUpdateEvent';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EWppConnection } from '@core/common/enums/EWppConnection';
import { wppConnectionMappings } from '@core/mappings/wppConnection.mappings';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { v4 as uuidv4 } from 'uuid';
import { StreamProducerService } from '@core/services/streamProducer.service';

const FOLDER = path.join(
  process.cwd(),
  'storage',
  baileysEnvironment.baileysWorkerId
);
const CHANNEL = `worker_${baileysEnvironment.baileysWorkerId}_qrcode`;
const WORKER = baileysEnvironment.baileysWorkerId;

@injectable()
export class BaileysConnectionService {
  private readonly retryDelay = 2_000;
  private readonly maxRetries = 5;

  private socket?: WASocket;
  private status: Status = Status.initial;
  private code: ECodeMessage = ECodeMessage.awaitConnection;

  private socketId = 0;
  private qrHash?: string;
  private initialConnection = false;
  private awaitingNewLogin = false;
  private lastPayload: string | null = null;

  private connecting = false;
  private retryCount = 0;
  private currentPromise?: Promise<IBaileysConnectionState>;
  private pendingResolve?: (s: IBaileysConnectionState) => void;

  constructor(
    private readonly centrifugo: CentrifugoService,
    private readonly helpers: BaileysHelpersService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly streamProducerService: StreamProducerService
  ) {
    process.on('unhandledRejection', () => this.handleFatal());
  }

  get connected(): boolean {
    return this.status === Status.connected && !!this.socket?.user;
  }

  getStatus(): Status {
    return this.status;
  }

  getSocket(): WASocket | undefined {
    return this.socket;
  }

  async connect(
    initial = false,
    allowRestore = true
  ): Promise<IBaileysConnectionState> {
    this.initialConnection = initial;

    if (this.connected) {
      return this.reportConnected();
    }

    if (this.connecting) {
      if (initial) {
        this.cancelAttempt();
      }

      if (this.currentPromise) {
        return this.currentPromise;
      }
    }

    if (allowRestore && this.status === Status.initial && this.hasSession()) {
      return this.restoreWithRetries();
    }

    this.prepareFolder();
    this.connecting = true;
    this.retryCount = 0;
    this.socketId += 1;

    const { socket, saveCreds } = await this.createSocket();

    this.socket = socket;
    socket.ev.on('creds.update', saveCreds);

    this.currentPromise = this.wait(socket, this.socketId).finally(() => {
      this.connecting = false;
      this.currentPromise = undefined;
    });

    return this.currentPromise;
  }

  disconnect(
    initial: boolean = false,
    disconnectedUser: boolean = false
  ): void {
    this.initialConnection = initial;

    this.cancelAttempt();
    this.safeLogout();
    this.clearFolder();

    this.saveLogWppConnection({
      worker_id: WORKER,
      status: this.status,
      code: this.code?.toString(),
      message: 'BaileysConnectionService disconnected',
      date: new Date(),
    });

    if (!this.initialConnection) {
      return;
    }

    this.setStatus(Status.disconnected, ECodeMessage.connectionClosed);

    const payload: IBaileysConnectionState = {
      status: this.status,
      worker_id: WORKER,
      code: this.code,
      disconnected_user: disconnectedUser,
    };

    this.publish(payload);

    this.streamProducerService.send('worker.status', payload, WORKER);

    this.connect(true);
  }

  private async createSocket() {
    const { state, saveCreds } = await useMultiFileAuthState(FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    return {
      socket: makeWASocket({
        auth: state,
        version,
        browser: ['Windows', 'Chrome', '4.0.0'],
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        connectTimeoutMs: 60_000,
      }),
      saveCreds,
    };
  }

  private wait(socket: WASocket, id: number): Promise<IBaileysConnectionState> {
    return new Promise<IBaileysConnectionState>((resolve) => {
      this.pendingResolve = resolve;
      let opened = false;

      socket.ev.on('connection.update', async (u: IBaileysUpdateEvent) => {
        if (id !== this.socketId) {
          return;
        }

        const { qr, connection, isNewLogin, lastDisconnect } = u;

        if (isNewLogin) {
          return this.onNewLoginAttempt();
        }

        if (qr && this.canShowQr()) {
          return this.onQr(qr, resolve);
        }

        if (connection === 'open' && !opened) {
          opened = true;
          this.retryCount = 0;

          return this.onOpen(resolve);
        }

        if (connection === 'close') {
          return this.onClose(lastDisconnect, resolve);
        }
      });
    });
  }

  private async onQr(
    qr: string,
    resolve: (s: IBaileysConnectionState) => void
  ): Promise<void> {
    if (qr.slice(-20) === this.qrHash) {
      return;
    }

    this.qrHash = qr.slice(-20);
    this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);

    const img = await QRCode.toDataURL(qr);

    this.publish({
      status: this.status,
      code: this.code,
      qrcode: img,
      worker_id: WORKER,
    });

    if (!this.initialConnection) {
      this.saveLogWppConnection({
        worker_id: WORKER,
        status: this.status,
        code: this.code?.toString(),
        message: 'QR Code received',
        date: new Date(),
      });
    }

    resolve(this.state(img));

    this.pendingResolve = undefined;
    this.initialConnection = false;
  }

  private onOpen(resolve: (s: IBaileysConnectionState) => void): void {
    this.qrHash = undefined;
    this.setStatus(Status.connected, ECodeMessage.connectionEstablished);

    const payload: IBaileysConnectionState = {
      status: this.status,
      worker_id: WORKER,
      code: this.code,
      phone: this.helpers.getPhoneNumber(this.socket?.user?.id),
    };

    this.publish(payload);

    this.streamProducerService.send('worker.status', payload, WORKER);

    resolve(this.state());

    this.pendingResolve = undefined;
  }

  private onClose(
    last: IBaileysUpdateEvent['lastDisconnect'],
    resolve: (s: IBaileysConnectionState) => void
  ): void {
    const statusCode = (last?.error as any)?.output?.statusCode as
      | ECodeMessage
      | undefined;
    const statusMessage: string | undefined = last?.error?.message;

    if (statusCode) {
      this.setStatus(Status.disconnected, statusCode);
    }

    const payload: IBaileysConnectionState = {
      status: this.status,
      worker_id: WORKER,
      code: this.code ?? statusCode,
    };

    this.publish(payload);

    this.streamProducerService.send('worker.status', payload, WORKER);

    this.saveLogWppConnection({
      worker_id: WORKER,
      status: this.status,
      code: this.code?.toString(),
      message: statusMessage ?? 'BaileysConnectionService disconnected',
      date: new Date(),
    });

    if (statusCode === ECodeMessage.loggedOut) {
      this.clearFolder();
    }

    resolve(this.state());
    this.pendingResolve = undefined;

    if (this.retryCount < this.maxRetries) {
      setTimeout(() => {
        this.retryCount++;

        this.connect(this.initialConnection).catch(() => {
          this.saveLogWppConnection({
            worker_id: WORKER,
            status: this.status ?? Status.disconnected,
            code: this.code ?? ECodeMessage.connectionLost,
            message: 'Retry failed',
            date: new Date(),
          });
        });
      }, this.retryDelay);
    }
  }

  private onNewLoginAttempt() {
    this.awaitingNewLogin = true;

    const payload: IBaileysConnectionState = {
      status: this.status,
      worker_id: WORKER,
      is_new_login: true,
      code: ECodeMessage.newLoginAttempt,
    };

    this.lastPayload = JSON.stringify(payload);
    this.centrifugo.publish(CHANNEL, payload);
  }

  private canShowQr(): boolean {
    return this.initialConnection && !this.connected && !this.awaitingNewLogin;
  }

  private hasSession(): boolean {
    return fs.existsSync(FOLDER) && fs.readdirSync(FOLDER).length > 0;
  }

  private async restoreWithRetries(): Promise<IBaileysConnectionState> {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const s = await this.connect(this.initialConnection, false);

        if (s.status === Status.connected) {
          return s;
        }
      } catch (e) {
        this.saveLogWppConnection({
          worker_id: WORKER,
          status: Status.disconnected,
          code: ECodeMessage.connectionLost,
          message: `Failed to restore session: ${e instanceof Error ? e.message : String(e)}`,
          date: new Date(),
        });
      }

      await new Promise((r) => setTimeout(r, this.retryDelay));
    }
    this.setStatus(Status.disconnected, ECodeMessage.badSession);

    return this.state();
  }

  private publish(payload: IBaileysConnectionState): void {
    if (!this.initialConnection) {
      return;
    }

    const data = JSON.stringify(payload);
    if (data === this.lastPayload) {
      return;
    }

    this.lastPayload = data;
    this.centrifugo.publish(CHANNEL, payload);
  }

  private safeLogout(): void {
    if (this.socket) {
      try {
        if (this.socket.user) {
          this.socket.logout().catch(() => {
            this.saveLogWppConnection({
              worker_id: WORKER,
              status: Status.disconnected,
              code: ECodeMessage.connectionLost,
              message: 'Error during logout',
              date: new Date(),
            });
          });
        }
      } catch {
        this.saveLogWppConnection({
          worker_id: WORKER,
          status: Status.disconnected,
          code: ECodeMessage.connectionLost,
          message: 'Error during logout',
          date: new Date(),
        });
      }
    }

    try {
      const ws: import('ws').WebSocket | undefined = (this.socket as any).ws;
      if (!ws) {
        return;
      }

      switch (ws.readyState) {
        case ws.OPEN:
          ws.close(1000, 'logout');
          break;

        case ws.CONNECTING:
        case ws.CLOSING:
          ws.terminate?.();
          break;

        default:
          break;
      }
    } catch {
      this.saveLogWppConnection({
        worker_id: WORKER,
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        message: 'Error during WebSocket close',
        date: new Date(),
      });
    }

    this.socket = undefined;
    this.setStatus(Status.disconnected, ECodeMessage.loggedOut);
  }

  private cancelAttempt() {
    try {
      this.socket?.ev.removeAllListeners('connection.update');
    } catch {
      this.saveLogWppConnection({
        worker_id: WORKER,
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        message: 'Error during cancel attempt',
        date: new Date(),
      });
    }

    this.safeLogout();
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;

    this.currentPromise = undefined;
    this.connecting = false;
    this.awaitingNewLogin = false;
  }

  private reportConnected(): IBaileysConnectionState {
    if (this.initialConnection) {
      this.lastPayload = null;

      this.publish({
        status: this.status,
        code: ECodeMessage.connectionEstablished,
        worker_id: WORKER,
        phone: this.helpers.getPhoneNumber(this.socket?.user?.id),
      });
    }

    return this.state();
  }

  private prepareFolder() {
    if (!fs.existsSync(FOLDER)) {
      fs.mkdirSync(FOLDER, {
        recursive: true,
      });
    }
  }

  private clearFolder() {
    fs.readdirSync(FOLDER).forEach((f) =>
      fs.rmSync(path.join(FOLDER, f), {
        recursive: true,
        force: true,
      })
    );
  }

  private setStatus(s: Status, c?: ECodeMessage) {
    this.status = s;

    if (c) {
      this.code = c;
    }
  }

  private state(qr?: string): IBaileysConnectionState {
    return {
      status: this.status,
      worker_id: WORKER,
      qrcode: qr,
      code: this.code,
    };
  }

  private handleFatal() {
    this.setStatus(Status.disconnected, ECodeMessage.connectionLost);

    const payload: IBaileysConnectionState = {
      status: this.status,
      worker_id: WORKER,
      code: this.code,
    };

    this.publish(payload);

    this.streamProducerService.send('worker.status', payload, WORKER);

    this.saveLogWppConnection({
      worker_id: WORKER,
      status: this.status,
      code: this.code?.toString(),
      message: 'Unhandled Rejection – BaileysConnectionService',
      date: new Date(),
    });
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

    return this.elasticDatabaseService.update(
      EElasticIndex.wpp_connection,
      wppLog,
      uuidv4()
    );
  };
}
