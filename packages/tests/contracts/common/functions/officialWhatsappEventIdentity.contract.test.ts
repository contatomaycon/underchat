import { buildOfficialWhatsappMessageStatusEventId } from '@core/common/functions/officialWhatsappEventIdentity';
import { buildMessageStatusEventId } from '@core/common/functions/messageStatusIdentity';

describe('official WhatsApp event identity', () => {
  it('distinguishes physical status transitions and worker scopes', () => {
    const input = {
      accountId: 'account-1',
      workerId: 'worker-1',
      providerMessageId: 'wamid.123',
      status: 'sent',
    };
    const sent = buildOfficialWhatsappMessageStatusEventId(input);

    expect(sent).toBe(
      buildOfficialWhatsappMessageStatusEventId({
        ...input,
        status: 'SENT',
      })
    );
    expect(sent).not.toBe(
      buildOfficialWhatsappMessageStatusEventId({
        ...input,
        status: 'delivered',
      })
    );
    expect(sent).not.toBe(
      buildOfficialWhatsappMessageStatusEventId({
        ...input,
        workerId: 'worker-2',
      })
    );
    expect(sent).toBe(
      buildMessageStatusEventId({
        account_id: input.accountId,
        worker_id: input.workerId,
        message_id: input.providerMessageId,
        patch: { is_sent: true },
      })
    );
  });
});
