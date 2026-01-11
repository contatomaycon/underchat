import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { UpdateContactRequest } from '@core/schema/contact/editContact/request.schema';
import { CreateChatContactRequest } from '@core/schema/chat/createContact/request.schema';
import { UpdateChatContactRequest } from '@core/schema/chat/updateContact/request.schema';

const isEmptyDocumentTypeId = (
  value: string | { value: string } | null | undefined
): boolean => {
  if (value === '' || value === null) {
    return true;
  }

  if (typeof value === 'object' && 'value' in value) {
    return value.value === '' || value.value === null;
  }

  return false;
};

export const normalizeContactRequest = <
  T extends
    | CreateContactRequest
    | UpdateContactRequest
    | CreateChatContactRequest
    | UpdateChatContactRequest,
>(
  body: T
): T => {
  if (isEmptyDocumentTypeId(body.contact_document_type_id)) {
    return {
      ...body,
      contact_document_type_id: null,
      document: null,
    };
  }

  return body;
};
