import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { WorkerSecureConnectionSessionUseCase } from '@core/useCases/worker/WorkerSecureConnectionSession.useCase';
import { WorkerSecureConnectionParams } from '@core/schema/worker/secureConnection/request.schema';
import { extractConnectionLifecycleDebugTraceIdFromHeaders } from '@core/services/connectionLifecycleDebug.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { handleSecureConnectionError } from './secureConnectionError';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';
import {
  getSecureConnectionErrorMessage,
  logSecureConnectionHttpFlow,
} from './secureConnectionLog';

export const createSecureConnectionSession = async (
  request: FastifyRequest<{
    Params: WorkerSecureConnectionParams;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(WorkerSecureConnectionSessionUseCase);
  const { t, tokenJwtData } = request;
  const debugTraceId = extractConnectionLifecycleDebugTraceIdFromHeaders(
    request.headers as Record<string, string | string[] | undefined>
  );
  const apiBaseUrl = resolveApiBaseUrl(request);

  try {
    logSecureConnectionHttpFlow(
      'manager.http.secure_connection.create.received',
      {
        trace_id: debugTraceId,
        request_id: request.id,
        worker_id: request.params.worker_id,
        account_id: tokenJwtData.account_id,
        api_base_url: apiBaseUrl,
      }
    );

    const response = await useCase.create(t, {
      accountId: tokenJwtData.account_id,
      workerId: request.params.worker_id,
      apiBaseUrl,
      debugTraceId,
    });

    logSecureConnectionHttpFlow('manager.http.secure_connection.create.done', {
      trace_id: debugTraceId,
      request_id: request.id,
      worker_id: response.worker_id,
      account_id: tokenJwtData.account_id,
      worker_type_id: response.worker_type_id,
      connection_attempt_id: response.connection_attempt_id,
      runtime_generation: response.runtime_generation,
      status: response.status,
      token_hash: response.token_hash,
      expires_at: response.expires_at,
    });

    return sendResponse(reply, {
      message: t('worker_secure_connection_session_created'),
      httpStatusCode: EHTTPStatusCode.created,
      data: response,
    });
  } catch (error) {
    logSecureConnectionHttpFlow('manager.http.secure_connection.create.error', {
      trace_id: debugTraceId,
      request_id: request.id,
      worker_id: request.params.worker_id,
      account_id: tokenJwtData.account_id,
      reason: getSecureConnectionErrorMessage(error),
    });
    handleSecureConnectionError(error, reply, t);
  }
};

function resolveApiBaseUrl(request: FastifyRequest): string {
  const forwardedProto = firstHeader(request.headers['x-forwarded-proto']);
  const proto = forwardedProto || request.protocol || 'http';
  const forwardedHost = firstHeader(request.headers['x-forwarded-host']);
  const host = forwardedHost || firstHeader(request.headers.host);

  if (host) {
    return ensureApiPrefix(`${proto}://${host}`);
  }

  return ensureApiPrefix(
    process.env.MANAGER_API_PUBLIC_URL ||
      process.env.APP_URL_MANAGER_API ||
      process.env.APP_URL_MANAGER ||
      'http://localhost:3002'
  );
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function ensureApiPrefix(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  const prefix = `/${EPrefixRoutes.v1}`;

  return normalized.endsWith(prefix) ? normalized : `${normalized}${prefix}`;
}
