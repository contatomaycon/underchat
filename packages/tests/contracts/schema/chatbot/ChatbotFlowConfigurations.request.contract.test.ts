import { Value } from '@sinclair/typebox/value';
import { saveChatbotFlowConfigurationsRequestSchema } from '@core/schema/chatbot/saveChatbotFlowConfigurations/request.schema';

describe('save chatbot flow configurations inactivity timing contract', () => {
  const buildRequest = (inactivityAlert: Record<string, unknown>) => ({
    chatbot_id: 'chatbot-1',
    configurations: { inactivity_alert: inactivityAlert },
  });

  it('accepts an active alert with positive quantity and time', () => {
    expect(
      Value.Check(
        saveChatbotFlowConfigurationsRequestSchema,
        buildRequest({ status: 'active', quantity: 2, time: 5 })
      )
    ).toBe(true);
  });

  it.each([
    { status: 'active', time: 5 },
    { status: 'active', quantity: 2 },
    { status: 'active', quantity: 0, time: 5 },
    { status: 'active', quantity: 2, time: 0 },
  ])('rejects invalid active alert timing: %p', (inactivityAlert) => {
    expect(
      Value.Check(
        saveChatbotFlowConfigurationsRequestSchema,
        buildRequest(inactivityAlert)
      )
    ).toBe(false);
  });

  it('keeps timing optional while the alert is inactive', () => {
    expect(
      Value.Check(
        saveChatbotFlowConfigurationsRequestSchema,
        buildRequest({ status: 'inactive' })
      )
    ).toBe(true);
  });
});
