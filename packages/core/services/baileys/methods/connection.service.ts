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
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { BaileysHelpersService } from './helpers.service';

const folder = path.join(
  process.cwd(),
  'storage',
  baileysEnvironment.baileysWorkerId
);
const channel = `worker_${baileysEnvironment.baileysWorkerId}_qrcode`;
const worker = baileysEnvironment.baileysWorkerId;

@injectable()
export class BaileysConnectionService {
  constructor(
    private readonly centrifugo: CentrifugoService,
    private readonly baileysHelpersService: BaileysHelpersService
  ) {
    process.on('unhandledRejection', () => this.handleFatal());
  }

  private socket?: WASocket;
  private status: Status = Status.initial;
  private code: ECodeMessage = ECodeMessage.awaitConnection;

  private qrHash?: string;
  private initialConnection = false;
  private lastPayload?: string;
  private awaitingNewLogin = false;
  private connecting = false;

  private currentPromise?: Promise<IBaileysConnectionState>;
  private pendingResolve?: (s: IBaileysConnectionState) => void;

  get connected() {
    return this.status === Status.connected && !!this.socket?.user;
  }

  getStatus() {
    return this.status;
  }

  getCode() {
    return this.code;
  }

  getSocket(): ReturnType<typeof makeWASocket> | undefined {
    return this.socket;
  }

  async connect(
    initialConnection = false,
    allowRestore = true
  ): Promise<IBaileysConnectionState> {
    this.initialConnection = initialConnection;

    if (this.connected) {
      if (this.initialConnection) {
        this.setStatus(Status.connected);
        this.setCode(ECodeMessage.connectionEstablished);

        this.publish({
          code: this.getCode(),
          status: this.status,
          worker_id: worker,
          time: Date.now(),
        });
      }

      return this.state();
    }

    if (
      allowRestore &&
      this.status === Status.initial &&
      this.hasSessionFiles()
    ) {
      return this.restoreWithRetries();
    }

    if (this.connecting) {
      if (this.initialConnection) {
        this.cancelCurrentAttempt();
      }

      if (this.currentPromise) {
        return this.currentPromise;
      }
    }

    this.connecting = true;
    this.prepareFolder();

    const { socket, saveCreds } = await this.newSocket();
    this.socket = socket;
    socket.ev.on('creds.update', saveCreds);

    this.currentPromise = this.wait(socket).finally(() => {
      this.connecting = false;
      this.currentPromise = undefined;
    });

    return this.currentPromise;
  }

  disconnect(): void {
    this.cancelCurrentAttempt();
    this.logout();
    this.clearFolder();

    if (this.initialConnection) {
      this.setStatus(Status.disconnected);
      this.setCode(ECodeMessage.connectionClosed);

      this.publish({
        code: this.getCode(),
        status: this.status,
        worker_id: worker,
      });

      this.connect(true);
    }
  }

  private hasSessionFiles(): boolean {
    try {
      return fs.existsSync(folder) && fs.readdirSync(folder).length > 0;
    } catch {
      return false;
    }
  }

  /* ------------ helper novo: tenta reconectar até 5 vezes ----------- */
  private async restoreWithRetries(): Promise<IBaileysConnectionState> {
    for (let i = 1; i <= 5; i++) {
      try {
        const state = await this.connect(this.initialConnection, false); // ← evita recursão
        if (state.status === Status.connected) return state;
      } catch (e) {
        console.error(`Tentativa de restauração #${i} falhou`, e);
      }
    }

    console.error('Falha ao restaurar sessão após 5 tentativas');

    this.setStatus(Status.disconnected);
    this.setCode(ECodeMessage.badSession);

    return this.state();
  }

  /* ------------------------------------------------ helpers -------- */

  private cancelCurrentAttempt() {
    this.socket?.ev.removeAllListeners('connection.update');
    this.logout();

    this.pendingResolve?.(this.state()); // encerra promessa anterior
    this.pendingResolve = undefined;
    this.currentPromise = undefined;
    this.connecting = false;
  }

