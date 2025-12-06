import { webhook } from './methods/webhook';
import { nfseWebhook } from './methods/nfseWebhook';

export default class WebhookController {
  webhook = webhook;
  nfseWebhook = nfseWebhook;
}
