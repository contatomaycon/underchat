import jwt from 'jsonwebtoken';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import {
  Centrifuge,
  PublicationContext,
  State,
  Subscription,
  SubscriptionState,
  PublishResult,
} from 'centrifuge';

let centrifugeClient: Centrifuge | null = null;

const generateToken = async (): Promise<string> => {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  const secret = import.meta.env.VITE_CENTRIFUGO_HMAC_SECRET_KEY;

  return jwt.sign({ sub: ERouteModule.web, exp }, secret, {
    algorithm: 'HS256',
  });
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

  const secret = import.meta.env.VITE_CENTRIFUGO_HMAC_SECRET_KEY;
  const url = import.meta.env.VITE_CENTRIFUGO_WS_URL;

  if (!secret) throw new Error('Centrifugo HMAC secret key is not defined');
  if (!url) throw new Error('Centrifugo WebSocket URL is not defined');

  const initialToken = await generateToken();

  centrifugeClient = new Centrifuge(`${url}/connection/websocket`, {
    websocket: WebSocket,
    token: initialToken,
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
  handler: (data: unknown, ctx: PublicationContext) => void
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
