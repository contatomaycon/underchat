import { bulkActionChatSchema } from '@core/schema/chat/bulkAction';
import { createChatContactSchema } from '@core/schema/chat/createContact';
import { deleteChatContactPhotoSchema } from '@core/schema/chat/deleteContactPhoto';
import { removeChatContactLabelTemplateSchema } from '@core/schema/chat/removeContactLabelTemplate';
import { startChatWithContactSchema } from '@core/schema/chat/startChatWithContact';
import { sendOfficialTemplateSchema } from '@core/schema/chat/sendOfficialTemplate';
import { officialOpeningContextSchema } from '@core/schema/chat/officialOpeningContext';
import { updateChatLabelSchema } from '@core/schema/chat/updateChatLabel';
import { updateChatContactSchema } from '@core/schema/chat/updateContact';
import { updateForwardToOutputChatbotSchema } from '@core/schema/chat/updateForwardToOutputChatbot';
import { validateChatContactSchema } from '@core/schema/chat/validateContact';
import { chatMutationErrorResponseSchema } from '@core/schema/chat/mutationErrorResponse.schema';

describe('chat mutation HTTP response schemas', () => {
  it('requires status=false in every shared domain-error envelope', () => {
    const schema = chatMutationErrorResponseSchema('Domain Error');

    expect(schema.required).toEqual(
      expect.arrayContaining(['status', 'message', 'data'])
    );
    expect(schema.properties.status.const).toBe(false);
  });

  it.each([
    ['bulk action', bulkActionChatSchema],
    ['create contact', createChatContactSchema],
    ['delete contact photo', deleteChatContactPhotoSchema],
    ['remove contact label', removeChatContactLabelTemplateSchema],
    ['start chat', startChatWithContactSchema],
    ['update label', updateChatLabelSchema],
    ['update contact', updateChatContactSchema],
    ['update output chatbot', updateForwardToOutputChatbotSchema],
    ['validate contact', validateChatContactSchema],
  ] as const)('documents a 400 response for %s', (_, schema) => {
    expect(schema.response[400]).toBeDefined();
  });

  it.each([
    ['create contact', createChatContactSchema],
    ['delete contact photo', deleteChatContactPhotoSchema],
    ['remove contact label', removeChatContactLabelTemplateSchema],
    ['start chat', startChatWithContactSchema],
    ['update label', updateChatLabelSchema],
    ['update contact', updateChatContactSchema],
    ['update output chatbot', updateForwardToOutputChatbotSchema],
    ['validate contact', validateChatContactSchema],
    ['send official template', sendOfficialTemplateSchema],
    ['official opening context', officialOpeningContextSchema],
  ] as const)('documents a 404 response for %s', (_, schema) => {
    expect(schema.response[404]).toBeDefined();
  });

  it('documents the refreshable official-window conflict envelope', () => {
    const conflictSchema = startChatWithContactSchema.response[409];

    expect(conflictSchema).toBeDefined();
    expect(conflictSchema.properties.status.const).toBe(false);
    expect(conflictSchema.properties.data.properties.reason.const).toBe(
      'official_window_requires_template_refresh'
    );
  });

  it('documents temporary validation-service unavailability', () => {
    expect(validateChatContactSchema.response[503]).toBeDefined();
  });
});
