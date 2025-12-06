import { webhook } from './methods/webhook';
import { invoiceWebhook } from './methods/invoiceWebhook';

export default class WebhookController {
  webhook = webhook;
  invoiceWebhook = invoiceWebhook;
}
