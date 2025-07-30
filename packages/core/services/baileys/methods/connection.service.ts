import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import P from 'pino';
import fs from 'fs';
import path from 'path';
import { injectable } from 'tsyringe';

import { CentrifugoService } from '@core/services/centrifugo.service';
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysUpdateEvent } from '@core/common/interfaces/IBaileysUpdateEvent';
import { baileysEnvironment } from '@core/config/environments';

const folder = path.join(
  process.cwd(),
  'storage',
  baileysEnvironment.baileysWorkerId
);

@injectable()
export class BaileysConnectionService {
  constructor(private readonly centrifugo: CentrifugoService) {}

  private socket?: WASocket;
  private status: Status = Status.disconnected;
  private qrHash?: string;
  private attempts = 0;
  private readonly maxRetries = 5;
  private readonly retryDelay = 5_000;

  private pendingResolve?: (s: IBaileysConnectionState) => void;
  private currentListener?: (u: IBaileysUpdateEvent) => void;

  get connected() {
    return this.status === Status.connected;
  }
  getStatus() {
    return this.status;
  }
  getSocket(): WASocket | undefined {
    return this.socket;
  }

  async connect(): Promise<IBaileysConnectionState> {
    if (this.connected) return this.state();

    this.cancelOngoingAttempt();

    this.ensureFolder();
    const { socket, saveCreds } = await this.createSocket();
    this.socket = socket;
    socket.ev.on('creds.update', saveCreds);

    return this.waitForConnection(socket);
  }

  disconnectSession(): void {
    this.logout();
    this.deleteStoredFiles();
  }

  async reconnect(): Promise<IBaileysConnectionState> {
    if (this.connected) return this.state();
    this.logout();
    return this.connect();
  }

  private cancelOngoingAttempt() {
    if (!this.currentListener) return;
    this.socket?.ev.off('connection.update', this.currentListener);
    this.logout();
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;
    this.currentListener = undefined;
  }

  private logout() {
    this.socket?.logout().catch(() => null);
    this.socket?.end(new Error('logout'));
    this.setStatus(Status.disconnected);
  }

  private deleteStoredFiles() {
    fs.readdirSync(folder).forEach((e) =>
      fs.rmSync(path.join(folder, e), { recursive: true, force: true })
    );
  }

  private ensureFolder() {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  }

  private async createSocket() {
    const { state, saveCreds } = await useMultiFileAuthState(folder);
    const { version } = await fetchLatestBaileysVersion();

    return {
      socket: makeWASocket({
        auth: state,
        version,
        browser: ['Windows', 'Chrome', '4.0.0'],
        printQRInTerminal: false,
        connectTimeoutMs: 60_000,
        logger: P({ level: 'silent' }),
      }),
      saveCreds,
    };
  }

  private waitForConnection(
    socket: WASocket
  ): Promise<IBaileysConnectionState> {
    return new Promise<IBaileysConnectionState>((resolve) => {
      const listener = (u: IBaileysUpdateEvent) => {
        const { qr, connection, lastDisconnect } = u;
        if (qr) {
          this.handleQr(qr, resolve);
          return;
        }
        if (connection === 'open') {
          this.onOpen(socket, listener, resolve);
          return;
        }
        if (connection === 'close')
          this.onClose(lastDisconnect, socket, listener, resolve);
      };
      this.currentListener = listener;
      this.pendingResolve = resolve;
      socket.ev.on('connection.update', listener);
    });
  }

  private async handleQr(
    qr: string,
    resolve: (s: IBaileysConnectionState) => void
  ) {
    const hash = qr.slice(-20);
    if (hash === this.qrHash) return;

    this.qrHash = hash;
    this.setStatus(Status.connecting);

    const qrcode = await QRCode.toDataURL(qr);

    this.centrifugo.publish(
      `worker_${baileysEnvironment.baileysWorkerId}_qrcode`,
      {
        status: this.status,
        qrcode,
        worker_id: baileysEnvironment.baileysWorkerId,
      }
    );

    resolve(this.state(qrcode));
  }

  private onOpen(
    socket: WASocket,
    listener: (u: IBaileysUpdateEvent) => void,
    resolve: (s: IBaileysConnectionState) => void
  ) {
    socket.ev.off('connection.update', listener);
    this.currentListener = undefined;
    this.pendingResolve = undefined;
    this.attempts = 0;
    this.qrHash = undefined;
    this.setStatus(Status.connected);

    this.centrifugo.publish(
      `worker_${baileysEnvironment.baileysWorkerId}_qrcode`,
      { status: this.status, worker_id: baileysEnvironment.baileysWorkerId }
    );

    resolve(this.state());
  }

  private onClose(
    last: IBaileysUpdateEvent['lastDisconnect'],
    socket: WASocket,
    listener: (u: IBaileysUpdateEvent) => void,
    resolve: (s: IBaileysConnectionState) => void
  ) {
    const code = (last?.error as Boom | undefined)?.output?.statusCode;
    this.setStatus(Status.disconnected);

    this.centrifugo.publish(
      `worker_${baileysEnvironment.baileysWorkerId}_qrcode`,
      { status: this.status, worker_id: baileysEnvironment.baileysWorkerId }
    );

    if (
      code !== DisconnectReason.loggedOut &&
      this.attempts < this.maxRetries
    ) {
      this.attempts++;
      setTimeout(() => {
        this.connect()
          .then(resolve)
          .catch(() => resolve(this.state()));
      }, this.retryDelay);
      return;
    }

    socket.ev.off('connection.update', listener);
    this.currentListener = undefined;
    this.pendingResolve = undefined;
    resolve(this.state());
  }

  private setStatus(s: Status) {
    this.status = s;
  }

  private state(qr?: string): IBaileysConnectionState {
    return {
      status: this.status,
      worker_id: baileysEnvironment.baileysWorkerId,
      qrcode: qr,
    };
  }
}
