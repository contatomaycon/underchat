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

let centrifugeClient: Centrifuge | null = null;

const generateTokenAndUrl = async (): Promise<AuthTokenResponse> => {
  const response = await axios.post<IApiResponse<AuthTokenResponse>>(
    `/centrifugo/auth/token`
  );

  const data = response?.data;

  if (!data?.status) {
    throw new Error(data?.message || 'Failed to generate Centrifugo token');
  }

  return data.data;
};

const generateToken = async (): Promise<string> => {
  const response = await axios.post<IApiResponse<AuthTokenResponse>>(
    `/centrifugo/auth/token`
  );

  const data = response?.data;

  if (!data?.status) {
    throw new Error(data?.message || 'Failed to generate Centrifugo token');
  }

  if (!data.data?.token) {
    throw new Error('Token is not available in the response');
  }

  return data.data.token;
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
