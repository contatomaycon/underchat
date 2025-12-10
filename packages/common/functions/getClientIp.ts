import { FastifyRequest } from 'fastify';

export function getClientIp(request: FastifyRequest): string {
  const xForwardedFor = request.headers['x-forwarded-for'];
  if (xForwardedFor) {
    const forwardedIps = String(xForwardedFor).split(',');
    const firstIp = forwardedIps[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const xRealIp = request.headers['x-real-ip'];
  if (xRealIp && typeof xRealIp === 'string') {
    return xRealIp.trim();
  }

  if (request.ip) {
    return request.ip;
  }

  if (request.socket.remoteAddress) {
    return request.socket.remoteAddress;
  }

  return '127.0.0.1';
}
