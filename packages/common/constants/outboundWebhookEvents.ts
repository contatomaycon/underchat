import { EChatStatus } from '@core/common/enums/EChatStatus';
import { isChatbotStatus } from '@core/common/functions/chatStatus';

export const OUTBOUND_WEBHOOK_MAX_ENDPOINTS_PER_ACCOUNT = 25;

export const OUTBOUND_WEBHOOK_EVENT_CATALOG = [
  {
    type: 'chat.created',
    group: 'chat_lifecycle',
    selectable: true,
    description:
      'A customer chat was created with its initial canonical state.',
  },
  {
    type: 'chat.queued',
    group: 'chat_lifecycle',
    selectable: true,
    description:
      'A chat entered the human attendance queue, including its initial state.',
  },
  {
    type: 'chat.attended',
    group: 'chat_lifecycle',
    selectable: true,
    description: 'A chat was created for or accepted by a primary attendant.',
  },
  {
    type: 'chat.joined',
    group: 'chat_lifecycle',
    selectable: true,
    description: 'An additional attendant joined an active chat.',
  },
  {
    type: 'chat.left',
    group: 'chat_lifecycle',
    selectable: true,
    description: 'An additional attendant left an active chat.',
  },
  {
    type: 'chat.transferred',
    group: 'chat_lifecycle',
    selectable: true,
    description:
      'A chat was transferred to another attendant, sector, channel, or automation.',
  },
  {
    type: 'chat.closed',
    group: 'chat_lifecycle',
    selectable: true,
    description: 'A chat reached its terminal closed state.',
  },
  {
    type: 'chat.reopened',
    group: 'chat_lifecycle',
    selectable: true,
    description: 'A previously closed chat was reopened for attendance.',
  },
  {
    type: 'chat.status.changed',
    group: 'chat_lifecycle',
    selectable: true,
    description:
      'A durable status transition that has no more specific lifecycle event occurred.',
  },
  {
    type: 'chat.automation.started',
    group: 'chat_lifecycle',
    selectable: true,
    description: 'A chat entered an automated flow.',
  },
  {
    type: 'chat.automation.finished',
    group: 'chat_lifecycle',
    selectable: true,
    description: 'A chat left an automated flow for a human or terminal state.',
  },
  {
    type: 'chat.assignment.changed',
    group: 'chat_changes',
    selectable: true,
    description:
      'The primary attendant, sector, channel worker, or participant assignment changed outside a transfer.',
  },
  {
    type: 'chat.labels.changed',
    group: 'chat_changes',
    selectable: true,
    description: 'One or more chat labels were added, changed, or removed.',
  },
  {
    type: 'chat.protocol.updated',
    group: 'chat_changes',
    selectable: true,
    description:
      'A public attendance, automation, or transfer protocol was generated.',
  },
  {
    type: 'chat.satisfaction.updated',
    group: 'chat_changes',
    selectable: true,
    description:
      'The customer satisfaction response associated with the chat changed.',
  },
  {
    type: 'chat.updated',
    group: 'chat_changes',
    selectable: true,
    description: 'Other customer-visible chat metadata changed.',
  },
  {
    type: 'message.received',
    group: 'messages',
    selectable: true,
    description: 'An inbound customer message was persisted.',
  },
  {
    type: 'message.sent',
    group: 'messages',
    selectable: true,
    description: 'An outbound message was persisted for sending.',
  },
  {
    type: 'message.annotation.created',
    group: 'messages',
    selectable: true,
    description:
      'An internal attendance annotation was persisted in the chat timeline.',
  },
  {
    type: 'message.system.created',
    group: 'messages',
    selectable: true,
    description: 'A durable system message was persisted in the chat timeline.',
  },
  {
    type: 'message.edited',
    group: 'messages',
    selectable: true,
    description: 'The content of a persisted message was edited.',
  },
  {
    type: 'message.deleted',
    group: 'messages',
    selectable: true,
    description: 'A persisted message was deleted or revoked.',
  },
  {
    type: 'message.reaction.updated',
    group: 'messages',
    selectable: true,
    description: 'A reaction was added, changed, or removed from a message.',
  },
  {
    type: 'message.pin.updated',
    group: 'messages',
    selectable: true,
    description: 'The pinned state of a message changed.',
  },
  {
    type: 'message.disappearing.updated',
    group: 'messages',
    selectable: true,
    description:
      'The disappearing-message configuration associated with a message changed.',
  },
  {
    type: 'message.media.updated',
    group: 'messages',
    selectable: true,
    description: 'Durable public media metadata became available or changed.',
  },
  {
    type: 'message.transcription.updated',
    group: 'messages',
    selectable: true,
    description: 'A durable audio transcription became available or changed.',
  },
  {
    type: 'message.updated',
    group: 'messages',
    selectable: true,
    description: 'Another customer-visible message field changed.',
  },
  {
    type: 'message.delivery.queued',
    group: 'message_delivery',
    selectable: true,
    description:
      'The outbound message was persisted in the Underchat provider queue.',
  },
  {
    type: 'message.delivery.sent',
    group: 'message_delivery',
    selectable: true,
    description: 'The channel accepted the outbound message for delivery.',
  },
  {
    type: 'message.delivery.delivered',
    group: 'message_delivery',
    selectable: true,
    description: 'The outbound message was delivered to the recipient device.',
  },
  {
    type: 'message.delivery.read',
    group: 'message_delivery',
    selectable: true,
    description: 'The recipient read the outbound message.',
  },
  {
    type: 'message.delivery.failed',
    group: 'message_delivery',
    selectable: true,
    description:
      'The outbound message reached a durable delivery failure state.',
  },
  {
    type: 'contact.created',
    group: 'contacts',
    selectable: true,
    description: 'A contact used by customer chats was created.',
  },
  {
    type: 'contact.updated',
    group: 'contacts',
    selectable: true,
    description: 'Customer-visible contact data changed.',
  },
  {
    type: 'contact.deleted',
    group: 'contacts',
    selectable: true,
    description: 'A contact was deleted.',
  },
  {
    type: 'webhook.test',
    group: 'control',
    selectable: false,
    description:
      'A signed verification event requested from the integration screen.',
  },
] as const;

