/* ------------------------------------------------------------------ */
/*  imports & constantes (inalterados)                                */
/* ------------------------------------------------------------------ */
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

const FOLDER = path.join(
  process.cwd(),
  'storage',
  baileysEnvironment.baileysWorkerId
);
const CHANNEL = `worker_${baileysEnvironment.baileysWorkerId}_qrcode`;
const WORKER = baileysEnvironment.baileysWorkerId;

/* ================================================================== */
/*  SERVICE                                                           */
/* ================================================================== */
@injectable()
export class BaileysConnectionService {
  /* -------- configuração estática -------- */
  private readonly retryDelay = 2_000;
  private readonly maxRetries = 5;

  /* -------- runtime -------- */
  private socket?: WASocket;
  private status: Status = Status.initial;
  private code: ECodeMessage = ECodeMessage.awaitConnection;

  private socketId = 0; // <<< identificação de geração
  private qrHash?: string;
  private initialConnection = false;
  private awaitingNewLogin = false;
  private lastPayload?: string;

  private connecting = false;
  private retryCount = 0;
  private currentPromise?: Promise<IBaileysConnectionState>;
  private pendingResolve?: (s: IBaileysConnectionState) => void;

  /* -------- DI -------- */
  constructor(
    private readonly centrifugo: CentrifugoService,
    private readonly helpers: BaileysHelpersService
  ) {
    process.on('unhandledRejection', () => this.handleFatal());
  }

  /* ================================================================ */
  /*  PUBLIC FACADE                                                   */
  /* ================================================================ */
  get connected(): boolean {
    return this.status === Status.connected && !!this.socket?.user;
  }
  getStatus(): Status {
    return this.status;
  }
  getSocket(): WASocket | undefined {
    return this.socket;
  }

  /* ---------------------------------------------------------------- */
  /*  CONNECT                                                         */
  /* ---------------------------------------------------------------- */
  async connect(
    initial = false,
    allowRestore = true
  ): Promise<IBaileysConnectionState> {
    this.initialConnection = initial;

    /* — já conectado — */
    if (this.connected) return this.reportConnected();

    /* — balanceamento de concorrência — */
    if (this.connecting) {
      if (initial)
        this.cancelAttempt(); // força abortar tentativa anterior
      else if (this.currentPromise) return this.currentPromise;
    }

    /* — restauração de sessão existente — */
    if (allowRestore && this.status === Status.initial && this.hasSession()) {
      return this.restoreWithRetries();
    }

    /* — inicia um novo ciclo — */
    this.prepareFolder();
    this.connecting = true;
    this.retryCount = 0; // zera contagem a cada novo ciclo
    this.socketId += 1; // gera nova “versão” de socket

    const { socket, saveCreds } = await this.createSocket();
    this.socket = socket;
    socket.ev.on('creds.update', saveCreds);

    this.currentPromise = this.wait(socket, this.socketId).finally(() => {
      this.connecting = false;
      this.currentPromise = undefined;
    });

    return this.currentPromise;
  }

  /* ---------------------------------------------------------------- */
  /*  DISCONNECT (manual)                                             */
  /* ---------------------------------------------------------------- */
  disconnect(initial = false): void {
    this.initialConnection = initial;

    this.cancelAttempt();
    this.safeLogout();
    this.clearFolder();

    console.log('BaileysConnectionService:', this.initialConnection);

    if (!this.initialConnection) return;

    this.setStatus(Status.disconnected, ECodeMessage.connectionClosed);
    this.publish({ status: this.status, code: this.code, worker_id: WORKER });

    this.connect(true); // dispara um novo ciclo
  }

  /* ================================================================ */
  /*  PRIVATE – criação / espera                                      */
  /* ================================================================ */
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

  /** Aguarda eventos do socket _apenas_ se pertencer à geração ativa. */
  private wait(socket: WASocket, id: number) {
    return new Promise<IBaileysConnectionState>((resolve) => {
      this.pendingResolve = resolve;
      let opened = false;

      socket.ev.on('connection.update', async (u: IBaileysUpdateEvent) => {
        if (id !== this.socketId) return; // <<< ignora gerações antigas

        const { qr, connection, isNewLogin, lastDisconnect } = u;

        console.dir(u, { depth: 3, colors: true });

        /* 1) novo login em andamento */
        if (isNewLogin) return this.onNewLoginAttempt();

        console.log('canShowQr:', this.canShowQr());

        /* 2) QR‑Code */
        if (qr && this.canShowQr()) return this.onQr(qr, resolve);

        /* 3) conexão aberta */
        if (connection === 'open' && !opened) {
          opened = true;
          this.retryCount = 0;
          return this.onOpen(resolve);
        }

        /* 4) conexão encerrada */
        if (connection === 'close')
          return this.onClose(lastDisconnect, resolve);
      });
    });
  }

