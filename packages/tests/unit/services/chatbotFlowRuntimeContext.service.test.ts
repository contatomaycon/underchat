import 'reflect-metadata';

import {
  CHATBOT_FLOW_RUNTIME_CONTEXT_TTL_SECONDS,
  ChatbotFlowRuntimeContextService,
} from '@core/services/chatbotFlowRuntimeContext.service';
import { createEmptyChatbotUnderchatLookupOutput } from '@core/common/interfaces/IChatbotUnderchatLookup';
import { EMessageType } from '@core/common/enums/EMessageType';

const createService = () => {
  interface RedisTransactionMock {
    set: jest.Mock<RedisTransactionMock, [string, string]>;
    exec: jest.Mock<Promise<Array<[null, string]>>, []>;
  }

  const values = new Map<string, string>();
  const redis = {
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    del: jest.fn(async (key: string) => (values.delete(key) ? 1 : 0)),
    multi: jest.fn(() => {
      const operations: Array<[string, string]> = [];
      const transaction = {} as RedisTransactionMock;
      transaction.set = jest.fn(
        (key: string, value: string): RedisTransactionMock => {
          operations.push([key, value]);
          return transaction;
        }
      );
      transaction.exec = jest.fn(async () => {
        for (const [key, value] of operations) values.set(key, value);
        return operations.map((): [null, string] => [null, 'OK']);
      });
      return transaction;
    }),
  };
  const encryptor = {
    encrypt: jest.fn((value: string) => Buffer.from(value).toString('base64')),
    decrypt: jest.fn((value: string) =>
      Buffer.from(value, 'base64').toString('utf8')
    ),
  };
  return {
    service: new ChatbotFlowRuntimeContextService(
      redis as never,
      encryptor as never
    ),
    redis,
    values,
  };
};

