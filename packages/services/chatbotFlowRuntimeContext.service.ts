import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import {
  createChatbotFlowCacheKey,
  createChatbotFlowContextCacheKey,
} from '@core/common/functions/createCacheKey';
import { createChatbotApiVariableOutput } from '@core/common/functions/chatbotApiVariables';
import { createChatbotUnderchatVariableOutput } from '@core/common/functions/chatbotUnderchatOutputFormatters';
import type { ChatbotUnderchatLookupOutput } from '@core/common/interfaces/IChatbotUnderchatLookup';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { EMessageType } from '@core/common/enums/EMessageType';

export const CHATBOT_FLOW_RUNTIME_CONTEXT_TTL_SECONDS = 259200;
export const CHATBOT_FLOW_RUNTIME_CONTEXT_MAX_BYTES = 256 * 1024;

export type ChatbotDataCaptureField =
  'name' | 'lastname' | 'email' | 'cpf' | 'cnpj';

export type ChatbotDataRuntimeCapture = {
  readonly value: string;
} & Readonly<Partial<Record<ChatbotDataCaptureField, string>>>;

export type ChatbotMessageResponseType =
  | EMessageType.text
  | EMessageType.image
  | EMessageType.video
  | EMessageType.audio
  | EMessageType.document;

export interface ChatbotMessageCaptureMedia {
  readonly url: string | null;
  readonly name: string | null;
  readonly mimetype: string | null;
  readonly extension: string | null;
  readonly size: number | null;
  readonly duration: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface ChatbotMessageRuntimeCapture {
  readonly text: string;
  /** Optional so contexts persisted before media replies remain readable. */
  readonly type?: ChatbotMessageResponseType;
  readonly media?: ChatbotMessageCaptureMedia | null;
}

export type ChatbotNodeRuntimeCapture =
  ChatbotDataRuntimeCapture | ChatbotMessageRuntimeCapture;

export interface ChatbotApiResponseMetadata {
  readonly status: number | null;
  readonly ok: boolean;
  readonly headers: Readonly<Record<string, string | readonly string[]>>;
  readonly contentType: string | null;
  readonly sizeBytes: number;
  readonly durationMs: number;
  readonly attempts: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

export interface ChatbotApiRuntimeOutput {
  readonly body: unknown;
  readonly response:
    ChatbotApiResponseMetadata | readonly ChatbotApiResponseMetadata[];
}

export interface ChatbotApiInvocationState {
  readonly invocationId: string;
  readonly status: 'started' | 'completed' | 'indeterminate';
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface ChatbotFlowRuntimeContext {
  readonly version: 1;
  readonly chatbotId: string;
  readonly flowId: string;
  readonly outputs: Readonly<Record<string, ChatbotApiRuntimeOutput>>;
  readonly captures?: Readonly<Record<string, ChatbotNodeRuntimeCapture>>;
  readonly lookups?: Readonly<Record<string, ChatbotUnderchatLookupOutput>>;
  readonly invocations: Readonly<Record<string, ChatbotApiInvocationState>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class ChatbotFlowRuntimeContextError extends Error {
  public readonly code: 'context_too_large' | 'invalid_context';

  constructor(code: 'context_too_large' | 'invalid_context', message: string) {
    super(message);
    this.name = 'ChatbotFlowRuntimeContextError';
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const API_OUTPUT_KEY_PATTERN = /^api_[1-9]\d*$/u;
const UNDERCHAT_OUTPUT_KEY_PATTERN = /^underchat_[1-9]\d*$/u;

const LEGACY_UNDERCHAT_ACCOUNT_KEYS = [
  'status',
  'plan',
  'billing_period',
  'last_payment_at',
  'next_renewal_at',
  'last_paid_amount',
] as const;
const UNDERCHAT_ACCOUNT_KEYS = [
  'id',
  'name',
  ...LEGACY_UNDERCHAT_ACCOUNT_KEYS,
] as const;
const UNDERCHAT_USER_KEYS = [
  'email',
  'name',
  'status',
  'document',
  'phone',
  'access_group',
  'sectors',
  'channels',
] as const;

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean => {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    actualKeys.every((key) => keys.includes(key))
  );
};

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isNullableFiniteNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

const MESSAGE_RESPONSE_TYPES = new Set<ChatbotMessageResponseType>([
  EMessageType.text,
  EMessageType.image,
  EMessageType.video,
  EMessageType.audio,
  EMessageType.document,
]);

const isChatbotMessageCaptureMedia = (
  value: unknown
): value is ChatbotMessageCaptureMedia => {
  if (!isRecord(value)) return false;
  return (
    hasExactKeys(value, [
      'url',
      'name',
      'mimetype',
      'extension',
      'size',
      'duration',
      'width',
      'height',
    ]) &&
    isNullableString(value.url) &&
    isNullableString(value.name) &&
    isNullableString(value.mimetype) &&
    isNullableString(value.extension) &&
    isNullableFiniteNumber(value.size) &&
    isNullableFiniteNumber(value.duration) &&
    isNullableFiniteNumber(value.width) &&
    isNullableFiniteNumber(value.height)
  );
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isUnderchatLookupOutput = (
  value: unknown
): value is ChatbotUnderchatLookupOutput => {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.account)) {
    return false;
  }
  if (
    !hasExactKeys(value, ['found', 'user', 'account']) ||
    !hasExactKeys(value.user, UNDERCHAT_USER_KEYS) ||
    !hasExactKeys(value.account, UNDERCHAT_ACCOUNT_KEYS)
  ) {
    return false;
  }

  const userValues = [
    value.user.email,
    value.user.name,
    value.user.status,
    value.user.document,
    value.user.phone,
    value.user.access_group,
  ];
  const accountValues = [
    value.account.id,
    value.account.name,
    value.account.status,
    value.account.plan,
    value.account.billing_period,
    value.account.last_payment_at,
    value.account.next_renewal_at,
  ];
  const amount = value.account.last_paid_amount;
  return (
    typeof value.found === 'boolean' &&
    userValues.every(isNullableString) &&
    isStringArray(value.user.sectors) &&
    isStringArray(value.user.channels) &&
    accountValues.every(isNullableString) &&
    (amount === null || (typeof amount === 'number' && Number.isFinite(amount)))
  );
};

const normalizeLegacyUnderchatLookupOutput = (value: unknown): unknown => {
  if (
    !isRecord(value) ||
    !isRecord(value.user) ||
    !isRecord(value.account) ||
    !hasExactKeys(value, ['found', 'user', 'account']) ||
    !hasExactKeys(value.user, UNDERCHAT_USER_KEYS)
  ) {
    return value;
  }

  if (hasExactKeys(value.account, UNDERCHAT_ACCOUNT_KEYS)) return value;
  if (!hasExactKeys(value.account, LEGACY_UNDERCHAT_ACCOUNT_KEYS)) return value;

  return {
    ...value,
    account: {
      id: null,
      name: null,
      ...value.account,
    },
  };
};

const normalizeLegacyRuntimeContext = (value: unknown): unknown => {
  if (!isRecord(value) || !isRecord(value.lookups)) return value;

  return {
    ...value,
    lookups: Object.fromEntries(
      Object.entries(value.lookups).map(([key, output]) => [
        key,
        normalizeLegacyUnderchatLookupOutput(output),
      ])
    ),
  };
};

const isNodeRuntimeCapture = (
  value: unknown
): value is ChatbotNodeRuntimeCapture => {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  if (typeof value.text === 'string') {
    if (entries.length === 1 && entries[0]?.[0] === 'text') return true;
    return (
      hasExactKeys(value, ['text', 'type', 'media']) &&
      typeof value.type === 'string' &&
      MESSAGE_RESPONSE_TYPES.has(value.type as ChatbotMessageResponseType) &&
      (value.media === null || isChatbotMessageCaptureMedia(value.media))
    );
  }
  if (typeof value.value !== 'string') return false;
  const aliases = entries.filter(([key]) => key !== 'value');
  return (
    aliases.length === 1 &&
    aliases[0]?.[1] === value.value &&
    entries.every(
      ([key, entry]) =>
        key === 'value' ||
        (['name', 'lastname', 'email', 'cpf', 'cnpj'].includes(key) &&
          typeof entry === 'string')
    )
  );
};

const captureMatchesOutputKey = (
  outputKey: string,
  capture: unknown
): capture is ChatbotNodeRuntimeCapture =>
  isNodeRuntimeCapture(capture) &&
  ((/^data_[1-9]\d*$/u.test(outputKey) && 'value' in capture) ||
    (/^message_[1-9]\d*$/u.test(outputKey) && 'text' in capture));

const isRuntimeContext = (
  value: unknown
): value is ChatbotFlowRuntimeContext => {
  if (!isRecord(value)) return false;
  const captures = value.captures;
  const lookups = value.lookups;
  return (
    value.version === 1 &&
    typeof value.chatbotId === 'string' &&
    value.chatbotId.length > 0 &&
    typeof value.flowId === 'string' &&
    value.flowId.length > 0 &&
    isRecord(value.outputs) &&
    Object.keys(value.outputs).every((outputKey) =>
      API_OUTPUT_KEY_PATTERN.test(outputKey)
    ) &&
    (captures === undefined ||
      (isRecord(captures) &&
        Object.entries(captures).every(([outputKey, capture]) =>
          captureMatchesOutputKey(outputKey, capture)
        ))) &&
    (lookups === undefined ||
      (isRecord(lookups) &&
        Object.entries(lookups).every(
          ([outputKey, output]) =>
            UNDERCHAT_OUTPUT_KEY_PATTERN.test(outputKey) &&
            isUnderchatLookupOutput(output)
        ))) &&
    isRecord(value.invocations) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
};

@injectable()
export class ChatbotFlowRuntimeContextService {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  public create(chatbotId: string, flowId: string): ChatbotFlowRuntimeContext {
    const now = new Date().toISOString();
    return {
      version: 1,
      chatbotId,
      flowId,
      outputs: {},
      captures: {},
      lookups: {},
      invocations: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  public withOutput(
    context: ChatbotFlowRuntimeContext,
    outputKey: string,
    output: ChatbotApiRuntimeOutput
  ): ChatbotFlowRuntimeContext {
    if (!API_OUTPUT_KEY_PATTERN.test(outputKey)) {
      throw new ChatbotFlowRuntimeContextError(
        'invalid_context',
        'API output key is invalid'
      );
    }

    return {
      ...context,
      outputs: {
        ...context.outputs,
        [outputKey]: output,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  public withInvocation(
    context: ChatbotFlowRuntimeContext,
    nodeId: string,
    invocation: ChatbotApiInvocationState
  ): ChatbotFlowRuntimeContext {
    return {
      ...context,
      invocations: {
        ...context.invocations,
        [nodeId]: invocation,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  public withCapture(
    context: ChatbotFlowRuntimeContext,
    outputKey: string,
    capture: ChatbotNodeRuntimeCapture
  ): ChatbotFlowRuntimeContext {
    const normalizedOutputKey = outputKey.trim();
    if (!captureMatchesOutputKey(normalizedOutputKey, capture)) {
      throw new ChatbotFlowRuntimeContextError(
        'invalid_context',
        'Chatbot capture output key is invalid'
      );
    }

    return {
      ...context,
      captures: {
        ...(context.captures ?? {}),
        [normalizedOutputKey]: capture,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  public withLookup(
    context: ChatbotFlowRuntimeContext,
    outputKey: string,
    output: ChatbotUnderchatLookupOutput
  ): ChatbotFlowRuntimeContext {
    const normalizedOutputKey = outputKey.trim();
    if (
      !UNDERCHAT_OUTPUT_KEY_PATTERN.test(normalizedOutputKey) ||
      !isUnderchatLookupOutput(output)
    ) {
      throw new ChatbotFlowRuntimeContextError(
        'invalid_context',
        'Underchat lookup output is invalid'
      );
    }

    return {
      ...context,
      lookups: {
        ...(context.lookups ?? {}),
        [normalizedOutputKey]: output,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  public toVariableScope(
    context: ChatbotFlowRuntimeContext,
    builtIns: Readonly<Record<string, unknown>> = {}
  ): Record<string, unknown> {
    const scope = Object.create(null) as Record<string, unknown>;
    const defineVariable = (key: string, value: unknown): void => {
      Object.defineProperty(scope, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    };
    for (const [key, value] of Object.entries(builtIns)) {
      defineVariable(key, value);
    }
    for (const [outputKey, output] of Object.entries(context.outputs)) {
      defineVariable(
        outputKey,
        createChatbotApiVariableOutput(output.body, output.response)
      );
    }
    for (const [outputKey, capture] of Object.entries(context.captures ?? {})) {
      defineVariable(outputKey, capture);
    }
    for (const [outputKey, lookup] of Object.entries(context.lookups ?? {})) {
      defineVariable(outputKey, createChatbotUnderchatVariableOutput(lookup));
    }
    return scope;
  }

  public serialize(context: ChatbotFlowRuntimeContext): string {
    if (!isRuntimeContext(context)) {
      throw new ChatbotFlowRuntimeContextError(
        'invalid_context',
        'Chatbot flow runtime context is invalid'
      );
    }
    const serialized = JSON.stringify(context);
    const byteLength = Buffer.byteLength(serialized, 'utf8');
    if (byteLength > CHATBOT_FLOW_RUNTIME_CONTEXT_MAX_BYTES) {
      throw new ChatbotFlowRuntimeContextError(
        'context_too_large',
        'Chatbot flow runtime context exceeds 256 KiB'
      );
    }
    return this.passwordEncryptorService.encrypt(serialized);
  }

  public deserialize(encrypted: string): ChatbotFlowRuntimeContext {
    try {
      const parsed: unknown = JSON.parse(
        this.passwordEncryptorService.decrypt(encrypted)
      );
      const normalized = normalizeLegacyRuntimeContext(parsed);
      if (!isRuntimeContext(normalized)) {
        throw new Error('invalid shape');
      }
      return normalized;
    } catch {
      throw new ChatbotFlowRuntimeContextError(
        'invalid_context',
        'Chatbot flow runtime context is invalid'
      );
    }
  }

  public async load(input: {
    accountId: string;
    workerId: string;
    chatId: string;
  }): Promise<ChatbotFlowRuntimeContext | null> {
    const key = createChatbotFlowContextCacheKey(
      input.accountId,
      input.workerId,
      input.chatId
    );
    const encrypted = await this.redis.get(key);
    if (!encrypted) return null;
    try {
      return this.deserialize(encrypted);
    } catch {
      await this.redis.del(key);
      return null;
    }
  }

  public async persistTransition(input: {
    accountId: string;
    workerId: string;
    chatId: string;
    nextNodeId: string;
    context: ChatbotFlowRuntimeContext;
  }): Promise<void> {
    const flowKey = createChatbotFlowCacheKey(
      input.accountId,
      input.workerId,
      input.chatId
    );
    const contextKey = createChatbotFlowContextCacheKey(
      input.accountId,
      input.workerId,
      input.chatId
    );
    const encrypted = this.serialize(input.context);
    const results = await this.redis
      .multi()
      .set(
        flowKey,
        input.nextNodeId,
        'EX',
        CHATBOT_FLOW_RUNTIME_CONTEXT_TTL_SECONDS
      )
      .set(
        contextKey,
        encrypted,
        'EX',
        CHATBOT_FLOW_RUNTIME_CONTEXT_TTL_SECONDS
      )
      .exec();

    if (!results || results.some(([error]) => error !== null)) {
      throw new Error('persist chatbot API runtime transition failed');
    }
  }

  public async clear(input: {
    accountId: string;
    workerId: string;
    chatId: string;
  }): Promise<void> {
    await this.redis.del(
      createChatbotFlowContextCacheKey(
        input.accountId,
        input.workerId,
        input.chatId
      )
    );
  }
}
