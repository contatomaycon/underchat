import { validateOutboundWebhookUrl } from '@core/common/functions/outboundWebhookHttp';
import { executeSafeOutboundHttp } from '@core/common/functions/safeOutboundHttp';
import { getChatbotApiOutboundHttpPolicy } from '@core/common/functions/chatbotApiOutboundHttpPolicy';

const originalAppEnvironment = process.env.APP_ENVIRONMENT;
const originalLocalhostFlag =
  process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP;

describe('Chatbot API outbound HTTP policy', () => {
  afterEach(() => {
    if (originalAppEnvironment === undefined) {
      delete process.env.APP_ENVIRONMENT;
    } else {
      process.env.APP_ENVIRONMENT = originalAppEnvironment;
    }
    if (originalLocalhostFlag === undefined) {
      delete process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP;
    } else {
      process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP =
        originalLocalhostFlag;
    }
  });

  it.each([
    ['LOCAL', undefined, false],
    ['LOCAL', 'false', false],
    ['LOCAL', '1', false],
    ['LOCAL', 'TRUE', true],
    ['LOCAL', 'true', true],
    ['DEV', 'true', true],
    ['HMG', 'true', false],
    ['PROD', 'true', false],
  ] as const)(
    'resolves APP_ENVIRONMENT=%s and flag=%s to localhost=%s',
    (appEnvironment, flag, expected) => {
      process.env.APP_ENVIRONMENT = appEnvironment;
      if (flag === undefined) {
        delete process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP;
      } else {
        process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP = flag;
      }

      expect(getChatbotApiOutboundHttpPolicy().allowLocalhostHttp).toBe(
        expected
      );
    }
  );

  it('keeps the localhost exception restricted to loopback addresses', async () => {
    process.env.APP_ENVIRONMENT = 'LOCAL';
    process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP = 'true';
    const policy = getChatbotApiOutboundHttpPolicy();

    expect(
      validateOutboundWebhookUrl({
        url: 'http://localhost:3000/resource',
        ...policy,
      }).allowsLoopback
    ).toBe(true);
    expect(
      validateOutboundWebhookUrl({
        url: 'https://api.example.com/resource',
        ...policy,
      }).allowsLoopback
    ).toBe(false);

    const privateHttp = await executeSafeOutboundHttp({
      url: 'http://10.0.0.5/resource',
      method: 'GET',
      ...policy,
    });
    expect(privateHttp).toMatchObject({
      kind: 'failure',
      code: 'http_forbidden',
    });

    const reservedHttps = await executeSafeOutboundHttp({
      url: 'https://service.example/resource',
      method: 'GET',
      ...policy,
      dnsResolver: async () => [{ address: '10.0.0.5', family: 4 }],
    });
    expect(reservedHttps).toMatchObject({
      kind: 'failure',
      code: 'dns_blocked_address',
    });
  });
});
