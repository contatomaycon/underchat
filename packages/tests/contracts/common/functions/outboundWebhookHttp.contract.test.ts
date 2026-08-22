import {
  dispatchOutboundWebhookHttp,
  isBlockedOutboundWebhookAddress,
  parseOutboundWebhookRetryAfter,
  validateOutboundWebhookUrl,
} from '@core/common/functions/outboundWebhookHttp';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

const listen = async (
  handler: RequestListener
): Promise<{
  port: number;
  close: () => Promise<void>;
}> => {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

const loopbackResolver = async () => [
  { address: '127.0.0.1', family: 4 as const },
];

const baseInput = {
  rawBody: Buffer.from('{"ok":true}', 'utf8'),
  signature: 'v1=abc123',
  unixTimestamp: 1_710_000_000,
  metadata: {
    event: 'chat.created',
    eventId: 'event-1',
    deliveryId: 'delivery-1',
    attempt: 2,
    webhookConfigVersion: 3,
  },
  isProduction: false,
  allowLocalhostHttp: true,
  dnsResolver: loopbackResolver,
};

describe('outbound webhook HTTP contract', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '224.0.0.1',
    '::1',
    '64:ff9b::a00:1',
    'fc00::1',
    'fd00:ec2::254',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
  ])('blocks non-public address %s', (address) => {
    expect(isBlockedOutboundWebhookAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'allows public address %s',
    (address) => {
      expect(isBlockedOutboundWebhookAddress(address)).toBe(false);
    }
  );

  it('requires HTTPS port 443 in production and forbids URL credentials', () => {
    expect(() =>
      validateOutboundWebhookUrl({
        url: 'https://example.com:8443/hook',
        isProduction: true,
        allowLocalhostHttp: false,
      })
    ).toThrow('port 443');
    expect(() =>
      validateOutboundWebhookUrl({
        url: 'https://user:secret@example.com/hook',
        isProduction: true,
        allowLocalhostHttp: false,
      })
    ).toThrow('credentials are forbidden');
  });

  it('allows HTTP only for explicitly enabled localhost development', () => {
    expect(() =>
      validateOutboundWebhookUrl({
        url: 'http://localhost:3000/hook',
        isProduction: false,
        allowLocalhostHttp: false,
      })
    ).toThrow('localhost development');

    expect(
      validateOutboundWebhookUrl({
        url: 'http://localhost:3000/hook',
        isProduction: false,
        allowLocalhostHttp: true,
      }).allowsLoopback
    ).toBe(true);
  });

  it('validates every DNS answer and refuses mixed public/private results', async () => {
    const result = await dispatchOutboundWebhookHttp({
      ...baseInput,
      url: 'https://example.com/hook',
      dnsResolver: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
    });

    expect(result).toMatchObject({
      kind: 'failure',
      code: 'dns_blocked_address',
      retryable: false,
    });
  });

  it('includes DNS resolution in the request timeout budget', async () => {
    const result = await dispatchOutboundWebhookHttp({
      ...baseInput,
      url: 'https://example.com/hook',
      timeoutMs: 25,
      dnsResolver: () => new Promise(() => undefined),
    });

    expect(result).toMatchObject({
      kind: 'failure',
      code: 'timeout',
      retryable: true,
      isTimeout: true,
    });
  });

  it('pins the validated address, sends only signed metadata, and preserves raw bytes', async () => {
    let receivedBody = Buffer.alloc(0);
    let receivedHeaders: Record<string, string | string[] | undefined> = {};
    const endpoint = await listen((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        receivedBody = Buffer.concat(chunks);
        receivedHeaders = request.headers;
        response.writeHead(204);
        response.end();
      });
    });

    try {
      const result = await dispatchOutboundWebhookHttp({
        ...baseInput,
        url: `http://localhost:${endpoint.port}/hook`,
      });

      expect(result).toMatchObject({ kind: 'response', statusCode: 204 });
      expect(receivedBody).toEqual(baseInput.rawBody);
      expect(receivedHeaders).toMatchObject({
        'x-underchat-signature': 'v1=abc123',
        'x-underchat-timestamp': '1710000000',
        'x-underchat-event': 'chat.created',
        'x-underchat-event-id': 'event-1',
        'x-underchat-delivery-id': 'delivery-1',
        'x-underchat-attempt': '2',
        'x-underchat-webhook-config-version': '3',
      });
      expect(receivedHeaders.authorization).toBeUndefined();
      expect(receivedHeaders['x-underchat-secret']).toBeUndefined();
    } finally {
      await endpoint.close();
    }
  });

  it('does not follow redirects', async () => {
    let requests = 0;
    const endpoint = await listen((_request, response) => {
      requests += 1;
      response.writeHead(302, { Location: '/redirected' });
      response.end('redirect');
    });

    try {
      const result = await dispatchOutboundWebhookHttp({
        ...baseInput,
        url: `http://localhost:${endpoint.port}/hook`,
      });

      expect(result).toMatchObject({ kind: 'response', statusCode: 302 });
      expect(requests).toBe(1);
    } finally {
      await endpoint.close();
    }
  });

  it('caps response bodies at 64 KiB', async () => {
    const endpoint = await listen((_request, response) => {
      response.writeHead(200);
      response.end(Buffer.alloc(64 * 1024 + 1, 97));
    });

    try {
      const result = await dispatchOutboundWebhookHttp({
        ...baseInput,
        url: `http://localhost:${endpoint.port}/hook`,
      });

      expect(result).toMatchObject({
        kind: 'failure',
        code: 'response_too_large',
        retryable: true,
      });
    } finally {
      await endpoint.close();
    }
  });

  it('enforces a wall-clock request timeout', async () => {
    const endpoint = await listen(() => undefined);

    try {
      const result = await dispatchOutboundWebhookHttp({
        ...baseInput,
        url: `http://localhost:${endpoint.port}/hook`,
        timeoutMs: 25,
      });

      expect(result).toMatchObject({
        kind: 'failure',
        code: 'timeout',
        retryable: true,
        isTimeout: true,
      });
    } finally {
      await endpoint.close();
    }
  });

  it('honors seconds and date Retry-After values with a 24-hour cap', () => {
    const now = Date.parse('2026-07-10T12:00:00.000Z');
    expect(parseOutboundWebhookRetryAfter('90', now)).toBe(90_000);
    expect(
      parseOutboundWebhookRetryAfter('Sat, 11 Jul 2026 12:00:00 GMT', now)
    ).toBe(24 * 60 * 60 * 1000);
    expect(parseOutboundWebhookRetryAfter('invalid', now)).toBeNull();
  });
});
