import {
  calculateUserAttendanceGuardStatus,
  findConflictingUserAttendanceHoursRules,
  isUserAttendanceHoursRuleWindowValid,
  isUserAttendanceHoursTimeValid,
} from './userAttendanceHours';
import { IUserAttendanceHoursRule } from '@core/common/interfaces/IUserAttendanceHours';

describe('userAttendanceHours', () => {
  it('validates time format and range', () => {
    expect(isUserAttendanceHoursTimeValid('09:00')).toBe(true);
    expect(isUserAttendanceHoursTimeValid('24:00')).toBe(false);
    expect(
      isUserAttendanceHoursRuleWindowValid({
        start_time: '09:00',
        end_time: '18:00',
      })
    ).toBe(true);
    expect(
      isUserAttendanceHoursRuleWindowValid({
        start_time: '18:00',
        end_time: '09:00',
      })
    ).toBe(false);
  });

  it('detects conflicts and allows touching ranges', () => {
    const touchingRules: IUserAttendanceHoursRule[] = [
      { weekday: 'monday', start_time: '09:00', end_time: '12:00' },
      { weekday: 'monday', start_time: '12:00', end_time: '18:00' },
    ];

    const overlappingRules: IUserAttendanceHoursRule[] = [
      { weekday: 'monday', start_time: '09:00', end_time: '12:00' },
      { weekday: 'monday', start_time: '11:00', end_time: '13:00' },
    ];

    expect(findConflictingUserAttendanceHoursRules(touchingRules)).toBeNull();
    expect(findConflictingUserAttendanceHoursRules(overlappingRules)).not.toBeNull();
  });

  it('returns unrestricted when today has no rule', () => {
    const status = calculateUserAttendanceGuardStatus(
      [],
      new Date('2026-03-02T10:00:00-03:00')
    );

    expect(status.is_restricted_today).toBe(false);
    expect(status.is_blocked_now).toBe(false);
  });

  it('calculates blocked and transitions before first window', () => {
    const status = calculateUserAttendanceGuardStatus(
      [{ weekday: 'monday', start_time: '10:00', end_time: '12:00' }],
      new Date('2026-03-02T09:30:00-03:00')
    );

    expect(status.is_restricted_today).toBe(true);
    expect(status.is_blocked_now).toBe(true);
    expect(status.next_unlock_at).toBeTruthy();
  });

  it('calculates blocked between windows and unlocks at next window', () => {
    const status = calculateUserAttendanceGuardStatus(
      [
        { weekday: 'monday', start_time: '10:00', end_time: '12:00' },
        { weekday: 'monday', start_time: '13:00', end_time: '18:00' },
      ],
      new Date('2026-03-02T12:30:00-03:00')
    );

    expect(status.is_blocked_now).toBe(true);
    expect(status.today_windows_label).toBe('10:00-12:00, 13:00-18:00');
    expect(status.next_unlock_at).toBeTruthy();
  });

  it('calculates next transition at midnight when day ends blocked and next day has no rule', () => {
    const status = calculateUserAttendanceGuardStatus(
      [{ weekday: 'monday', start_time: '10:00', end_time: '18:00' }],
      new Date('2026-03-02T19:00:00-03:00')
    );

    expect(status.is_blocked_now).toBe(true);
    expect(status.next_transition_at).toBe('2026-03-03T03:00:00.000Z');
    expect(status.next_unlock_at).toBe('2026-03-03T03:00:00.000Z');
  });

  it('locks at midnight when today has no rule and next day starts later', () => {
    const status = calculateUserAttendanceGuardStatus(
      [{ weekday: 'tuesday', start_time: '09:00', end_time: '18:00' }],
      new Date('2026-03-02T15:00:00-03:00')
    );

    expect(status.is_blocked_now).toBe(false);
    expect(status.next_transition_at).toBe('2026-03-03T03:00:00.000Z');
    expect(status.next_lock_at).toBe('2026-03-03T03:00:00.000Z');
  });
});
