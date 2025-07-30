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
import fs, { mkdirSync } from 'fs';
import path from 'path';
import { injectable } from 'tsyringe';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysUpdateEvent } from '@core/common/interfaces/IBaileysUpdateEvent';
import { baileysEnvironment } from '@core/config/environments';

const credentialsFolder = path.join(
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
  private reconnecting = false;

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
    if (this.connected) {
      return this.state();
    }

    if (this.reconnecting) {
      return this.waitCurrentConnect();
    }

    this.reconnecting = true;

    this.ensureFolder();
    const { socket, saveCreds } = await this.createSocket();

    this.socket = socket;
    socket.ev.on('creds.update', saveCreds);

    return this.waitForConnection(socket).finally(() => {
      this.reconnecting = false;
    });
  }

  disconnect(): void {
    this.socket?.logout().catch(() => null);
    this.socket?.end(new Error('logout'));
    this.deleteStoredFiles();
    this.setStatus(Status.disconnected);
  }

  discard(): void {
    this.disconnect();
  }

  async reconnect(): Promise<IBaileysConnectionState> {
    if (this.connected) {
      return this.state();
    }
    this.attempts = 0;

    return this.connect();
  }

  private state(qr?: string): IBaileysConnectionState {
    return {
      status: this.status,
      worker_id: baileysEnvironment.baileysWorkerId,
      qrcode: qr,
    };
  }

  private ensureFolder() {
    if (!fs.existsSync(credentialsFolder)) {
      mkdirSync(credentialsFolder, { recursive: true });
    }
  }

  private deleteStoredFiles() {
    fs.readdirSync(credentialsFolder).forEach((e) => {
      const p = path.join(credentialsFolder, e);

      fs.rmSync(p, { recursive: true, force: true });
    });
  }

  private async createSocket() {
    const { state, saveCreds } = await useMultiFileAuthState(credentialsFolder);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      auth: state,
      version,
      browser: ['Windows', 'Chrome', '4.0.0'],
      printQRInTerminal: false,
      connectTimeoutMs: 60_000,
      logger: P({ level: 'silent' }),
    });

    return { socket, saveCreds };
  }

  private waitCurrentConnect() {
    return new Promise<IBaileysConnectionState>((r) => {
      const check = setInterval(() => {
        if (!this.reconnecting) {
          clearInterval(check);
          r(this.state());
        }
      }, 250);
    });
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

        if (!connection) return;

        connection === 'open'
          ? this.onOpen(socket, listener, resolve)
          : this.onClose(lastDisconnect, socket, listener, resolve);
      };

      socket.ev.on('connection.update', listener);
    });
  }

  private async handleQr(
    qr: string,
    resolve: (v: IBaileysConnectionState) => void
  ) {
    const hash = qr.slice(-20);
    if (hash === this.qrHash) return;

    this.qrHash = hash;
    this.setStatus(Status.connecting);

    const qrcode = await QRCode.toDataURL(qr);
    await this.safePublish(qrcode);

    resolve(this.state(qrcode));
  }

  private onOpen(
    socket: WASocket,
    listener: (u: IBaileysUpdateEvent) => void,
    resolve: (v: IBaileysConnectionState) => void
  ) {
    socket.ev.off('connection.update', listener);

    this.attempts = 0;
    this.qrHash = undefined;
    this.setStatus(Status.connected);

    void this.safePublish();
    resolve(this.state());
  }

  private onClose(
    lastDisconnect: IBaileysUpdateEvent['lastDisconnect'],
    socket: WASocket,
    listener: (u: IBaileysUpdateEvent) => void,
    resolve: (v: IBaileysConnectionState) => void
  ) {
    const code = (lastDisconnect?.error as Boom | undefined)?.output
      ?.statusCode;
    this.setStatus(Status.disconnected);
    void this.safePublish();

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
    resolve(this.state());
  }

  private async safePublish(qrcode?: string) {
    try {
      await this.centrifugo.publish(
        `worker_${baileysEnvironment.baileysWorkerId}_qrcode`,
        {
          status: this.status,
          qrcode,
          worker_id: baileysEnvironment.baileysWorkerId,
        }
      );
    } catch (err) {
      console.error('[Centrifugo] publish error:', err);
    }
  }

  private setStatus(s: Status) {
    this.status = s;
  }
}
