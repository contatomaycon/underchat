import { extractChatbotTemplatePaths } from '@core/common/functions/chatbotApiVariables';
import type { ApiRequestConfig } from '@core/schema/chatbot/chatbotFlow.schema';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const addTemplatePaths = (paths: Set<string>, value: string): void => {
  for (const path of extractChatbotTemplatePaths(value)) paths.add(path);
};

/**
 * Lists only variables that are resolved while the single-call API probe is
 * serialized. Capture settings and the for-each collection are intentionally
 * excluded because the probe executes exactly once.
 */
export const getChatbotApiRequestTestVariablePaths = (
  config: ApiRequestConfig
): string[] => {
  const paths = new Set<string>();
  const add = (value: string | undefined): void => {
    if (value) addTemplatePaths(paths, value);
  };

  add(config.url);
  for (const field of config.queryParams) {
    if (!field.enabled) continue;
    add(field.key);
    add(field.value);
  }
  for (const field of config.headers) {
    if (!field.enabled) continue;
    add(field.key);
    add(field.value);
  }

  if (config.auth.type === 'bearer') {
    add(config.auth.bearer.token.value);
  } else if (config.auth.type === 'apiKey') {
    add(config.auth.apiKey.name);
    add(config.auth.apiKey.value.value);
  } else if (config.auth.type === 'basic') {
    add(config.auth.basic.username.value);
    add(config.auth.basic.password.value);
  }

  if (BODY_METHODS.has(config.method)) {
    if (config.body.type === 'json') {
      add(config.body.json);
    } else if (config.body.type === 'raw') {
      add(config.body.raw);
    } else if (config.body.type === 'formUrlEncoded') {
      for (const field of config.body.formFields) {
        if (!field.enabled) continue;
        add(field.key);
        add(field.value);
      }
    } else if (config.body.type === 'multipart') {
      for (const part of config.body.multipart) {
        if (!part.enabled) continue;
        add(part.name);
        add(part.value);
        if (part.type === 'file') {
          add(part.fileName);
          add(part.contentType);
        }
      }
    }
  }

  add(config.execution.idempotencyKey);

  return [...paths].sort((left, right) => left.localeCompare(right));
};
