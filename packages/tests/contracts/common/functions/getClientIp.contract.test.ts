import { getClientIp } from '@core/common/functions/getClientIp';

describe('getClientIp', () => {
  it('uses first x-forwarded-for IP when present', () => {
    const request = {
      headers: {
        'x-forwarded-for': ' 10.0.0.1 , 10.0.0.2',
      },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.2' },
    };

    expect(getClientIp(request as never)).toBe('10.0.0.1');
  });

  it('falls back to x-real-ip when x-forwarded-for is empty', () => {
    const request = {
      headers: {
        'x-forwarded-for': ' , ',
        'x-real-ip': ' 192.168.0.10 ',
      },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.2' },
    };

    expect(getClientIp(request as never)).toBe('192.168.0.10');
  });

  it('falls back to request.ip then socket.remoteAddress and default value', () => {
    expect(
      getClientIp({
        headers: {},
        ip: '172.16.0.1',
        socket: { remoteAddress: '127.0.0.2' },
      } as never)
    ).toBe('172.16.0.1');

    expect(
      getClientIp({
        headers: {},
        ip: '',
        socket: { remoteAddress: '127.0.0.2' },
      } as never)
    ).toBe('127.0.0.2');

    expect(
      getClientIp({
        headers: {},
        ip: '',
        socket: { remoteAddress: '' },
      } as never)
    ).toBe('127.0.0.1');
  });
});
