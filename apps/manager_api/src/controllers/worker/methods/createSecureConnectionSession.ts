import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { WorkerSecureConnectionSessionUseCase } from '@core/useCases/worker/WorkerSecureConnectionSession.useCase';
import { WorkerSecureConnectionParams } from '@core/schema/worker/secureConnection/request.schema';
import { extractConnectionLifecycleDebugTraceIdFromHeaders } from '@core/services/connectionLifecycleDebug.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { handleSecureConnectionError } from './secureConnectionError';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';

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

  try {
    const response = await useCase.create(t, {
      accountId: tokenJwtData.account_id,
      workerId: request.params.worker_id,
      apiBaseUrl: resolveApiBaseUrl(request),
      debugTraceId,
    });

    return sendResponse(reply, {
      message: t('worker_secure_connection_session_created'),
      httpStatusCode: EHTTPStatusCode.created,
      data: response,
    });
  } catch (error) {
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
