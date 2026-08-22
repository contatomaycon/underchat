import {
  executeSafeOutboundHttp,
  SAFE_OUTBOUND_HTTP_MAX_REDIRECTS,
  SAFE_OUTBOUND_HTTP_MAX_RESPONSE_BYTES,
  type ExecuteSafeOutboundHttpInput,
  type SafeOutboundHttpMethod,
} from '@core/common/functions/safeOutboundHttp';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

const listen = async (
  handler: RequestListener
): Promise<{
  origin: string;
  close: () => Promise<void>;
}> => {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    origin: `http://localhost:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
};

const loopbackResolver = async () => [
  { address: '127.0.0.1', family: 4 as const },
];

const baseInput = (
  url: string,
  overrides: Partial<ExecuteSafeOutboundHttpInput> = {}
): ExecuteSafeOutboundHttpInput => ({
  url,
  method: 'GET',
  isProduction: false,
  allowLocalhostHttp: true,
  timeoutMs: 1_000,
  responseLimitBytes: 64 * 1024,
  dnsResolver: loopbackResolver,
  ...overrides,
});

const readBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const endJson = (response: ServerResponse, body: unknown): void => {
  response.writeHead(200, {
    'Content-Type': 'application/json',
    'X-Response-Id': 'response-1',
    'Set-Cookie': ['a=1', 'b=2'],
  });
  response.end(JSON.stringify(body));
};

describe('safe outbound HTTP contract', () => {
  it.each<SafeOutboundHttpMethod>([
    'GET',
    'HEAD',
    'OPTIONS',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
  ])(
    'supports %s with pinned DNS and bounded binary responses',
    async (method) => {
      let receivedMethod = '';
      let receivedBody: Buffer = Buffer.alloc(0);
      const endpoint = await listen(async (request, response) => {
        receivedMethod = request.method ?? '';
        receivedBody = await readBody(request);
        endJson(response, { method });
      });

      try {
        const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
          ? Buffer.from([0, 1, 2, 255])
          : undefined;
        const result = await executeSafeOutboundHttp(
          baseInput(`${endpoint.origin}/methods`, { method, body })
        );

        expect(result).toMatchObject({
          kind: 'response',
          statusCode: 200,
          redirectCount: 0,
        });
        expect(receivedMethod).toBe(method);
        expect(receivedBody).toEqual(body ?? Buffer.alloc(0));
        if (result.kind === 'response') {
          expect(Buffer.isBuffer(result.body)).toBe(true);
          expect(result.headers['content-type']).toBe('application/json');
          expect(result.headers['x-response-id']).toBe('response-1');
          expect(result.headers['set-cookie']).toEqual(['a=1', 'b=2']);
        }
      } finally {
        await endpoint.close();
      }
    }
  );

  it('sends validated custom headers and computes content-length itself', async () => {
    let receivedHeaders: IncomingMessage['headers'] = {};
    const endpoint = await listen(async (request, response) => {
      receivedHeaders = request.headers;
      await readBody(request);
      response.writeHead(204);
      response.end();
    });

    try {
      const result = await executeSafeOutboundHttp(
        baseInput(`${endpoint.origin}/headers`, {
          method: 'POST',
          body: 'hello',
          headers: {
            Authorization: 'Bearer token',
            'Content-Type': 'text/plain',
            'X-Trace-Id': 'trace-1',
          },
        })
      );

      expect(result).toMatchObject({ kind: 'response', statusCode: 204 });
      expect(receivedHeaders).toMatchObject({
        authorization: 'Bearer token',
        'content-length': '5',
        'content-type': 'text/plain',
        'x-trace-id': 'trace-1',
      });
    } finally {
      await endpoint.close();
    }
  });

  it.each([
    ['Host', 'example.org'],
    ['Content-Length', '999'],
    ['Connection', 'keep-alive'],
    ['Forwarded', 'for=127.0.0.1'],
    ['Proxy-Foo', 'bar'],
    ['X-Underchat-Secret', 'secret'],
  ])('rejects forbidden request header %s', async (name, value) => {
    const result = await executeSafeOutboundHttp({
      ...baseInput('http://localhost:1234/header'),
      headers: { [name]: value },
    });

    expect(result).toMatchObject({
      kind: 'failure',
      code: 'forbidden_header',
      retryable: false,
    });
  });

  it('rejects header injection without echoing the secret value', async () => {
    const secret = 'secret-value\r\nX-Evil: injected';
    const result = await executeSafeOutboundHttp({
      ...baseInput('http://localhost:1234/header'),
      headers: { 'X-Test': secret },
    });

    expect(result).toMatchObject({
      kind: 'failure',
      code: 'invalid_header_value',
    });
    if (result.kind === 'failure') {
      expect(result.message).not.toContain(secret);
    }
  });

  it('enforces HTTPS port 443 in production and explicit localhost HTTP in development', async () => {
    const production = await executeSafeOutboundHttp({
      ...baseInput('https://example.com:8443/private'),
      isProduction: true,
      allowLocalhostHttp: false,
    });
    const development = await executeSafeOutboundHttp({
      ...baseInput('http://localhost:3000/private'),
      allowLocalhostHttp: false,
    });

    expect(production).toMatchObject({
      kind: 'failure',
      code: 'port_forbidden',
    });
    expect(development).toMatchObject({
      kind: 'failure',
      code: 'http_forbidden',
    });
  });

  it('validates every DNS answer and rejects mixed public/private results', async () => {
    const result = await executeSafeOutboundHttp({
      ...baseInput('https://example.com/resource'),
      isProduction: true,
      allowLocalhostHttp: false,
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

  it('revalidates DNS on redirects and strips cross-origin credentials', async () => {
    let redirectedHeaders: IncomingMessage['headers'] = {};
    const target = await listen((request, response) => {
      redirectedHeaders = request.headers;
      response.writeHead(200);
      response.end('done');
    });
    const source = await listen((_request, response) => {
      response.writeHead(307, { Location: `${target.origin}/target` });
      response.end();
    });
    const resolver = jest.fn(loopbackResolver);

    try {
      const result = await executeSafeOutboundHttp(
        baseInput(`${source.origin}/source`, {
          headers: {
            Authorization: 'Bearer secret',
            'X-Api-Key': 'api-secret',
            'X-Custom-Credential': 'custom-secret',
            'X-Trace-Id': 'trace-1',
          },
          sensitiveHeaderNames: ['x-custom-credential'],
          dnsResolver: resolver,
        })
      );

      expect(result).toMatchObject({
        kind: 'response',
        statusCode: 200,
        redirectCount: 1,
      });
      expect(resolver).toHaveBeenCalledTimes(2);
      expect(redirectedHeaders.authorization).toBeUndefined();
      expect(redirectedHeaders['x-api-key']).toBeUndefined();
      expect(redirectedHeaders['x-custom-credential']).toBeUndefined();
      expect(redirectedHeaders['x-trace-id']).toBe('trace-1');
    } finally {
      await source.close();
      await target.close();
    }
  });

  it('follows standard 303 semantics by switching to GET and dropping body headers', async () => {
    let redirectedMethod = '';
    let redirectedBody: Buffer = Buffer.alloc(0);
    let redirectedContentType: string | undefined;
    const endpoint = await listen(async (request, response) => {
      if (request.url === '/start') {
        await readBody(request);
        response.writeHead(303, { Location: '/finish' });
        response.end();
        return;
      }

      redirectedMethod = request.method ?? '';
      redirectedBody = await readBody(request);
      redirectedContentType = request.headers['content-type'];
      response.writeHead(200);
      response.end('done');
    });

    try {
      const result = await executeSafeOutboundHttp(
        baseInput(`${endpoint.origin}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"ok":true}',
        })
      );

      expect(result).toMatchObject({ kind: 'response', redirectCount: 1 });
      expect(redirectedMethod).toBe('GET');
      expect(redirectedBody).toEqual(Buffer.alloc(0));
      expect(redirectedContentType).toBeUndefined();
    } finally {
      await endpoint.close();
    }
  });

  it('follows at most three redirects', async () => {
    let requestCount = 0;
    const endpoint = await listen((request, response) => {
      requestCount += 1;
      const current = Number(request.url?.slice(1) ?? 0);
      response.writeHead(302, { Location: `/${current + 1}` });
      response.end();
    });

    try {
      const result = await executeSafeOutboundHttp(
        baseInput(`${endpoint.origin}/0`)
      );

      expect(result).toMatchObject({
        kind: 'failure',
        code: 'too_many_redirects',
      });
      expect(SAFE_OUTBOUND_HTTP_MAX_REDIRECTS).toBe(3);
      expect(requestCount).toBe(4);
    } finally {
      await endpoint.close();
    }
  });

  it('stops streaming once the configured response limit is exceeded', async () => {
    const endpoint = await listen((_request, response) => {
      response.writeHead(200);
      response.end(Buffer.alloc(33, 97));
    });

    try {
      const result = await executeSafeOutboundHttp(
        baseInput(`${endpoint.origin}/large`, { responseLimitBytes: 32 })
      );

      expect(result).toMatchObject({
        kind: 'failure',
        code: 'response_too_large',
      });
      expect(SAFE_OUTBOUND_HTTP_MAX_RESPONSE_BYTES).toBe(16 * 1024 * 1024);
    } finally {
      await endpoint.close();
    }
  });

  it('includes DNS and response streaming in one wall-clock timeout', async () => {
    const dnsTimeout = await executeSafeOutboundHttp({
      ...baseInput('https://example.com/resource'),
      timeoutMs: 20,
      dnsResolver: () => new Promise(() => undefined),
    });
    const endpoint = await listen(() => undefined);

    try {
      const requestTimeout = await executeSafeOutboundHttp(
        baseInput(`${endpoint.origin}/slow`, { timeoutMs: 20 })
      );

      expect(dnsTimeout).toMatchObject({
        kind: 'failure',
        code: 'timeout',
        isTimeout: true,
        retryable: true,
      });
      expect(requestTimeout).toMatchObject({
        kind: 'failure',
        code: 'timeout',
        isTimeout: true,
        retryable: true,
      });
    } finally {
      await endpoint.close();
    }
  });

  it('sanitizes resolver and network failures', async () => {
    const dnsSecret = 'https://token:secret@example.com/private?key=value';
    const result = await executeSafeOutboundHttp({
      ...baseInput('https://example.com/resource'),
      dnsResolver: async () => {
        throw new Error(dnsSecret);
      },
    });

    expect(result).toMatchObject({
      kind: 'failure',
      code: 'dns_error',
      retryable: true,
    });
    if (result.kind === 'failure') {
      expect(result.message).not.toContain(dnsSecret);
      expect(result.message).not.toContain('secret');
    }
  });
});
