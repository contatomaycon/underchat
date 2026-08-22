import 'reflect-metadata';
import { shouldBypassJwtAttendanceGuard } from '@core/middlewares/jwt.middleware';

describe('JWT attendance guard bypass', () => {
  it('keeps the status route authenticated only by JWT/session checks', () => {
    expect(
      shouldBypassJwtAttendanceGuard('/user/me/attendance-hours/status')
    ).toBe(true);
  });

  it('continues applying attendance restrictions to other routes', () => {
    expect(
      shouldBypassJwtAttendanceGuard('/integration/outbound-webhooks')
    ).toBe(false);
  });
});
