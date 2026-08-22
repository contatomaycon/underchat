import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { ChatbotApiRequestTestError } from '@core/common/exceptions/ChatbotApiRequestTestError';
import {
  createApiRequestFingerprint,
  decryptApiRequestSecrets,
  encryptApiRequestSecrets,
  signApiRequestProof,
} from '@core/common/functions/chatbotApiRequestSecurity';
import {
  discoverChatbotApiResponseFields,
  expandChatbotVariableValues,
} from '@core/common/functions/chatbotApiVariables';
import type { TestApiRequestRequest } from '@core/schema/chatbot/testApiRequest/request.schema';
import type { TestApiRequestResponse } from '@core/schema/chatbot/testApiRequest/response.schema';
import type {
  ApiRequestConfig,
  ApiResponseContractField,
} from '@core/schema/chatbot/chatbotFlow.schema';
import { ChatbotService } from '@core/services/chatbot.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { ChatbotApiRequestExecutorService } from '@core/services/chatbotApiRequestExecutor.service';
import { getChatbotApiOutboundHttpPolicy } from '@core/common/functions/chatbotApiOutboundHttpPolicy';

const MAX_TESTS_PER_MINUTE = 10;
const TEST_PREVIEW_MAX_BYTES = 64 * 1024;
const MAX_HEADER_VALUE_LENGTH = 4096;
const REDACTED_RESPONSE_HEADERS = new Set([
  'authorization',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'cookie',
]);

const bodyTypeOf = (body: unknown): string => {
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return 'binary';
  if (body === null) return 'null';
  if (Array.isArray(body)) return 'array';
  return typeof body === 'object' ? 'json' : typeof body;
};

const limitedPreview = (body: unknown): unknown => {
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    const buffer = Buffer.from(body);
    return {
      type: 'binary',
      sizeBytes: buffer.byteLength,
      base64: buffer.subarray(0, 4096).toString('base64'),
      truncated: buffer.byteLength > 4096,
    };
  }
  const serialized = JSON.stringify(body);
  if (serialized === undefined) return String(body);
  if (Buffer.byteLength(serialized, 'utf8') <= TEST_PREVIEW_MAX_BYTES) {
    return body;
  }
  return {
    type: bodyTypeOf(body),
    preview: serialized.slice(0, TEST_PREVIEW_MAX_BYTES),
    truncated: true,
  };
};

const flattenHeaders = (
  headers: Readonly<Record<string, string | readonly string[]>>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => !REDACTED_RESPONSE_HEADERS.has(name.toLowerCase()))
      .slice(0, 100)
      .map(([name, value]) => [
        name.toLowerCase(),
        (typeof value === 'string' ? value : value.join(', ')).slice(
          0,
          MAX_HEADER_VALUE_LENGTH
        ),
      ])
  );

const inferContract = (body: unknown): ApiResponseContractField[] => {
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return [{ path: '$', type: 'binary' }];
  }
  return discoverChatbotApiResponseFields(body).map((field) => ({
    path: field.path,
    type: field.type,
    projectedFromArray: field.path.includes('[]'),
  }));
};

