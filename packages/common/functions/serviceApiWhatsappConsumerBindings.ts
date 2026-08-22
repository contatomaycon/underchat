export interface ServiceApiWhatsappConsumerBinding {
  groupId: string;
  topic: string;
}

/** Stable consumer groups used by the durable Service API WhatsApp pipeline. */
export const SERVICE_API_WHATSAPP_CONSUMER_BINDINGS = Object.freeze([
  Object.freeze({
    groupId: 'group-underchat-message-update',
    topic: 'update.message',
  }),
  Object.freeze({
    groupId: 'group-underchat-message-upsert',
    topic: 'upsert.message',
  }),
  Object.freeze({
    groupId: 'group-underchat-message-history-sync',
    topic: 'upsert.message.history',
  }),
  Object.freeze({
    groupId: 'group-underchat-message-status-update',
    topic: 'update.message.status',
  }),
  Object.freeze({
    groupId: 'group-underchat-chat-summary-clear',
    topic: 'clear.chat.summary',
  }),
  Object.freeze({
    groupId: 'group-underchat-notification-message',
    topic: 'notification.message',
  }),
  Object.freeze({
    groupId: 'group-underchat-official-whatsapp-send',
    topic: 'official.whatsapp.send.message',
  }),
  Object.freeze({
    groupId: 'group-underchat-official-whatsapp-webhook',
    topic: 'official.whatsapp.webhook.event',
  }),
  Object.freeze({
    groupId: 'group-underchat-schedule-status-update',
    topic: 'schedule.status.update',
  }),
  Object.freeze({
    groupId: 'group-underchat-user-phone-jid-update',
    topic: 'user.phone.jid.update',
  }),
  Object.freeze({
    groupId: 'group-underchat-phone-validation-response',
    topic: 'phone.validation.response',
  }),
  Object.freeze({
    groupId: 'group-underchat-contact-validation-update',
    topic: 'contact.validation.update',
  }),
  Object.freeze({
    groupId: 'group-underchat-profile-status-external-id-update',
    topic: 'update.profile.status.external.id',
  }),
] as const satisfies readonly ServiceApiWhatsappConsumerBinding[]);

export const SERVICE_API_WHATSAPP_CONSUMER_GROUPS = Object.freeze(
  SERVICE_API_WHATSAPP_CONSUMER_BINDINGS.map((binding) => binding.groupId)
);

const serviceApiWhatsappConsumerGroupByTopic = new Map<string, string>(
  SERVICE_API_WHATSAPP_CONSUMER_BINDINGS.map((binding) => [
    binding.topic,
    binding.groupId,
  ])
);

export function resolveServiceApiWhatsappConsumerGroupId(
  topic: string
): string {
  const groupId = serviceApiWhatsappConsumerGroupByTopic.get(topic.trim());
  if (!groupId) {
    throw new Error(
      `No Service API WhatsApp consumer group is registered for topic ${topic}`
    );
  }
  return groupId;
}

export const SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS = Object.freeze({
  messageUpdate: resolveServiceApiWhatsappConsumerGroupId('update.message'),
  messageUpsert: resolveServiceApiWhatsappConsumerGroupId('upsert.message'),
  messageHistorySync: resolveServiceApiWhatsappConsumerGroupId(
    'upsert.message.history'
  ),
  messageStatusUpdate: resolveServiceApiWhatsappConsumerGroupId(
    'update.message.status'
  ),
  chatSummaryClear:
    resolveServiceApiWhatsappConsumerGroupId('clear.chat.summary'),
  notificationMessage: resolveServiceApiWhatsappConsumerGroupId(
    'notification.message'
  ),
  officialWhatsappSend: resolveServiceApiWhatsappConsumerGroupId(
    'official.whatsapp.send.message'
  ),
  officialWhatsappWebhook: resolveServiceApiWhatsappConsumerGroupId(
    'official.whatsapp.webhook.event'
  ),
  scheduleStatusUpdate: resolveServiceApiWhatsappConsumerGroupId(
    'schedule.status.update'
  ),
  userPhoneJidUpdate: resolveServiceApiWhatsappConsumerGroupId(
    'user.phone.jid.update'
  ),
  phoneValidationResponse: resolveServiceApiWhatsappConsumerGroupId(
    'phone.validation.response'
  ),
  contactValidationUpdate: resolveServiceApiWhatsappConsumerGroupId(
    'contact.validation.update'
  ),
  profileStatusExternalIdUpdate: resolveServiceApiWhatsappConsumerGroupId(
    'update.profile.status.external.id'
  ),
});
