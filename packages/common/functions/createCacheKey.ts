import type { SessionPlatform } from '@core/common/types/SessionPlatform';

function joinParts(parts: string[]): string {
  const filteredParts = parts.filter(Boolean);

  if (!filteredParts.length) {
    throw new Error('invalid cache key parts');
  }

  return filteredParts.join(':');
}

export function createJwtCacheKey(
  accountId: string,
  userId: string,
  routeModule: string,
  version = '0'
): string {
  if (!accountId) {
    throw new Error('account id is required');
  }

  if (!userId) {
    throw new Error('user id is required');
  }

  if (!routeModule) {
    throw new Error('route module is required');
  }

  const normalizedVersion = version.trim().length > 0 ? version : '0';
  const encodedRouteModule = encodeURIComponent(routeModule);
  return joinParts([
    'jwtCache',
    accountId,
    userId,
    normalizedVersion,
    encodedRouteModule,
  ]);
}

export function createJwtCacheVersionKey(
  accountId: string,
  userId: string
): string {
  if (!accountId) {
    throw new Error('account id is required');
  }

  if (!userId) {
    throw new Error('user id is required');
  }

  return joinParts(['jwtCacheVersion', accountId, userId]);
}

export function createKeyApiCacheKey(
  keyApi: string,
  routeModule: string
): string {
  if (!keyApi) {
    throw new Error('key api is required');
  }

  if (!routeModule) {
    throw new Error('route module is required');
  }

  const encodedRouteModule = encodeURIComponent(routeModule);
  return joinParts(['keyCache', keyApi, encodedRouteModule]);
}

export function createJwtSessionKey(
  accountId: string,
  userId: string,
  sessionPlatform?: SessionPlatform
): string {
  if (!accountId) {
    throw new Error('account id is required');
  }

  if (!userId) {
    throw new Error('user id is required');
  }

  if (sessionPlatform) {
    return joinParts(['jwtSession', accountId, userId, sessionPlatform]);
  }

  return joinParts(['jwtSession', accountId, userId]);
}

export function parseJwtSessionKey(key: string): {
  accountId: string;
  userId: string;
  sessionPlatform: SessionPlatform | null;
} | null {
  if (!key) {
    return null;
  }

  const [prefix, accountId, userId, sessionPlatform, ...extra] = key.split(':');

  if (prefix !== 'jwtSession' || !accountId || !userId || extra.length > 0) {
    return null;
  }

  if (!sessionPlatform) {
    return {
      accountId,
      userId,
      sessionPlatform: null,
    };
  }

  if (sessionPlatform !== 'web' && sessionPlatform !== 'mobile') {
    return null;
  }

  return {
    accountId,
    userId,
    sessionPlatform,
  };
}

export function createUserAttendanceRulesCacheKey(
  accountId: string,
  userId: string
): string {
  if (!accountId) {
    throw new Error('account id is required');
  }

  if (!userId) {
    throw new Error('user id is required');
  }

  return joinParts(['userAttendanceRules', accountId, userId]);
}

export function createUserAccessScopeCacheKey(userId: string): string {
  if (!userId) {
    throw new Error('user id is required');
  }

  return joinParts(['userAccessScope', userId]);
}

export function createChatCacheKey(
  accountId: string,
  workerId: string,
  phone: string
): string {
  if (!accountId) {
    throw new Error('account id is required');
  }

  if (!workerId) {
    throw new Error('worker id is required');
  }

  if (!phone) {
    throw new Error('phone is required');
  }

  return joinParts(['underchat', 'chat', accountId, workerId, phone]);
}

export function createChatCacheKeyChatId(
  accountId: string,
  chatId: string
): string {
  if (!accountId) {
    throw new Error('account id is required');
  }

  if (!chatId) {
    throw new Error('chat id is required');
  }

  return joinParts(['chat', accountId, chatId]);
}

export function createChatbotFlowCacheKey(
  accountId: string,
  workerId: string,
  chatId: string
): string {
  if (!accountId) {
    throw new Error('account id is required');
  }

  if (!workerId) {
    throw new Error('worker id is required');
  }

  if (!chatId) {
    throw new Error('chat id is required');
  }

  return joinParts(['underchat', 'chatbot-flow', accountId, workerId, chatId]);
}

export function createChatbotInactivityCacheKey(
  accountId: string,
  workerId: string,
  chatId: string
): string {
  if (!accountId) {
    throw new Error('account id is required');
  }

  if (!workerId) {
    throw new Error('worker id is required');
  }

  if (!chatId) {
    throw new Error('chat id is required');
  }

  return joinParts([
    'underchat',
    'chatbot-inactivity',
    accountId,
    workerId,
    chatId,
  ]);
}

export function createAttendanceInactivityCacheKey(
  accountId: string,
  workerId: string,
  chatId: string
): string {
  if (!accountId) {
    throw new Error('account id is required');
  }

  if (!workerId) {
    throw new Error('worker id is required');
  }

  if (!chatId) {
    throw new Error('chat id is required');
  }

  return joinParts([
    'underchat',
    'attendance-inactivity',
    accountId,
    workerId,
    chatId,
  ]);
}

export function createAttendanceInactivityDisabledCacheKey(
  accountId: string,
  workerId: string,
  chatId: string
): string {
  if (!accountId) {
    throw new Error('account id is required');
  }

  if (!workerId) {
    throw new Error('worker id is required');
  }

  if (!chatId) {
    throw new Error('chat id is required');
  }

  return joinParts([
    'underchat',
    'attendance-inactivity-disabled',
    accountId,
    workerId,
    chatId,
  ]);
}

export function createChatbotFailedAttemptsCacheKey(
  accountId: string,
  workerId: string,
  chatId: string
): string {
  if (!accountId) {
    throw new Error('account id is required');
  }

  if (!workerId) {
    throw new Error('worker id is required');
  }

  if (!chatId) {
    throw new Error('chat id is required');
  }

  return joinParts([
    'underchat',
    'chatbot-failed-attempts',
    accountId,
    workerId,
    chatId,
  ]);
}

export function createAiResponseHistoryCacheKey(
  accountId: string,
  chatId: string,
  aiAgentId: string,
  questionHash: string
): string {
  if (!accountId) {
    throw new Error('account id is required');
  }

  if (!chatId) {
    throw new Error('chat id is required');
  }

  if (!aiAgentId) {
    throw new Error('ai agent id is required');
  }

  if (!questionHash) {
    throw new Error('question hash is required');
  }

  return joinParts([
    'underchat',
    'ai-response-history',
    accountId,
    chatId,
    aiAgentId,
    questionHash,
  ]);
}
