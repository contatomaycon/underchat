import {
  executeSafeOutboundHttp,
  type SafeOutboundHttpDnsResolver,
} from '@core/common/functions/safeOutboundHttp';
import { validateOutboundWebhookUrl } from '@core/common/functions/outboundWebhookHttp';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

describe('safe outbound HTTP localhost contract', () => {
  it.each(['127.0.0.1', '[::1]', '[::ffff:127.0.0.1]'])(
    'requires the explicit development opt-in for loopback literal %s',
    (hostname) => {
      const url = `http://${hostname}:3000/resource`;

      expect(
        validateOutboundWebhookUrl({
          url,
          isProduction: false,
          allowLocalhostHttp: true,
        }).allowsLoopback
      ).toBe(true);
      expect(() =>
        validateOutboundWebhookUrl({
          url,
          isProduction: false,
          allowLocalhostHttp: false,
        })
      ).toThrow('localhost development');
    }
  );

  it('rejects localhost DNS rebinding on a redirect before opening the next socket', async () => {
    let requestCount = 0;
    const server = createServer((_request, response) => {
      requestCount += 1;
      response.writeHead(302, { Location: '/redirected' });
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    const dnsResolver = jest
      .fn<
        ReturnType<SafeOutboundHttpDnsResolver>,
        Parameters<SafeOutboundHttpDnsResolver>
      >()
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);

    try {
      const result = await executeSafeOutboundHttp({
        url: `http://localhost:${address.port}/start`,
        method: 'GET',
        isProduction: false,
        allowLocalhostHttp: true,
        timeoutMs: 1_000,
        dnsResolver,
      });

      expect(result).toMatchObject({
        kind: 'failure',
        code: 'dns_non_loopback_address',
        retryable: false,
      });
      expect(dnsResolver).toHaveBeenCalledTimes(2);
      expect(requestCount).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  });
});
