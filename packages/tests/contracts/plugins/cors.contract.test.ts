import fastify from 'fastify';
import corsPlugin from '@core/plugins/cors';

describe('cors plugin', () => {
  it('allows connection lifecycle debug trace header in browser preflight requests', async () => {
    const app = fastify();
    await app.register(corsPlugin);
    await app.ready();

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/worker/worker-id',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers':
          'authorization,x-client-platform,x-connection-lifecycle-debug-trace-id',
      },
    });

    const allowedHeaders = response.headers[
      'access-control-allow-headers'
    ] as string;

    expect(response.statusCode).toBe(204);
    expect(allowedHeaders.toLowerCase()).toContain(
      'x-connection-lifecycle-debug-trace-id'
    );

    await app.close();
  });

  it('allows the PUBLIC executor header in browser preflight requests', async () => {
    const app = fastify();
    await app.register(corsPlugin);
    await app.ready();

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/chat',
      headers: {
        origin: 'https://integration.example.com',
        'access-control-request-method': 'GET',
        'access-control-request-headers':
          'keyapi,x-underchat-user-id,content-type',
      },
    });
    const allowedHeaders = String(
      response.headers['access-control-allow-headers']
    ).toLowerCase();

    expect(response.statusCode).toBe(204);
    expect(allowedHeaders).toContain('keyapi');
    expect(allowedHeaders).toContain('x-underchat-user-id');

    await app.close();
  });

  it('allows cache-control headers in browser preflight requests', async () => {
    const app = fastify();
    await app.register(corsPlugin);
    await app.ready();

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/push/public-key',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'cache-control,pragma',
      },
    });
    const allowedHeaders = String(
      response.headers['access-control-allow-headers']
    ).toLowerCase();

    expect(response.statusCode).toBe(204);
    expect(allowedHeaders).toContain('cache-control');
    expect(allowedHeaders).toContain('pragma');

    await app.close();
  });
});
