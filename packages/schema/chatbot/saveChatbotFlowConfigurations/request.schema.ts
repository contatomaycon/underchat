import { Static, Type } from '@sinclair/typebox';

const configurationsSchema = Type.Object({
  inactivity_alert: Type.Optional(
    Type.Object({
      status: Type.String(),
      quantity: Type.Optional(Type.Number()),
      time: Type.Optional(Type.Number()),
      action: Type.Optional(Type.String()),
      redirect_type: Type.Optional(Type.String()),
      selected_user: Type.Optional(Type.String()),
      selected_sector: Type.Optional(Type.String()),
      selected_sector_user: Type.Optional(Type.String()),
    })
  ),
  redirect_failed_attempts: Type.Optional(
    Type.Object({
      status: Type.String(),
      quantity: Type.Optional(Type.Number()),
      redirect_type: Type.Optional(Type.String()),
      selected_user: Type.Optional(Type.String()),
      selected_sector: Type.Optional(Type.String()),
      selected_sector_user: Type.Optional(Type.String()),
    })
  ),
});

export const saveChatbotFlowConfigurationsRequestSchema = Type.Object({
  chatbot_id: Type.String(),
  configurations: configurationsSchema,
});

export type SaveChatbotFlowConfigurationsRequest = Static<
  typeof saveChatbotFlowConfigurationsRequestSchema
>;
