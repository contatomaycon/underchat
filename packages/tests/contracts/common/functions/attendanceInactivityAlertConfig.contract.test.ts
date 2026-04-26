import {
  ATTENDANCE_INACTIVITY_ALERT_DEFAULT_ACTION,
  ATTENDANCE_INACTIVITY_ALERT_DEFAULT_MESSAGE_ENABLED,
  ATTENDANCE_INACTIVITY_ALERT_DEFAULT_QUANTITY,
  ATTENDANCE_INACTIVITY_ALERT_DEFAULT_TIME,
  buildDefaultAttendanceInactivityAlertConfig,
  parseAttendanceInactivityAlertConfig,
} from '@core/common/functions/attendanceInactivityAlertConfig';

describe('attendanceInactivityAlertConfig', () => {
  it('builds default config', () => {
    expect(buildDefaultAttendanceInactivityAlertConfig()).toEqual({
      quantity: ATTENDANCE_INACTIVITY_ALERT_DEFAULT_QUANTITY,
      time: ATTENDANCE_INACTIVITY_ALERT_DEFAULT_TIME,
      action: ATTENDANCE_INACTIVITY_ALERT_DEFAULT_ACTION,
      inactivity_message_enabled:
        ATTENDANCE_INACTIVITY_ALERT_DEFAULT_MESSAGE_ENABLED,
      inactivity_message: null,
    });
  });

  it('parses valid config payload', () => {
    const raw = JSON.stringify({
      quantity: 3,
      time: 25,
      action: 'finish',
      inactivity_message_enabled: false,
      inactivity_message: '  Mensagem de teste  ',
    });

    expect(parseAttendanceInactivityAlertConfig(raw)).toEqual({
      quantity: 3,
      time: 25,
      action: 'finish',
      inactivity_message_enabled: false,
      inactivity_message: 'Mensagem de teste',
    });
  });

  it('falls back to defaults for invalid payloads', () => {
    expect(parseAttendanceInactivityAlertConfig(undefined)).toEqual(
      buildDefaultAttendanceInactivityAlertConfig()
    );
    expect(parseAttendanceInactivityAlertConfig(null)).toEqual(
      buildDefaultAttendanceInactivityAlertConfig()
    );
    expect(parseAttendanceInactivityAlertConfig('invalid-json')).toEqual(
      buildDefaultAttendanceInactivityAlertConfig()
    );
  });

  it('normalizes partial and invalid fields', () => {
    const raw = JSON.stringify({
      quantity: 0,
      time: -10,
      action: 'redirect',
      inactivity_message_enabled: 'yes',
      inactivity_message: '   ',
    });

    expect(parseAttendanceInactivityAlertConfig(raw)).toEqual({
      quantity: ATTENDANCE_INACTIVITY_ALERT_DEFAULT_QUANTITY,
      time: ATTENDANCE_INACTIVITY_ALERT_DEFAULT_TIME,
      action: ATTENDANCE_INACTIVITY_ALERT_DEFAULT_ACTION,
      inactivity_message_enabled: true,
      inactivity_message: null,
    });
  });
});
