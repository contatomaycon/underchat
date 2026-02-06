import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { UpdateContactRequest } from '@core/schema/contact/editContact/request.schema';
import { CreateChatContactRequest } from '@core/schema/chat/createContact/request.schema';
import { UpdateChatContactRequest } from '@core/schema/chat/updateContact/request.schema';

const processMultipartArrayField = (
  body: Record<string, unknown>,
  fieldName: string
): void => {
  const array: string[] = [];

  Object.keys(body).forEach((key) => {
    const match = key.match(new RegExp(`^${fieldName}\\[(\\d+)\\]$`));
    if (!match) {
      return;
    }

    const index = Number.parseInt(match[1], 10);
    const field = body[key];
    const value =
      typeof field === 'object' && field !== null && 'value' in field
        ? (field as { value: unknown }).value
        : field;

    if (typeof value === 'string' && value.trim() !== '') {
      array[index] = value;
    }
  });

  if (array.length > 0) {
    (body as Record<string, unknown>)[fieldName] = array.filter(Boolean);
  }
};

const processMultipartArrayFields = (body: Record<string, unknown>): void => {
  processMultipartArrayField(body, 'channel_ids');
  processMultipartArrayField(body, 'label_template_ids');
};

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
  processMultipartArrayFields(body as unknown as Record<string, unknown>);

  if (isEmptyDocumentTypeId(body.contact_document_type_id)) {
    return {
      ...body,
      contact_document_type_id: null,
      document: null,
    };
  }

  return body;
};
