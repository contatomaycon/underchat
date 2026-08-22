import { buildUserPhoneJidUpdateEventId } from '@core/common/functions/userPhoneJidUpdateIdentity';

describe('user phone JID update identity', () => {
  const base = {
    account_id: 'account-1',
    worker_id: 'worker-1',
    operation_id: 'operation-1',
    user_id: 'user-1',
    phone_jid: '5511999999999@s.whatsapp.net',
  };

  it('is stable across providers because provider is not part of the identity', () => {
    expect(buildUserPhoneJidUpdateEventId(base)).toBe(
      buildUserPhoneJidUpdateEventId({
        ...base,
        phone_jid: '5511999999999:21@c.us',
      })
    );
  });

  it('matches the cross-runtime TypeScript and Go vector', () => {
    expect(buildUserPhoneJidUpdateEventId(base)).toBe(
      'user_phone_jid_v1_022b41780e3419b670417891925d485df26609cf21b44ce0437ce2053c8d925d'
    );
  });

  it('accepts repeated values from distinct operations as distinct events', () => {
    expect(buildUserPhoneJidUpdateEventId(base)).not.toBe(
      buildUserPhoneJidUpdateEventId({
        ...base,
        operation_id: 'operation-2',
      })
    );
  });

  it('fails closed when an operational identity field is missing', () => {
    expect(
      buildUserPhoneJidUpdateEventId({
        ...base,
        operation_id: ' ',
      })
    ).toBeNull();
  });
});