  private wait(socket: WASocket) {
    return new Promise<IBaileysConnectionState>((resolve) => {
      this.pendingResolve = resolve;

      let opened = false; // ← nova flag

      const listener = (u: IBaileysUpdateEvent) => {
        const { qr, connection, isNewLogin, lastDisconnect } = u;

        console.dir(u, { depth: 3, colors: true });

        /* tentativa de login --------------------------------------- */
        if (isNewLogin) {
          this.awaitingNewLogin = true;

          const payload: IBaileysConnectionState = {
            status: this.status,
            worker_id: worker,
            is_new_login: isNewLogin,
            code: ECodeMessage.newLoginAttempt,
          };

          this.lastPayload = JSON.stringify(payload);
          this.centrifugo.publish(channel, payload);

          return;
        }

        /* QR‑Code --------------------------------------------------- */
        if (
          qr &&
          this.initialConnection &&
          !this.connected &&
          !this.awaitingNewLogin
        ) {
          this.onQr(qr, resolve);

          return;
        }

        /* conexão estabelecida ------------------------------------- */
        if (connection === 'open' && !opened) {
          // roda só uma vez
          opened = true;
          this.awaitingNewLogin = false;

          this.onOpen(resolve);

          return;
        }

        /* conexão encerrada (logout, queda, etc.) ------------------ */
        if (connection === 'close') {
          this.awaitingNewLogin = false;

          this.onClose(lastDisconnect, resolve);
        }
      };

      socket.ev.on('connection.update', listener);
    });
  }

  private async onQr(
    qr: string,
    resolve: (s: IBaileysConnectionState) => void
  ) {
    if (qr.slice(-20) === this.qrHash) return;

    this.qrHash = qr.slice(-20);
    this.setStatus(Status.connecting);
    this.setCode(ECodeMessage.awaitingReadQrCode);

    const img = await QRCode.toDataURL(qr);
    this.publish({
      status: this.status,
      qrcode: img,
      worker_id: worker,
      code: this.getCode(),
    });

    resolve(this.state(img));
    this.pendingResolve = undefined;
    this.initialConnection = false;
  }

  private onOpen(resolve: (s: IBaileysConnectionState) => void) {
    this.qrHash = undefined;

    this.setStatus(Status.connected);
    this.setCode(ECodeMessage.connectionEstablished);

    const phone = this.baileysHelpersService.getPhoneNumber(
      this.socket?.user?.id
    );

    this.publish({
      status: this.status,
      worker_id: worker,
      code: this.getCode(),
      phone,
    });

    resolve(this.state());

    this.pendingResolve = undefined;
  }

  private onClose(
    last: IBaileysUpdateEvent['lastDisconnect'],
    resolve: (s: IBaileysConnectionState) => void
  ) {
    const statusCode = (last?.error as any)?.output?.statusCode as ECodeMessage;

    if (statusCode) {
      this.setStatus(Status.disconnected);
      this.setCode(statusCode);
    }

    this.publish({
      status: this.status,
      worker_id: worker,
      code: this.getCode(),
    });

    if (statusCode === ECodeMessage.loggedOut) {
      this.clearFolder();
    }

    resolve(this.state());
    this.pendingResolve = undefined;
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

  private publish(payload: IBaileysConnectionState) {
    if (!this.initialConnection) return; // somente na primeira chamada
    const data = JSON.stringify(payload);
    if (data === this.lastPayload) return; // evita duplicidade

    // cancela publicações pendentes caso initialConnection seja true
    this.lastPayload = data;
    this.centrifugo.publish(channel, payload);
  }

  private handleFatal() {
    this.setStatus(Status.disconnected);
    this.setCode(ECodeMessage.connectionLost);

    this.publish({
      status: this.status,
      worker_id: worker,
      code: this.getCode(),
    });
  }

  private logout() {
    this.socket?.logout().catch(() => null);
    this.socket?.end(new Error('logout'));
    this.setStatus(Status.disconnected);
    this.setCode(ECodeMessage.loggedOut);
  }

  private clearFolder() {
    fs.readdirSync(folder).forEach((f) =>
      fs.rmSync(path.join(folder, f), { recursive: true, force: true })
    );
  }

  private prepareFolder() {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  }

  private setStatus(s: Status) {
    this.status = s;
  }

  private setCode(code: ECodeMessage) {
    this.code = code;
  }

  private state(qr?: string): IBaileysConnectionState {
    return {
      status: this.status,
      worker_id: worker,
      qrcode: qr,
      code: this.getCode(),
    };
  }
}
