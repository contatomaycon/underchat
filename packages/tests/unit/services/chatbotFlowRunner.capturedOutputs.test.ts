import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(async (_redis, _key, fn: () => Promise<unknown>) => fn()),
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import type { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import type { ApiRequestConfig } from '@core/schema/chatbot/chatbotFlow.schema';
import type {
  ChatbotFlowRuntimeContext,
  ChatbotNodeRuntimeCapture,
} from '@core/services/chatbotFlowRuntimeContext.service';
import { ChatbotApiRequestExecutorService } from '@core/services/chatbotApiRequestExecutor.service';
import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';

interface RuntimeContextHarness {
  context: ChatbotFlowRuntimeContext;
  service: {
    load: jest.Mock;
    create: jest.Mock;
    withCapture: jest.Mock;
    withInvocation: jest.Mock;
    withOutput: jest.Mock;
    serialize: jest.Mock;
    toVariableScope: jest.Mock;
    persistTransition: jest.Mock;
  };
}

interface RunnerHarness {
  processDataNode: (
    t: never,
    data: IUpsertMessage,
    chat: IChat,
    flow: ListChatbotFlowResponse,
    nodeId: string
  ) => Promise<boolean>;
  processMessageNode: (
    t: never,
    chat: IChat,
    node: ListChatbotFlowResponse['nodes'][number],
    flow: ListChatbotFlowResponse
  ) => Promise<boolean>;
  processMessageNodeType: (
    t: never,
    chat: IChat,
    flow: ListChatbotFlowResponse,
    node: ListChatbotFlowResponse['nodes'][number],
    nodeId: string,
    customMessages: undefined,
    data: IUpsertMessage
  ) => Promise<boolean>;
  processApiRequestNode: (
    t: never,
    chat: IChat,
    flow: ListChatbotFlowResponse,
    node: ListChatbotFlowResponse['nodes'][number]
  ) => Promise<boolean>;
  processNextNode: jest.Mock;
  sendMessage: jest.Mock;
}

const createRuntimeContextHarness = (): RuntimeContextHarness => {
  const state: RuntimeContextHarness = {
    context: {
      version: 1,
      chatbotId: 'chatbot-1',
      flowId: 'flow-1',
      outputs: {},
      captures: {},
      invocations: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    service: {} as RuntimeContextHarness['service'],
  };
  state.service = {
    load: jest.fn(async () => state.context),
    create: jest.fn(() => state.context),
    withCapture: jest.fn(
      (
        context: ChatbotFlowRuntimeContext,
        outputKey: string,
        capture: ChatbotNodeRuntimeCapture
      ) => {
        state.context = {
          ...context,
          captures: { ...(context.captures ?? {}), [outputKey]: capture },
        };
        return state.context;
      }
    ),
    withInvocation: jest.fn(
      (
        context: ChatbotFlowRuntimeContext,
        nodeId: string,
        invocation: ChatbotFlowRuntimeContext['invocations'][string]
      ) => {
        state.context = {
          ...context,
          invocations: { ...context.invocations, [nodeId]: invocation },
        };
        return state.context;
      }
    ),
    withOutput: jest.fn(
      (
        context: ChatbotFlowRuntimeContext,
        outputKey: string,
        output: ChatbotFlowRuntimeContext['outputs'][string]
      ) => {
        state.context = {
          ...context,
          outputs: { ...context.outputs, [outputKey]: output },
        };
        return state.context;
      }
    ),
    serialize: jest.fn(() => 'encrypted-context'),
    toVariableScope: jest.fn(() => ({})),
    persistTransition: jest.fn(
      async (input: { context: ChatbotFlowRuntimeContext }) => {
        state.context = input.context;
      }
    ),
  };
  return state;
};

const createRunner = () => {
  const runtime = createRuntimeContextHarness();
  const redis = { set: jest.fn(async () => 'OK') };
  const dependencies = Array.from({ length: 26 }, () => ({}));
  dependencies[0] = redis;
  dependencies[24] = runtime.service;
  const runner = Reflect.construct(
    ChatbotFlowRunnerService,
    dependencies
  ) as unknown as RunnerHarness;
  runner.processNextNode = jest.fn(async () => true);
  runner.sendMessage = jest.fn(async () => true);
  return { runner, runtime, redis };
};

const chat = {
  chat_id: 'chat-1',
  account: { id: 'account-1' },
  worker: { id: 'worker-1' },
  contact: null,
} as unknown as IChat;

const incomingMessage = (text: string): IUpsertMessage =>
  ({
    worker_id: 'worker-1',
    account_id: 'account-1',
    type: EMessageType.text,
    has_quoted: false,
    message: {
      key: { id: 'message-id', fromMe: false },
      message: { conversation: text },
    },
  }) as unknown as IUpsertMessage;

const incomingMediaMessage = (
  type:
    | EMessageType.image
    | EMessageType.video
    | EMessageType.audio
    | EMessageType.document,
  media: Record<string, unknown> | null,
  options: { caption?: string; fromMe?: boolean } = {}
): IUpsertMessage =>
  ({
    worker_id: 'worker-1',
    account_id: 'account-1',
    type,
    content:
      type === EMessageType.image
        ? { type, image: media }
        : type === EMessageType.video
          ? { type, video: media }
          : type === EMessageType.audio
            ? { type, audio: media }
            : { type, document: media },
    has_quoted: false,
    message: {
      key: { id: 'message-id', fromMe: options.fromMe ?? false },
      message:
        type === EMessageType.image && options.caption !== undefined
          ? { imageMessage: { caption: options.caption } }
          : type === EMessageType.video && options.caption !== undefined
            ? { videoMessage: { caption: options.caption } }
            : {},
    },
  }) as unknown as IUpsertMessage;

const incomingUnsupportedMessage = (): IUpsertMessage =>
  ({
    worker_id: 'worker-1',
    account_id: 'account-1',
    type: EMessageType.sticker,
    has_quoted: false,
    message: { key: { id: 'message-id', fromMe: false }, message: {} },
  }) as unknown as IUpsertMessage;

const flowWithNode = (
  node: ListChatbotFlowResponse['nodes'][number]
): ListChatbotFlowResponse => ({
  chatbot_flow_id: 'flow-1',
  chatbot_id: 'chatbot-1',
  account_id: 'account-1',
  nodes: [
    node,
    {
      id: 'api-1',
      type: 'apiRequest',
      position: { x: 1, y: 0 },
      data: {},
    },
  ],
  edges: [{ id: 'edge-1', source: node.id, target: 'api-1' }],
});

const apiConfiguration = (): ApiRequestConfig => ({
  version: 1,
  outputKey: 'api_1',
  method: 'GET',
  url: 'https://example.com/resource',
  queryParams: [],
  headers: [],
  auth: {
    type: 'none',
    bearer: { token: { id: 'bearer', value: '' } },
    apiKey: {
      placement: 'header',
      name: 'X-API-Key',
      value: { id: 'api-key', value: '' },
    },
    basic: {
      username: { id: 'username', value: '' },
      password: { id: 'password', value: '' },
    },
  },
  body: {
    id: 'body',
    type: 'none',
    json: '',
    raw: '',
    contentType: 'text/plain',
    sensitive: false,
    formFields: [],
    multipart: [],
  },
  execution: {
    mode: 'once',
    itemsExpression: '',
    concurrency: 1,
    failurePolicy: 'failFast',
    timeoutMs: 10_000,
    retry: { maxAttempts: 1, initialDelayMs: 100 },
    idempotencyKey: '',
  },
  capture: {
    mode: 'full',
    paths: [],
    responseHeaders: [],
    contract: [],
    availableResponseHeaders: [],
  },
  test: { state: 'tested', evidence: null },
});

describe('ChatbotFlowRunnerService captured node outputs', () => {
  const originalAppEnvironment = process.env.APP_ENVIRONMENT;
  const originalLocalhostFlag =
    process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalAppEnvironment === undefined) {
      delete process.env.APP_ENVIRONMENT;
    } else {
      process.env.APP_ENVIRONMENT = originalAppEnvironment;
    }
    if (originalLocalhostFlag === undefined) {
      delete process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP;
    } else {
      process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP =
        originalLocalhostFlag;
    }
  });

  it.each([
    ['name', '  Maria Silva  ', 'Maria Silva'],
    ['lastname', '  Souza  ', 'Souza'],
    ['email', '  maria@example.com  ', 'maria@example.com'],
    ['cpf', '529.982.247-25', '52998224725'],
    ['cnpj', '04.252.011/0001-10', '04252011000110'],
  ] as const)(
    'persists normalized Data %s before running the downstream node',
    async (dataType, received, normalized) => {
      const { runner, runtime } = createRunner();
      const node = {
        id: 'data-node',
        type: 'data',
        position: { x: 0, y: 0 },
        data: { dataType, outputKey: 'data_1' },
      } as ListChatbotFlowResponse['nodes'][number];
      const flow = flowWithNode(node);
      const data = incomingMessage(received);

      await runner.processDataNode(
        ((key: string) => key) as never,
        data,
        chat,
        flow,
        node.id
      );

      expect(runtime.service.withCapture).toHaveBeenCalledWith(
        expect.any(Object),
        'data_1',
        { value: normalized, [dataType]: normalized }
      );
      expect(runtime.service.persistTransition).toHaveBeenCalledWith(
        expect.objectContaining({ nextNodeId: 'api-1' })
      );
      expect(runner.processNextNode).toHaveBeenCalledWith(
        expect.any(Function),
        chat,
        flow,
        'api-1',
        undefined,
        data
      );
    }
  );

  it('keeps an awaited Message node pinned, then captures and advances to API', async () => {
    const { runner, runtime } = createRunner();
    const node = {
      id: 'message-node',
      type: 'message',
      position: { x: 0, y: 0 },
      data: {
        messageType: EMessageType.text,
        text: 'Qual é a sua escolha?',
        continueType: 'after_response',
        outputKey: 'message_1',
      },
    } as ListChatbotFlowResponse['nodes'][number];
    const flow = flowWithNode(node);

    await runner.processMessageNode(
      ((key: string) => key) as never,
      chat,
      node,
      flow
    );

    expect(runner.sendMessage).toHaveBeenCalledTimes(1);
    expect(runtime.service.withCapture).not.toHaveBeenCalled();
    expect(runtime.service.persistTransition).toHaveBeenLastCalledWith(
      expect.objectContaining({ nextNodeId: 'message-node' })
    );

    const reply = incomingMessage('Minha resposta');
    await runner.processMessageNodeType(
      ((key: string) => key) as never,
      chat,
      flow,
      node,
      node.id,
      undefined,
      reply
    );

    expect(runner.sendMessage).toHaveBeenCalledTimes(1);
    expect(runtime.service.withCapture).toHaveBeenCalledWith(
      expect.any(Object),
      'message_1',
      {
        text: 'Minha resposta',
        type: EMessageType.text,
        media: null,
      }
    );
    expect(runtime.service.persistTransition).toHaveBeenLastCalledWith(
      expect.objectContaining({ nextNodeId: 'api-1' })
    );
    expect(runner.processNextNode).toHaveBeenCalledWith(
      expect.any(Function),
      chat,
      flow,
      'api-1',
      undefined,
      reply
    );
  });

  it.each([
    [
      EMessageType.image,
      {
        url: 'https://cdn.example.com/image.jpg',
        mimetype: 'image/jpeg',
        extension: 'jpg',
        size: 1024,
        width: 800,
        height: 600,
      },
      { caption: 'Comprovante' },
      {
        text: 'Comprovante',
        type: EMessageType.image,
        media: {
          url: 'https://cdn.example.com/image.jpg',
          name: null,
          mimetype: 'image/jpeg',
          extension: 'jpg',
          size: 1024,
          duration: null,
          width: 800,
          height: 600,
        },
      },
    ],
    [
      EMessageType.video,
      {
        url: 'https://cdn.example.com/video.mp4',
        name: 'resposta.mp4',
        mimetype: 'video/mp4',
        extension: 'mp4',
        size: 8192,
        duration: 18,
        width: 1920,
        height: 1080,
      },
      { caption: 'Meu vídeo' },
      {
        text: 'Meu vídeo',
        type: EMessageType.video,
        media: {
          url: 'https://cdn.example.com/video.mp4',
          name: 'resposta.mp4',
          mimetype: 'video/mp4',
          extension: 'mp4',
          size: 8192,
          duration: 18,
          width: 1920,
          height: 1080,
        },
      },
    ],
    [
      EMessageType.video,
      null,
      {},
      {
        text: '',
        type: EMessageType.video,
        media: {
          url: null,
          name: null,
          mimetype: null,
          extension: null,
          size: null,
          duration: null,
          width: null,
          height: null,
        },
      },
    ],
    [
      EMessageType.audio,
      {
        url: 'https://cdn.example.com/audio.ogg',
        mimetype: 'audio/ogg',
        extension: 'ogg',
        size: 2048,
        duration: 12,
      },
      {},
      {
        text: '',
        type: EMessageType.audio,
        media: {
          url: 'https://cdn.example.com/audio.ogg',
          name: null,
          mimetype: 'audio/ogg',
          extension: 'ogg',
          size: 2048,
          duration: 12,
          width: null,
          height: null,
        },
      },
    ],
    [
      EMessageType.document,
      {
        url: 'https://cdn.example.com/report.pdf',
        name: 'report.pdf',
        mimetype: 'application/pdf',
        extension: 'pdf',
        size: 4096,
      },
      {},
      {
        text: '',
        type: EMessageType.document,
        media: {
          url: 'https://cdn.example.com/report.pdf',
          name: 'report.pdf',
          mimetype: 'application/pdf',
          extension: 'pdf',
          size: 4096,
          duration: null,
          width: null,
          height: null,
        },
      },
    ],
    [
      EMessageType.document,
      null,
      {},
      {
        text: '',
        type: EMessageType.document,
        media: {
          url: null,
          name: null,
          mimetype: null,
          extension: null,
          size: null,
          duration: null,
          width: null,
          height: null,
        },
      },
    ],
  ] as const)(
    'captures %s replies and advances to the next node',
    async (type, media, options, expectedCapture) => {
      const { runner, runtime } = createRunner();
      const node = {
        id: 'message-node',
        type: 'message',
        position: { x: 0, y: 0 },
        data: { continueType: 'after_response', outputKey: 'message_1' },
      } as ListChatbotFlowResponse['nodes'][number];
      const flow = flowWithNode(node);
      const reply = incomingMediaMessage(type, media, options);

      await runner.processMessageNodeType(
        ((key: string) => key) as never,
        chat,
        flow,
        node,
        node.id,
        undefined,
        reply
      );

      expect(runtime.service.withCapture).toHaveBeenCalledWith(
        expect.any(Object),
        'message_1',
        expectedCapture
      );
      expect(runner.processNextNode).toHaveBeenCalledWith(
        expect.any(Function),
        chat,
        flow,
        'api-1',
        undefined,
        reply
      );
    }
  );

  it.each([
    incomingMediaMessage(EMessageType.image, null, { fromMe: true }),
    incomingUnsupportedMessage(),
  ])('does not advance on unsupported or self-sent replies', async (reply) => {
    const { runner, runtime } = createRunner();
    const node = {
      id: 'message-node',
      type: 'message',
      position: { x: 0, y: 0 },
      data: { continueType: 'after_response', outputKey: 'message_1' },
    } as ListChatbotFlowResponse['nodes'][number];

    const processed = await runner.processMessageNodeType(
      ((key: string) => key) as never,
      chat,
      flowWithNode(node),
      node,
      node.id,
      undefined,
      reply
    );

    expect(processed).toBe(reply.message.key.fromMe ? true : false);
    expect(runtime.service.withCapture).not.toHaveBeenCalled();
    expect(runner.processNextNode).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, false],
    ['true', true],
  ] as const)(
    'runs API nodes with localhost flag %s resolved as %s',
    async (flag, expected) => {
      process.env.APP_ENVIRONMENT = 'LOCAL';
      if (flag === undefined) {
        delete process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP;
      } else {
        process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP = flag;
      }
      jest.spyOn(console, 'info').mockImplementation(() => undefined);
      const execute = jest
        .spyOn(ChatbotApiRequestExecutorService.prototype, 'execute')
        .mockResolvedValue({
          mode: 'once',
          ok: true,
          outputKey: 'api_1',
          body: { ok: true },
          response: {
            status: 200,
            ok: true,
            headers: {},
            contentType: 'application/json',
            sizeBytes: 11,
            durationMs: 2,
            attempts: 1,
          },
          items: [
            {
              index: 0,
              ok: true,
              body: { ok: true },
              response: {
                status: 200,
                ok: true,
                headers: {},
                contentType: 'application/json',
                sizeBytes: 11,
                durationMs: 2,
                attempts: 1,
              },
            },
          ],
          durationMs: 2,
        });
      const { runner } = createRunner();
      const node = {
        id: 'api-node',
        type: 'apiRequest',
        position: { x: 0, y: 0 },
        data: { apiRequest: apiConfiguration() },
      } as ListChatbotFlowResponse['nodes'][number];
      const flow: ListChatbotFlowResponse = {
        chatbot_flow_id: 'flow-1',
        chatbot_id: 'chatbot-1',
        account_id: 'account-1',
        nodes: [
          node,
          {
            id: 'finish-node',
            type: 'finish',
            position: { x: 1, y: 0 },
            data: {},
          },
        ],
        edges: [
          {
            id: 'success-edge',
            source: node.id,
            target: 'finish-node',
            sourceHandle: 'success',
          },
        ],
      };

      await runner.processApiRequestNode(
        ((key: string) => key) as never,
        chat,
        flow,
        node
      );

      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ allowLocalhostHttp: expected })
      );
    }
  );
});
