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
});
