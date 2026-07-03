import fastify from 'fastify';
import { captureRawBodyPreParsingHook } from '@core/common/functions/captureRawBodyPreParsingHook';

describe('captureRawBodyPreParsingHook', () => {
  it('preserves the exact raw body while allowing Fastify to parse JSON', async () => {
    const app = fastify();
    const payload = '{"b":2,"a":1}';

    app.post(
      '/webhook',
      { preParsing: captureRawBodyPreParsingHook },
      async (request) => ({
        body: request.body,
        rawBody: request.rawBody?.toString('utf8'),
      })
    );

    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      body: { b: 2, a: 1 },
      rawBody: payload,
    });

    await app.close();
  });
});
