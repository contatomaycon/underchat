import {
  Centrifuge,
  PublicationContext,
  State,
  Subscription,
  SubscriptionState,
  PublishResult,
} from 'centrifuge';
import axios from '@webcore/axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { AuthTokenResponse } from '@core/schema/centrifugo/token/response.schema';

export type { Subscription };

let centrifugeClient: Centrifuge | null = null;
let tokenGenerationPromise: Promise<AuthTokenResponse> | null = null;

const generateTokenAndUrl = async (): Promise<AuthTokenResponse> => {
  if (tokenGenerationPromise) {
    return tokenGenerationPromise;
  }

  tokenGenerationPromise = (async () => {
    try {
      const response = await axios.post<IApiResponse<AuthTokenResponse>>(
        `/centrifugo/auth/token`
      );

      const data = response?.data;

      if (!data?.status) {
        throw new Error(data?.message ?? 'Failed to generate Centrifugo token');
      }

      return data.data;
    } finally {
      tokenGenerationPromise = null;
    }
  })();

  return tokenGenerationPromise;
};

const generateToken = async (): Promise<string> => {
  const tokenData = await generateTokenAndUrl();

  if (!tokenData?.token) {
    throw new Error('Token is not available in the response');
  }

  return tokenData.token;
};

const waitForConnected = (client: Centrifuge): Promise<void> => {
  if (client.state === State.Connected) return Promise.resolve();

  return new Promise((resolve) => {
    const handler = () => {
      client.off('connected', handler);

      resolve();
    };

    client.on('connected', handler);
  });
};

const getConnection = async (): Promise<Centrifuge> => {
  if (centrifugeClient) {
    await waitForConnected(centrifugeClient);

    return centrifugeClient;
  }

  const { token, url: wsUrl } = await generateTokenAndUrl();

  centrifugeClient = new Centrifuge(`${wsUrl}/connection/websocket`, {
    websocket: WebSocket,
    token,
    getToken: generateToken,
    timeout: 30000,
    maxServerPingDelay: 60000,
  });

  centrifugeClient.connect();

  await waitForConnected(centrifugeClient);

  return centrifugeClient;
};

export const onMessage = async (
  channel: string,
  handler: (data: any, ctx: PublicationContext) => void
): Promise<Subscription> => {
  const client = await getConnection();
  const sub =
    client.getSubscription(channel) ?? client.newSubscription(channel);

  sub.removeAllListeners('publication');
  sub.on('publication', (ctx) => handler(ctx.data, ctx));

  if (sub.state !== SubscriptionState.Subscribed) {
    sub.subscribe();
  }

  return sub;
};

export const publish = async (
  channel: string,
  data: unknown
): Promise<PublishResult> => {
  const client = await getConnection();

  return client.publish(channel, data);
};

export const unsubscribe = async (channel: string): Promise<void> => {
  const client = await getConnection();
  const sub = client.getSubscription(channel);

  if (sub && sub.state !== SubscriptionState.Unsubscribed) {
    sub.unsubscribe();
  }
};

export const resetConnection = (): void => {
  if (centrifugeClient) {
    try {
      centrifugeClient.disconnect();
    } catch (error) {
      console.warn('Error disconnecting Centrifugo client', error);
    }
    centrifugeClient = null;
  }
  tokenGenerationPromise = null;
};