export type OutboundWebhookEventDefinition =
  (typeof OUTBOUND_WEBHOOK_EVENT_CATALOG)[number];
export type OutboundWebhookEventType = OutboundWebhookEventDefinition['type'];
export type OutboundWebhookEventGroup = OutboundWebhookEventDefinition['group'];

export const OUTBOUND_WEBHOOK_EVENT_TYPES: readonly OutboundWebhookEventType[] =
  OUTBOUND_WEBHOOK_EVENT_CATALOG.map((event) => event.type);

export const OUTBOUND_WEBHOOK_SELECTABLE_EVENT_TYPES: readonly OutboundWebhookEventType[] =
  OUTBOUND_WEBHOOK_EVENT_CATALOG.filter((event) => event.selectable).map(
    (event) => event.type
  );

const OUTBOUND_WEBHOOK_EVENT_TYPE_SET = new Set<string>(
  OUTBOUND_WEBHOOK_EVENT_TYPES
);
const OUTBOUND_WEBHOOK_SELECTABLE_EVENT_TYPE_SET = new Set<string>(
  OUTBOUND_WEBHOOK_SELECTABLE_EVENT_TYPES
);

export function isOutboundWebhookEventType(
  value: unknown
): value is OutboundWebhookEventType {
  return (
    typeof value === 'string' && OUTBOUND_WEBHOOK_EVENT_TYPE_SET.has(value)
  );
}

export function isSelectableOutboundWebhookEventType(
  value: unknown
): value is Exclude<OutboundWebhookEventType, 'webhook.test'> {
  return (
    typeof value === 'string' &&
    OUTBOUND_WEBHOOK_SELECTABLE_EVENT_TYPE_SET.has(value)
  );
}

export type ChatLifecycleOperation =
  'created' | 'attended' | 'joined' | 'left' | 'transferred' | 'status_changed';

interface ResolveChatLifecycleEventsInput {
  operation: ChatLifecycleOperation;
  previousStatus?: EChatStatus | null;
  currentStatus: EChatStatus;
}

/**
 * Resolves public lifecycle facts for one applied chat mutation.
 * `chat.status.changed` is deliberately a fallback and is never emitted beside
 * a more specific status lifecycle event.
 */
export function resolveChatLifecycleEventTypes({
  operation,
  previousStatus,
  currentStatus,
}: ResolveChatLifecycleEventsInput): OutboundWebhookEventType[] {
  if (operation === 'created') {
    return ['chat.created'];
  }

  if (operation === 'joined') {
    return ['chat.joined'];
  }

  if (operation === 'left') {
    return ['chat.left'];
  }

  if (operation === 'transferred') {
    return ['chat.transferred'];
  }

  const events: OutboundWebhookEventType[] = [];
  const wasAutomated = isChatbotStatus(previousStatus);
  const isAutomated = isChatbotStatus(currentStatus);

  if (!wasAutomated && isAutomated) {
    events.push('chat.automation.started');
  } else if (wasAutomated && !isAutomated) {
    events.push('chat.automation.finished');
  }

  let specificStatusEvent: OutboundWebhookEventType | null = null;

  if (currentStatus === EChatStatus.closed) {
    specificStatusEvent = 'chat.closed';
  } else if (previousStatus === EChatStatus.closed) {
    specificStatusEvent = 'chat.reopened';
  } else if (currentStatus === EChatStatus.queue) {
    specificStatusEvent = 'chat.queued';
  } else if (
    operation === 'attended' ||
    (currentStatus === EChatStatus.in_chat &&
      previousStatus !== EChatStatus.in_chat)
  ) {
    specificStatusEvent = 'chat.attended';
  }

  if (specificStatusEvent) {
    events.push(specificStatusEvent);
  } else if (previousStatus !== currentStatus && events.length === 0) {
    events.push('chat.status.changed');
  }

  return [...new Set(events)];
}