@injectable()
export class ChatbotApiRequestTesterUseCase {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  private async consumeRateLimit(
    accountId: string,
    userId: string
  ): Promise<void> {
    const key = `underchat:chatbot-api-test:${accountId}:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 60);
    if (count > MAX_TESTS_PER_MINUTE) {
      throw new ChatbotApiRequestTestError(
        'test_rate_limit_exceeded',
        EHTTPStatusCode.too_many_requests,
        'chatbot_api_request_test_rate_limit_exceeded'
      );
    }
  }

  private async prepareConfiguration(
    input: TestApiRequestRequest,
    accountId: string
  ): Promise<{ secured: ApiRequestConfig; plain: ApiRequestConfig }> {
    const flow = await this.chatbotService.findChatbotFlowByChatbotId(
      accountId,
      input.chatbot_id
    );
    const previous = flow?.nodes.find(
      (node) => node.id === input.node_id && node.type === 'apiRequest'
    )?.data.apiRequest;
    const secured = encryptApiRequestSecrets(
      input.configuration,
      this.passwordEncryptorService,
      previous
    );
    return {
      secured,
      plain: decryptApiRequestSecrets(secured, this.passwordEncryptorService),
    };
  }

  public async execute(
    input: TestApiRequestRequest,
    accountId: string,
    userId: string
  ): Promise<TestApiRequestResponse> {
    await this.consumeRateLimit(accountId, userId);
    if (
      !(await this.chatbotService.isChatbotActive(accountId, input.chatbot_id))
    ) {
      throw new ChatbotApiRequestTestError(
        'chatbot_not_found',
        EHTTPStatusCode.not_found,
        'chatbot_not_found'
      );
    }
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(input.configuration.method) &&
      !input.confirm_side_effects
    ) {
      throw new ChatbotApiRequestTestError(
        'side_effect_confirmation_required',
        EHTTPStatusCode.bad_request,
        'chatbot_api_request_test_side_effect_confirmation_required'
      );
    }

    const { secured, plain } = await this.prepareConfiguration(
      input,
      accountId
    );
    const testConfig: ApiRequestConfig = {
      ...secured,
      execution: {
        ...secured.execution,
        mode: 'once',
        retry: { ...secured.execution.retry, maxAttempts: 1 },
      },
      capture: { ...secured.capture, mode: 'full', paths: [] },
    };
    const executor = new ChatbotApiRequestExecutorService({
      secretDecryptor: this.passwordEncryptorService,
    });
    let sampleVariables: Record<string, unknown>;
    try {
      sampleVariables = expandChatbotVariableValues(
        input.sample_variables ?? {}
      );
    } catch {
      throw new ChatbotApiRequestTestError(
        'invalid_api_request',
        EHTTPStatusCode.bad_request,
        'chatbot_api_request_test_failed'
      );
    }
    const result = await executor.execute({
      config: testConfig,
      variables: sampleVariables,
      ...getChatbotApiOutboundHttpPolicy(),
      maxHttpAttempts: 1,
      captureAllResponseHeaders: true,
    });
    const response = Array.isArray(result.response)
      ? result.response[0]
      : result.response;
    if (!response || response.status === null) {
      if (response?.error?.code === 'variable_resolution_failed') {
        throw new ChatbotApiRequestTestError(
          'sample_variables_required',
          EHTTPStatusCode.bad_request,
          'chatbot_api_request_test_sample_variables_required'
        );
      }

      const preparationCodes = new Set([
        'invalid_config',
        'invalid_url_template',
        'missing_secret',
        'secret_decryption_failed',
        'invalid_json_body',
        'invalid_multipart_file',
      ]);
      throw new ChatbotApiRequestTestError(
        preparationCodes.has(response?.error?.code ?? '')
          ? 'invalid_api_request'
          : 'api_request_failed',
        preparationCodes.has(response?.error?.code ?? '')
          ? EHTTPStatusCode.bad_request
          : EHTTPStatusCode.service_unavailable,
        'chatbot_api_request_test_failed'
      );
    }
    const body =
      Array.isArray(result.body) && result.mode === 'forEach'
        ? result.body[0]
        : result.body;
    const headers = flattenHeaders(response?.headers ?? {});
    const contract = inferContract(body);
    const testedAt = new Date().toISOString();
    const fingerprint = createApiRequestFingerprint(
      plain,
      input.upstream_contracts ?? {}
    );
    const statusCode = response?.status ?? 0;
    const bodyType = bodyTypeOf(body);
    const evidence = {
      fingerprint,
      testedAt,
      statusCode,
      durationMs: result.durationMs,
      bodyType,
      proof: signApiRequestProof({
        accountId,
        chatbotId: input.chatbot_id,
        nodeId: input.node_id,
        fingerprint,
        testedAt,
        statusCode,
        bodyType,
        contract,
        responseHeaders: Object.keys(headers),
      }),
    };

    return {
      ok: result.ok,
      statusCode,
      durationMs: result.durationMs,
      headers,
      bodyType,
      preview: limitedPreview(body),
      contract,
      evidence,
    };
  }
}