describe('ChatbotFlowRuntimeContextService', () => {
  it('persists node and encrypted output context atomically', async () => {
    const { service, values } = createService();
    const context = service.withOutput(
      service.create('chatbot-1', 'flow-1'),
      'api_1',
      {
        body: { data: { token: 'secret' } },
        response: {
          status: 200,
          ok: true,
          headers: {},
          contentType: 'application/json',
          sizeBytes: 27,
          durationMs: 10,
          attempts: 1,
        },
      }
    );

    await service.persistTransition({
      accountId: 'account-1',
      workerId: 'worker-1',
      chatId: 'chat-1',
      nextNodeId: 'message-1',
      context,
    });

    expect(values.get('underchat:chatbot-flow:account-1:worker-1:chat-1')).toBe(
      'message-1'
    );
    expect(
      values.get('underchat:chatbot-flow-context:account-1:worker-1:chat-1')
    ).not.toContain('secret');
  });

  it('exposes body paths and response metadata through one virtual namespace', () => {
    const { service } = createService();
    const context = service.withOutput(
      service.create('chatbot-1', 'flow-1'),
      'api_1',
      {
        body: [{ id: 'one' }, { id: 'two' }],
        response: {
          status: 200,
          ok: true,
          headers: { 'x-token': 'abc' },
          contentType: 'application/json',
          sizeBytes: 10,
          durationMs: 3,
          attempts: 1,
        },
      }
    );

    const scope = service.toVariableScope(context);
    const output = scope.api_1 as Record<string, unknown>;
    expect(output).toBeDefined();
  });

  it('exposes data and message captures as direct variable roots', () => {
    const { service } = createService();
    let context = service.create('chatbot-1', 'flow-1');
    context = service.withCapture(context, 'data_1', {
      value: 'maycon@example.com',
      email: 'maycon@example.com',
    });
    context = service.withCapture(context, 'message_1', {
      text: 'Quero continuar',
    });

    expect(service.toVariableScope(context)).toMatchObject({
      data_1: {
        value: 'maycon@example.com',
        email: 'maycon@example.com',
      },
      message_1: { text: 'Quero continuar' },
    });
  });

  it('persists normalized media reply captures while accepting legacy text captures', () => {
    const { service } = createService();
    let context = service.create('chatbot-1', 'flow-1');
    context = service.withCapture(context, 'message_1', {
      text: '',
      type: EMessageType.document,
      media: {
        url: 'https://cdn.example.com/file.pdf',
        name: 'file.pdf',
        mimetype: 'application/pdf',
        extension: 'pdf',
        size: 2048,
        duration: null,
        width: null,
        height: null,
      },
    });

    expect(service.toVariableScope(context)).toMatchObject({
      message_1: {
        text: '',
        type: EMessageType.document,
        media: { url: 'https://cdn.example.com/file.pdf' },
      },
    });

    const legacy = service.create('chatbot-1', 'flow-1');
    const encrypted = Buffer.from(
      JSON.stringify({
        ...legacy,
        captures: { message_1: { text: 'resposta antiga' } },
      })
    ).toString('base64');
    expect(service.deserialize(encrypted).captures).toEqual({
      message_1: { text: 'resposta antiga' },
    });
  });

  it('persists and restores a video reply captured by an after-response Message node', async () => {
    const { service, values } = createService();
    const capture = {
      text: 'Vídeo de resposta',
      type: EMessageType.video,
      media: {
        url: 'https://cdn.example.com/video.mp4',
        name: 'video.mp4',
        mimetype: 'video/mp4',
        extension: 'mp4',
        size: 8192,
        duration: 18,
        width: 1920,
        height: 1080,
      },
    } as const;
    const context = service.withCapture(
      service.create('chatbot-1', 'flow-1'),
      'message_1',
      capture
    );

    await service.persistTransition({
      accountId: 'account-1',
      workerId: 'worker-1',
      chatId: 'chat-1',
      nextNodeId: 'redirect-1',
      context,
    });

    const encrypted = values.get(
      'underchat:chatbot-flow-context:account-1:worker-1:chat-1'
    );
    expect(encrypted).toBeDefined();
    expect(
      service.deserialize(encrypted as string).captures?.message_1
    ).toEqual(capture);
  });

  it('persists the namespace and clears prior PII when not_found overwrites it', () => {
    const { service } = createService();
    const notFound = createEmptyChatbotUnderchatLookupOutput();
    let context = service.withLookup(
      service.create('chatbot-1', 'flow-1'),
      'underchat_1',
      {
        ...notFound,
        found: true,
        user: {
          ...notFound.user,
          email: 'user@example.com',
          status: 'active',
          document: '03071321104',
          phone: '+5511999999999',
        },
        account: {
          ...notFound.account,
          id: 'account-1',
          name: 'Acme',
          status: 'active',
          billing_period: 'monthly',
          last_payment_at: '2026-02-19T03:10:40.465Z',
          next_renewal_at: '2029-04-20T02:05:21.744Z',
          last_paid_amount: 106.39,
        },
      }
    );

    const foundScope = service.toVariableScope(context);
    expect(foundScope).toMatchObject({
      underchat_1: {
        user: {
          email: 'user@example.com',
          status: 'Ativo',
          document: '030.713.211-04',
          phone: '+55 (11) 99999-9999',
          sectors: [],
          channels: [],
        },
        account: {
          id: 'account-1',
          name: 'Acme',
          status: 'Ativo',
          billing_period: 'Mensal',
          last_payment_at: '19/02/2026 às 00:10',
          next_renewal_at: '19/04/2029 às 23:05',
          last_paid_amount: '106,39',
        },
      },
    });
    expect(foundScope.underchat_1).not.toHaveProperty('found');
    expect(service.serialize(context)).not.toContain('user@example.com');

    context = service.withLookup(context, 'underchat_1', notFound);
    const notFoundScope = service.toVariableScope(context);
    expect(notFoundScope).toMatchObject({
      underchat_1: {
        user: { email: null, sectors: [], channels: [] },
        account: { last_paid_amount: null },
      },
    });
    expect(notFoundScope.underchat_1).not.toHaveProperty('found');
  });

  it('persists captures encrypted with the existing transition TTL', async () => {
    const { service, redis, values } = createService();
    const context = service.withCapture(
      service.create('chatbot-1', 'flow-1'),
      'message_1',
      { text: 'resposta confidencial' }
    );

    await service.persistTransition({
      accountId: 'account-1',
      workerId: 'worker-1',
      chatId: 'chat-1',
      nextNodeId: 'api-1',
      context,
    });

    expect(
      values.get('underchat:chatbot-flow-context:account-1:worker-1:chat-1')
    ).not.toContain('resposta confidencial');
    const transaction = redis.multi.mock.results[0]?.value as {
      set: jest.Mock;
    };
    expect(transaction.set).toHaveBeenNthCalledWith(
      2,
      'underchat:chatbot-flow-context:account-1:worker-1:chat-1',
      expect.any(String),
      'EX',
      CHATBOT_FLOW_RUNTIME_CONTEXT_TTL_SECONDS
    );
  });

  it('keeps version 1 contexts without captures backward compatible', () => {
    const { service } = createService();
    const context = service.create('chatbot-1', 'flow-1');
    const {
      captures: _captures,
      lookups: _lookups,
      ...legacyContext
    } = context;
    const encrypted = Buffer.from(JSON.stringify(legacyContext)).toString(
      'base64'
    );

    expect(service.deserialize(encrypted)).toMatchObject({
      version: 1,
      outputs: {},
      invocations: {},
    });
  });

  it('hydrates and formats a legacy Underchat lookup when loading it', () => {
    const { service } = createService();
    const output = createEmptyChatbotUnderchatLookupOutput();
    const { id: _id, name: _name, ...legacyAccount } = output.account;
    const legacyContext = {
      ...service.create('chatbot-1', 'flow-1'),
      lookups: {
        underchat_1: {
          ...output,
          user: {
            ...output.user,
            status: 'active',
            document: '03071321104',
            phone: '+5511999999999',
          },
          account: {
            ...legacyAccount,
            status: 'active',
            billing_period: 'monthly',
            last_payment_at: '2026-02-19T03:10:40.465Z',
            next_renewal_at: '2029-04-20T02:05:21.744Z',
            last_paid_amount: 106.39,
          },
        },
      },
    };
    const encrypted = Buffer.from(JSON.stringify(legacyContext)).toString(
      'base64'
    );

    const deserialized = service.deserialize(encrypted);
    expect(deserialized.lookups?.underchat_1).toMatchObject({
      user: {
        status: 'active',
        document: '03071321104',
        phone: '+5511999999999',
      },
      account: {
        id: null,
        name: null,
        status: 'active',
        billing_period: 'monthly',
        last_payment_at: '2026-02-19T03:10:40.465Z',
        next_renewal_at: '2029-04-20T02:05:21.744Z',
        last_paid_amount: 106.39,
      },
    });

    expect(service.toVariableScope(deserialized).underchat_1).toMatchObject({
      user: {
        status: 'Ativo',
        document: '030.713.211-04',
        phone: '+55 (11) 99999-9999',
      },
      account: {
        id: null,
        name: null,
        status: 'Ativo',
        billing_period: 'Mensal',
        last_payment_at: '19/02/2026 às 00:10',
        next_renewal_at: '19/04/2029 às 23:05',
        last_paid_amount: '106,39',
      },
    });
  });

  it('rejects invalid Underchat lookup namespaces and shapes', () => {
    const { service } = createService();
    const context = service.create('chatbot-1', 'flow-1');
    const output = createEmptyChatbotUnderchatLookupOutput();

    expect(() => service.withLookup(context, 'underchat_0', output)).toThrow(
      'lookup output is invalid'
    );
    expect(() =>
      service.withLookup(context, 'underchat_1', {
        ...output,
        account: { ...output.account, injected: 'not-allowed' },
      } as never)
    ).toThrow('lookup output is invalid');
  });

  it.each([
    { message_1: { text: 'ok', injected: 'not-allowed' } },
    { data_1: { value: 'ok', email: 'ok', injected: 'not-allowed' } },
    { message_1: { value: 'ok', email: 'ok' } },
    { data_1: { text: 'ok' } },
    { data_1: { value: 'one', email: 'another' } },
  ])('rejects an altered capture shape', (captures) => {
    const { service } = createService();
    const context = { ...service.create('chatbot-1', 'flow-1'), captures };
    const encrypted = Buffer.from(JSON.stringify(context)).toString('base64');

    expect(() => service.deserialize(encrypted)).toThrow(
      'runtime context is invalid'
    );
  });

  it('rejects invalid capture shapes before persistence', () => {
    const { service } = createService();
    const context = service.create('chatbot-1', 'flow-1');

    expect(() =>
      service.withCapture(context, 'message_1', {
        text: 'ok',
        injected: 'not-allowed',
      } as never)
    ).toThrow('capture output key is invalid');
    expect(() =>
      service.withCapture(context, 'data_1', { text: 'wrong namespace' })
    ).toThrow('capture output key is invalid');
  });

  it('rejects invalid API namespaces before encryption or deserialization', () => {
    const { service } = createService();
    const context = service.create('chatbot-1', 'flow-1');

    expect(() =>
      service.withOutput(context, 'api_0', {
        body: null,
        response: {
          status: null,
          ok: false,
          headers: {},
          contentType: null,
          sizeBytes: 0,
          durationMs: 0,
          attempts: 0,
        },
      })
    ).toThrow('API output key is invalid');

    const altered = {
      ...context,
      outputs: { constructor: {} },
    } as never;
    expect(() => service.serialize(altered)).toThrow(
      'runtime context is invalid'
    );
    const encrypted = Buffer.from(JSON.stringify(altered)).toString('base64');
    expect(() => service.deserialize(encrypted)).toThrow(
      'runtime context is invalid'
    );
  });

  it('builds a null-prototype variable scope without prototype setters', () => {
    const { service } = createService();
    const builtIns = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"captured"}'
    ) as Record<string, unknown>;

    const scope = service.toVariableScope(
      service.create('chatbot-1', 'flow-1'),
      builtIns
    );

    expect(Object.getPrototypeOf(scope)).toBeNull();
    expect(Object.hasOwn(scope, '__proto__')).toBe(true);
    expect(scope.__proto__).toEqual({ polluted: true });
    expect(scope.constructor).toBe('captured');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects contexts above the configured memory ceiling', () => {
    const { service } = createService();
    const context = service.withOutput(
      service.create('chatbot-1', 'flow-1'),
      'api_1',
      {
        body: 'x'.repeat(257 * 1024),
        response: {
          status: 200,
          ok: true,
          headers: {},
          contentType: 'text/plain',
          sizeBytes: 257 * 1024,
          durationMs: 2,
          attempts: 1,
        },
      }
    );
    expect(() => service.serialize(context)).toThrow('exceeds 256 KiB');
  });
});
