import net from 'node:net';
import tls from 'node:tls';
import { injectable } from 'tsyringe';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';

export interface ProxyConnectivityConfig {
  protocol?: EProxyProtocol;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

export interface ProxyConnectivityResult {
  status: 'healthy' | 'unhealthy';
  error_code?: string;
  http_status?: number;
}

interface ConnectOptions {
  timeoutMs?: number;
  targetHost?: string;
  targetPort?: number;
}

@injectable()
export class ProxyConnectivityService {
  async check(
    proxy: ProxyConnectivityConfig,
    options: ConnectOptions = {}
  ): Promise<ProxyConnectivityResult> {
    const timeoutMs = options.timeoutMs ?? 5_000;
    const targetHost = options.targetHost ?? 'web.whatsapp.com';
    const targetPort = options.targetPort ?? 443;
    const protocol = proxy.protocol ?? EProxyProtocol.http;

    if (!proxy.host || !Number.isFinite(proxy.port) || proxy.port <= 0) {
      return { status: 'unhealthy', error_code: 'invalid_proxy_config' };
    }

    if (protocol === EProxyProtocol.http || protocol === EProxyProtocol.https) {
      return this.checkHttpConnectProxy(
        proxy,
        protocol,
        targetHost,
        targetPort,
        timeoutMs
      );
    }

    return this.checkTcpReachable(proxy, timeoutMs);
  }

  private checkTcpReachable(
    proxy: ProxyConnectivityConfig,
    timeoutMs: number
  ): Promise<ProxyConnectivityResult> {
    return new Promise((resolve) => {
      const socket = net.createConnection({
        host: proxy.host,
        port: proxy.port,
      });
      let settled = false;

      const settle = (result: ProxyConnectivityResult) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => settle({ status: 'healthy' }));
      socket.once('timeout', () =>
        settle({ status: 'unhealthy', error_code: 'timeout' })
      );
      socket.once('error', (error: NodeJS.ErrnoException) =>
        settle({
          status: 'unhealthy',
          error_code: this.errorCodeFromNodeError(error),
        })
      );
    });
  }

  private checkHttpConnectProxy(
    proxy: ProxyConnectivityConfig,
    protocol: EProxyProtocol,
    targetHost: string,
    targetPort: number,
    timeoutMs: number
  ): Promise<ProxyConnectivityResult> {
    return new Promise((resolve) => {
      const connectOptions = {
        host: proxy.host,
        port: proxy.port,
        servername: proxy.host,
      };
      const socket =
        protocol === EProxyProtocol.https
          ? tls.connect(connectOptions)
          : net.createConnection(connectOptions);
      let settled = false;
      let buffer = '';

      const settle = (result: ProxyConnectivityResult) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      if (protocol === EProxyProtocol.http) {
        socket.once('connect', () => {
          socket.write(
            this.buildConnectRequest(proxy, targetHost, targetPort),
            'utf8'
          );
        });
      }
      if (protocol === EProxyProtocol.https) {
        socket.once('secureConnect', () => {
          socket.write(
            this.buildConnectRequest(proxy, targetHost, targetPort),
            'utf8'
          );
        });
      }
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        if (!buffer.includes('\r\n')) {
          return;
        }

        const statusLine = buffer.split('\r\n', 1)[0] ?? '';
        const status = Number.parseInt(statusLine.split(/\s+/u)[1] ?? '', 10);
        if (!Number.isFinite(status)) {
          settle({ status: 'unhealthy', error_code: 'invalid_proxy_response' });
          return;
        }

        if (status >= 200 && status < 300) {
          settle({ status: 'healthy', http_status: status });
          return;
        }

        settle({
          status: 'unhealthy',
          error_code: status === 407 ? 'auth_failed' : 'connect_rejected',
          http_status: status,
        });
      });
      socket.once('timeout', () =>
        settle({ status: 'unhealthy', error_code: 'timeout' })
      );
      socket.once('error', (error: NodeJS.ErrnoException) =>
        settle({
          status: 'unhealthy',
          error_code: this.errorCodeFromNodeError(error),
        })
      );
    });
  }

  private buildConnectRequest(
    proxy: ProxyConnectivityConfig,
    targetHost: string,
    targetPort: number
  ): string {
    const headers = [
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
      `Host: ${targetHost}:${targetPort}`,
      'Proxy-Connection: keep-alive',
    ];

    if (proxy.username && proxy.password) {
      const token = Buffer.from(
        `${proxy.username}:${proxy.password}`,
        'utf8'
      ).toString('base64');
      headers.push(`Proxy-Authorization: Basic ${token}`);
    }

    return `${headers.join('\r\n')}\r\n\r\n`;
  }

  private errorCodeFromNodeError(error: NodeJS.ErrnoException): string {
    switch (error.code) {
      case 'ECONNREFUSED':
        return 'connect_refused';
      case 'ETIMEDOUT':
      case 'ESOCKETTIMEDOUT':
        return 'timeout';
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return 'dns_failed';
      case 'ECONNRESET':
        return 'connection_reset';
      default:
        return error.code?.toLowerCase() || 'unknown';
    }
  }
}
