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
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysUpdateEvent } from '@core/common/interfaces/IBaileysUpdateEvent';
import { baileysEnvironment } from '@core/config/environments';

const folder = path.join(
  process.cwd(),
  'storage',
  baileysEnvironment.baileysWorkerId
);
const channel = `worker_${baileysEnvironment.baileysWorkerId}_qrcode`;
const workerId = baileysEnvironment.baileysWorkerId;

@injectable()
export class BaileysConnectionService {
  constructor(private readonly centrifugo: CentrifugoService) {
    process.on('unhandledRejection', () => this.handleFatal());
  }

  private socket?: WASocket;
  private status: Status = Status.disconnected;
  private qrHash?: string;

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
    if (this.connected) {
      this.centrifugo.publish(channel, {
        status: this.status,
        worker_id: workerId,
      });

      return this.state();
    }

    this.cancelPending();
    this.prepareFolder();

    const { socket, saveCreds } = await this.newSocket();

    this.socket = socket;
    socket.ev.on('creds.update', saveCreds);

    return this.wait(socket);
  }

  disconnectSession() {
    this.logout();
    this.clearFolder();
  }

  private cancelPending() {
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

  private clearFolder() {
    fs.readdirSync(folder).forEach((e) =>
      fs.rmSync(path.join(folder, e), { recursive: true, force: true })
    );
  }

  private prepareFolder() {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  }

  private async newSocket() {
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

  private wait(socket: WASocket): Promise<IBaileysConnectionState> {
    return new Promise<IBaileysConnectionState>((resolve) => {
      const listener = (u: IBaileysUpdateEvent) => {
        const { qr, connection } = u;

        if (qr) {
          this.onQr(qr, resolve);
          return;
        }

        if (connection === 'open') {
          this.onOpen(socket, listener, resolve);
          return;
        }

        if (connection === 'close') {
          this.onClose(socket, listener, resolve);
        }
      };
      this.currentListener = listener;
      this.pendingResolve = resolve;

      socket.ev.on('connection.update', listener);
    });
  }

  private async onQr(
    qr: string,
    resolve: (s: IBaileysConnectionState) => void
  ) {
    const hash = qr.slice(-20);
    if (hash === this.qrHash) return;

    this.qrHash = hash;
    this.setStatus(Status.connecting);

    const qrcode = await QRCode.toDataURL(qr);

    this.centrifugo.publish(channel, {
      status: this.status,
      qrcode,
      worker_id: workerId,
    });

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
    this.qrHash = undefined;
    this.setStatus(Status.connected);

    this.centrifugo.publish(channel, {
      status: this.status,
      worker_id: workerId,
    });

    resolve(this.state());
  }

  private onClose(
    socket: WASocket,
    listener: (u: IBaileysUpdateEvent) => void,
    resolve: (s: IBaileysConnectionState) => void
  ) {
    this.setStatus(Status.disconnected);

    this.centrifugo.publish(channel, {
      status: this.status,
      worker_id: workerId,
    });

    socket.ev.off('connection.update', listener);

    this.currentListener = undefined;
    this.pendingResolve = undefined;

    resolve(this.state());
  }

  private handleFatal() {
    this.cancelPending();
    this.setStatus(Status.disconnected);

    this.centrifugo.publish(channel, {
      status: this.status,
      worker_id: workerId,
    });
  }

  private setStatus(s: Status) {
    this.status = s;
  }

  private state(qr?: string): IBaileysConnectionState {
    return { status: this.status, worker_id: workerId, qrcode: qr };
  }
}
