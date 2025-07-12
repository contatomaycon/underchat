import { FastifyReply } from 'fastify';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { IResponseService } from '../interfaces/IResponseServices';

interface ResponseBody<T> {
  id: string | null;
  status: boolean;
  message: string;
  data: T;
}

export function sendResponse<T>(
  reply: FastifyReply,
  response: IResponseService<T>
) {
  const httpStatusCode = response.httpStatusCode ?? EHTTPStatusCode.ok;

  const isSuccess =
    typeof response.status === 'boolean'
      ? response.status
      : httpStatusCode >= EHTTPStatusCode.ok &&
        httpStatusCode < EHTTPStatusCode.multiple_choices;

  const responseBody = {
    id: reply.request.id ? reply.request.id : null,
    status: isSuccess,
    message: response.message ?? '',
    data: response.data ?? null,
  } as ResponseBody<T>;

  reply.code(httpStatusCode).send(responseBody);
}
