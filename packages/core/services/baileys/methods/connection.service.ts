import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import P from 'pino';
import path from 'path';
import fs, { mkdirSync } from 'fs';
import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { baileysEnvironment } from '@core/config/environments';
import { IBaileysUpdateEvent } from '@core/common/interfaces/IBaileysUpdateEvent';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { injectable } from 'tsyringe';
import { ECentrifugoChannel } from '@core/common/enums/ECentrifugoChannel';

const credentialsFolder = path.join(
  process.cwd(),
  'storage',
  baileysEnvironment.baileysContainerName
);

@injectable()
export class BaileysConnectionService {
  constructor(private readonly centrifugoService: CentrifugoService) {}

  private socket?: WASocket;
  private status: Status = Status.disconnected;
  private attempts = 0;
  private qrHash?: string;

  get connected() {
    return this.status === Status.connected;
  }
  getSocket(): WASocket | undefined {
    return this.socket;
  }
  getStatus(): Status {
    return this.status;
  }

  async connect(): Promise<IBaileysConnectionState> {
    if (this.connected) {
      return {
        status: this.status,
        container_name: baileysEnvironment.baileysContainerName,
      };
    }

    this.ensureFolder();
    const { socket, saveCreds } = await this.createSocket();

    this.socket = socket;
    socket.ev.on('creds.update', saveCreds);

    return this.waitForConnection(socket);
  }

  disconnect(): void {
    this.socket?.logout().catch(() => null);
    this.socket?.end(new Error('logout'));
    this.deleteStoredFiles();

    this.centrifugoService.unsubscribe(ECentrifugoChannel.connection_channel);

    this.setStatus(Status.disconnected);
  }

  private deleteStoredFiles(): void {
    const entries = fs.readdirSync(credentialsFolder);

    entries.forEach((entry) => {
      const p = path.join(credentialsFolder, entry);

      fs.lstatSync(p).isDirectory()
        ? fs.rmSync(p, { recursive: true, force: true })
        : fs.unlinkSync(p);
    });
  }

  private ensureFolder() {
    if (!fs.existsSync(credentialsFolder)) {
      mkdirSync(credentialsFolder, { recursive: true });
    }
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

  private waitForConnection(
    socket: WASocket
  ): Promise<IBaileysConnectionState> {
    return new Promise<IBaileysConnectionState>((resolve) => {
      const listener = (update: IBaileysUpdateEvent) => {
        const { qr, connection, lastDisconnect } = update;

        if (qr) {
          this.handleQr(qr, resolve);

          return;
        }

        if (connection === 'open' || connection === 'close') {
          this.handleConnectionState(
            connection,
            lastDisconnect,
            socket,
            listener,
            resolve
          );
        }
      };

      socket.ev.on('connection.update', listener);
    });
  }

  private async handleQr(
    qr: string,
    resolve: (v: IBaileysConnectionState) => void
  ) {
    const hash = qr.slice(-20);
    if (hash === this.qrHash) {
      return;
    }

    this.qrHash = hash;
    this.setStatus(Status.connecting);

    const qrcode = await QRCode.toDataURL(qr);

    this.centrifugoService.publish(ECentrifugoChannel.connection_channel, {
      status: this.status,
      qrcode,
      container_name: baileysEnvironment.baileysContainerName,
    });

    resolve({
      status: this.status,
      qrcode,
      container_name: baileysEnvironment.baileysContainerName,
    });
  }

  private handleConnectionState(
    connection: 'open' | 'close',
    lastDisconnect: IBaileysUpdateEvent['lastDisconnect'],
    socket: WASocket,
    listener: (u: IBaileysUpdateEvent) => void,
    resolve: (v: IBaileysConnectionState) => void
  ): void {
    if (connection === 'open') {
      this.onOpen(socket, listener, resolve);

      return;
    }

    this.onClose(lastDisconnect, socket, listener, resolve);
  }

  private onOpen(
    socket: WASocket,
    listener: (u: IBaileysUpdateEvent) => void,
    resolve: (v: IBaileysConnectionState) => void
  ): void {
    socket.ev.off('connection.update', listener);

    this.attempts = 0;
    this.qrHash = undefined;
    this.setStatus(Status.connected);

    this.centrifugoService.publish(ECentrifugoChannel.connection_channel, {
      status: this.status,
      container_name: baileysEnvironment.baileysContainerName,
    });

    resolve({
      status: this.status,
      container_name: baileysEnvironment.baileysContainerName,
    });
  }

  private onClose(
    lastDisconnect: IBaileysUpdateEvent['lastDisconnect'],
    socket: WASocket,
    listener: (u: IBaileysUpdateEvent) => void,
    resolve: (v: IBaileysConnectionState) => void
  ): void {
    const code = (lastDisconnect?.error as Boom | undefined)?.output
      ?.statusCode;

    this.setStatus(Status.disconnected);

    this.centrifugoService.publish(ECentrifugoChannel.connection_channel, {
      status: this.status,
      container_name: baileysEnvironment.baileysContainerName,
    });

    if (code !== DisconnectReason.loggedOut && this.attempts < 5) {
      this.attempts++;
      setTimeout(() => this.connect().then(resolve), 5_000);

      return;
    }

    socket.ev.off('connection.update', listener);

    resolve({
      status: this.status,
      container_name: baileysEnvironment.baileysContainerName,
    });
  }

  private setStatus(s: Status) {
    this.status = s;
  }
}
