import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { Static, Type } from '@sinclair/typebox';

export const createContactGroupAssignmentRequestSchema = Type.Object({
  contact_group_id: Type.Object({
    value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  contacts: Type.Optional(Type.Union([uploadFileRequestSchema, Type.Null()])),
});

export type CreateContactGroupAssignmentRequest = Static<
  typeof createContactGroupAssignmentRequestSchema
>;