  /* ================================================================ */
  /*  EVENT‑HANDLERS                                                  */
  /* ================================================================ */
  private async onQr(
    qr: string,
    resolve: (s: IBaileysConnectionState) => void
  ) {
    if (qr.slice(-20) === this.qrHash) return; // mesmo QR já tratado

    this.qrHash = qr.slice(-20);
    this.setStatus(Status.connecting, ECodeMessage.awaitingReadQrCode);

    const img = await QRCode.toDataURL(qr);
    this.publish({
      status: this.status,
      code: this.code,
      qrcode: img,
      worker_id: WORKER,
    });

    resolve(this.state(img));
    this.pendingResolve = undefined;
    this.initialConnection = false;
  }

  private onOpen(resolve: (s: IBaileysConnectionState) => void) {
    this.qrHash = undefined;
    this.setStatus(Status.connected, ECodeMessage.connectionEstablished);

    const phone = this.helpers.getPhoneNumber(this.socket?.user?.id);
    this.publish({
      status: this.status,
      code: this.code,
      worker_id: WORKER,
      phone,
    });

    resolve(this.state());
    this.pendingResolve = undefined;
  }

  private onClose(
    last: IBaileysUpdateEvent['lastDisconnect'],
    resolve: (s: IBaileysConnectionState) => void
  ) {
    const statusCode = (last?.error as any)?.output?.statusCode as
      | ECodeMessage
      | undefined;
    if (statusCode) this.setStatus(Status.disconnected, statusCode);

    this.publish({ status: this.status, code: this.code, worker_id: WORKER });

    if (statusCode === ECodeMessage.loggedOut) this.clearFolder();

    resolve(this.state());
    this.pendingResolve = undefined;

    /* reconexão controlada */
    if (this.retryCount < this.maxRetries) {
      setTimeout(() => {
        this.retryCount++;
        void this.connect(this.initialConnection).catch(() => {});
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

  /* ================================================================ */
  /*  INTERNOS UTILITÁRIOS                                             */
  /* ================================================================ */
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
        if (s.status === Status.connected) return s;
      } catch (e) {
        console.error(`Tentativa #${i + 1} falhou`, e);
      }
      await new Promise((r) => setTimeout(r, this.retryDelay));
    }
    this.setStatus(Status.disconnected, ECodeMessage.badSession);
    return this.state();
  }

  private publish(payload: Record<string, unknown>): void {
    if (!this.initialConnection) return;
    const data = JSON.stringify(payload);
    if (data === this.lastPayload) return;
    this.lastPayload = data;
    this.centrifugo.publish(CHANNEL, payload);
  }

  /* ---------------- logout / cancel helpers ----------------------- */
  /* ------------------------------------------------------------------ */
  /*  NOVA implementação de safeLogout – não explode se handshake < OPEN*/
  /* ------------------------------------------------------------------ */
  private safeLogout(): void {
    if (this.socket) {
      /* 1) encerra a sessão de forma “clean” se já existe user logado ----- */
      try {
        // .logout dispara .end internamente; por isso só chamamos
        // se o usuário já foi estabelecido (evita erro 440/401 p/ duplicidade)
        if (this.socket.user) {
          this.socket.logout().catch(() => null);
        }
      } catch {
        /* swallow */
      }
    }

    /* 2) garante que o transporte é finalizado ------------------------- */
    try {
      // acesso ao WebSocket interno utilizado pelo baileys
      const ws: import('ws').WebSocket | undefined = (this.socket as any).ws;
      if (!ws) return;

      switch (ws.readyState) {
        case ws.OPEN: // 1 – conexão estabelecida → close normal
          ws.close(1000, 'logout');
          break;

        case ws.CONNECTING: // 0 – handshake ainda pendente → terminate bruto
        case ws.CLOSING: // 2 – já fechando
          ws.terminate?.(); // encerra sem levantar exceção
          break;

        default: // 3 – CLOSED
          break;
      }
    } catch {
      /* swallow */
    }

    /* 3) limpa referências locais ------------------------------------- */
    this.socket = undefined;
    this.setStatus(Status.disconnected, ECodeMessage.loggedOut);
  }

  private cancelAttempt() {
    try {
      this.socket?.ev.removeAllListeners('connection.update');
    } catch {}
    this.safeLogout();
    this.pendingResolve?.(this.state());
    this.pendingResolve = undefined;
    this.currentPromise = undefined;
    this.connecting = false;
  }

  /* ---------------- misc ----------------------- */
  private reportConnected(): IBaileysConnectionState {
    if (this.initialConnection)
      this.publish({
        status: this.status,
        code: ECodeMessage.connectionEstablished,
        worker_id: WORKER,
      });
    return this.state();
  }

  private prepareFolder() {
    if (!fs.existsSync(FOLDER)) fs.mkdirSync(FOLDER, { recursive: true });
  }

  private clearFolder() {
    fs.readdirSync(FOLDER).forEach((f) =>
      fs.rmSync(path.join(FOLDER, f), { recursive: true, force: true })
    );
  }

  private setStatus(s: Status, c?: ECodeMessage) {
    this.status = s;
    if (c) this.code = c;
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
    this.publish({ status: this.status, code: this.code, worker_id: WORKER });
  }
}
