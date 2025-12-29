import { invoiceWebhook } from './methods/invoiceWebhook';
import { nfseWebhook } from './methods/nfseWebhook';

export default class WebhookController {
  invoiceWebhook = invoiceWebhook;
  nfseWebhook = nfseWebhook;
}
