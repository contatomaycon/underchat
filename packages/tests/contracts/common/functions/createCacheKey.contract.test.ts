import {
  createAttendanceInactivityCacheKey,
  createAiResponseHistoryCacheKey,
  createChatbotFailedAttemptsCacheKey,
  createChatbotFlowContextCacheKey,
  createChatbotFlowCacheKey,
  createChatbotInactivityCacheKey,
  createChatbotOfficialResponsePendingCacheKey,
  createChatCacheKey,
  createChatCacheKeyChatId,
  createJwtCacheKey,
  createJwtCacheVersionKey,
  createJwtSessionKey,
  createKeyApiCacheKey,
  createUserAttendanceRulesCacheKey,
  parseJwtSessionKey,
} from '@core/common/functions/createCacheKey';

describe('createCacheKey', () => {
  it('creates jwt cache keys and validates required fields', () => {
    expect(createJwtCacheKey('acc', 'usr', 'module/a', '2')).toBe(
      'jwtCache:acc:usr:2:module%2Fa'
    );
    expect(createJwtCacheKey('acc', 'usr', 'module/a', '   ')).toBe(
      'jwtCache:acc:usr:0:module%2Fa'
    );

    expect(() => createJwtCacheKey('', 'usr', 'module')).toThrow(
      'account id is required'
    );
    expect(() => createJwtCacheKey('acc', '', 'module')).toThrow(
      'user id is required'
    );
    expect(() => createJwtCacheKey('acc', 'usr', '')).toThrow(
      'route module is required'
    );
  });

  it('creates jwt cache version keys and validates required fields', () => {
    expect(createJwtCacheVersionKey('acc', 'usr')).toBe(
      'jwtCacheVersion:acc:usr'
    );

    expect(() => createJwtCacheVersionKey('', 'usr')).toThrow(
      'account id is required'
    );
    expect(() => createJwtCacheVersionKey('acc', '')).toThrow(
      'user id is required'
    );
  });

  it('creates key api cache key with encoded route module', () => {
    expect(createKeyApiCacheKey('k1', 'chat/list')).toBe(
      'keyCache:6ab9f1eb8f7d3388f4f9d586f66e99fd54080df2c446f0e58668b09c08a16dd0:chat%2Flist'
    );

    expect(() => createKeyApiCacheKey('', 'chat/list')).toThrow(
      'key api is required'
    );
    expect(() => createKeyApiCacheKey('k1', '')).toThrow(
      'route module is required'
    );
  });

  it('creates and parses jwt session keys', () => {
    expect(createJwtSessionKey('acc', 'usr')).toBe('jwtSession:acc:usr');
    expect(createJwtSessionKey('acc', 'usr', 'web')).toBe(
      'jwtSession:acc:usr:web'
    );

    expect(parseJwtSessionKey('jwtSession:acc:usr')).toEqual({
      accountId: 'acc',
      userId: 'usr',
      sessionPlatform: null,
    });
    expect(parseJwtSessionKey('jwtSession:acc:usr:mobile')).toEqual({
      accountId: 'acc',
      userId: 'usr',
      sessionPlatform: 'mobile',
    });

    expect(parseJwtSessionKey('')).toBeNull();
    expect(parseJwtSessionKey('x:acc:usr')).toBeNull();
    expect(parseJwtSessionKey('jwtSession:acc')).toBeNull();
    expect(parseJwtSessionKey('jwtSession:acc:usr:web:extra')).toBeNull();
    expect(parseJwtSessionKey('jwtSession:acc:usr:desktop')).toBeNull();

    expect(() => createJwtSessionKey('', 'usr')).toThrow(
      'account id is required'
    );
    expect(() => createJwtSessionKey('acc', '')).toThrow('user id is required');
  });

  it('creates user attendance rules key', () => {
    expect(createUserAttendanceRulesCacheKey('acc', 'usr')).toBe(
      'userAttendanceRules:acc:usr'
    );
    expect(() => createUserAttendanceRulesCacheKey('', 'usr')).toThrow(
      'account id is required'
    );
    expect(() => createUserAttendanceRulesCacheKey('acc', '')).toThrow(
      'user id is required'
    );
  });

  it('creates chat-related keys and validates required fields', () => {
    expect(createChatCacheKey('acc', 'worker', '5511999999999')).toBe(
      'underchat:chat:acc:worker:5511999999999'
    );
    expect(createChatCacheKeyChatId('acc', 'chat-1')).toBe('chat:acc:chat-1');
    expect(createChatbotFlowCacheKey('acc', 'worker', 'chat-1')).toBe(
      'underchat:chatbot-flow:acc:worker:chat-1'
    );
    expect(createChatbotFlowContextCacheKey('acc', 'worker', 'chat-1')).toBe(
      'underchat:chatbot-flow-context:acc:worker:chat-1'
    );
    expect(
      createChatbotOfficialResponsePendingCacheKey('acc', 'worker', 'chat-1')
    ).toBe('underchat:chatbot-official-response-pending:acc:worker:chat-1');
    expect(createChatbotInactivityCacheKey('acc', 'worker', 'chat-1')).toBe(
      'underchat:chatbot-inactivity:acc:worker:chat-1'
    );
    expect(createAttendanceInactivityCacheKey('acc', 'worker', 'chat-1')).toBe(
      'underchat:attendance-inactivity:acc:worker:chat-1'
    );
    expect(createChatbotFailedAttemptsCacheKey('acc', 'worker', 'chat-1')).toBe(
      'underchat:chatbot-failed-attempts:acc:worker:chat-1'
    );

    expect(() => createChatCacheKey('', 'worker', '5511')).toThrow(
      'account id is required'
    );
    expect(() => createChatCacheKey('acc', '', '5511')).toThrow(
      'worker id is required'
    );
    expect(() => createChatCacheKey('acc', 'worker', '')).toThrow(
      'phone is required'
    );

    expect(() => createChatCacheKeyChatId('', 'chat')).toThrow(
      'account id is required'
    );
    expect(() => createChatCacheKeyChatId('acc', '')).toThrow(
      'chat id is required'
    );

    expect(() => createChatbotFlowCacheKey('', 'worker', 'chat')).toThrow(
      'account id is required'
    );
    expect(() => createChatbotFlowCacheKey('acc', '', 'chat')).toThrow(
      'worker id is required'
    );
    expect(() => createChatbotFlowCacheKey('acc', 'worker', '')).toThrow(
      'chat id is required'
    );
    expect(() =>
      createChatbotFlowContextCacheKey('', 'worker', 'chat')
    ).toThrow('account id is required');
    expect(() => createChatbotFlowContextCacheKey('acc', '', 'chat')).toThrow(
      'worker id is required'
    );
    expect(() => createChatbotFlowContextCacheKey('acc', 'worker', '')).toThrow(
      'chat id is required'
    );

    expect(() =>
      createChatbotOfficialResponsePendingCacheKey('', 'worker', 'chat')
    ).toThrow('account id is required');
    expect(() =>
      createChatbotOfficialResponsePendingCacheKey('acc', '', 'chat')
    ).toThrow('worker id is required');
    expect(() =>
      createChatbotOfficialResponsePendingCacheKey('acc', 'worker', '')
    ).toThrow('chat id is required');

    expect(() => createChatbotInactivityCacheKey('', 'worker', 'chat')).toThrow(
      'account id is required'
    );
    expect(() => createChatbotInactivityCacheKey('acc', '', 'chat')).toThrow(
      'worker id is required'
    );
    expect(() => createChatbotInactivityCacheKey('acc', 'worker', '')).toThrow(
      'chat id is required'
    );

    expect(() =>
      createAttendanceInactivityCacheKey('', 'worker', 'chat')
    ).toThrow('account id is required');
    expect(() => createAttendanceInactivityCacheKey('acc', '', 'chat')).toThrow(
      'worker id is required'
    );
    expect(() =>
      createAttendanceInactivityCacheKey('acc', 'worker', '')
    ).toThrow('chat id is required');

    expect(() =>
      createChatbotFailedAttemptsCacheKey('', 'worker', 'chat')
    ).toThrow('account id is required');
    expect(() =>
      createChatbotFailedAttemptsCacheKey('acc', '', 'chat')
    ).toThrow('worker id is required');
    expect(() =>
      createChatbotFailedAttemptsCacheKey('acc', 'worker', '')
    ).toThrow('chat id is required');
  });

  it('creates ai response history key and validates required fields', () => {
    expect(
      createAiResponseHistoryCacheKey('acc', 'chat', 'agent', 'qhash')
    ).toBe('underchat:ai-response-history:acc:chat:agent:qhash');

    expect(() =>
      createAiResponseHistoryCacheKey('', 'chat', 'agent', 'qhash')
    ).toThrow('account id is required');
    expect(() =>
      createAiResponseHistoryCacheKey('acc', '', 'agent', 'qhash')
    ).toThrow('chat id is required');
    expect(() =>
      createAiResponseHistoryCacheKey('acc', 'chat', '', 'qhash')
    ).toThrow('ai agent id is required');
    expect(() =>
      createAiResponseHistoryCacheKey('acc', 'chat', 'agent', '')
    ).toThrow('question hash is required');
  });
});
