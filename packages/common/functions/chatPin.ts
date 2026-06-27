import { EChatStatus } from '@core/common/enums/EChatStatus';

const PINNABLE_CHAT_STATUSES = new Set<string>([
  EChatStatus.queue,
  EChatStatus.in_chat,
  EChatStatus.ura,
  EChatStatus.ura_output,
  EChatStatus.ura_schedule,
  EChatStatus.ura_webhook,
]);

export const isPinnableChatStatus = (
  status: string | null | undefined
): boolean => {
  return !!status && PINNABLE_CHAT_STATUSES.has(status);
};
