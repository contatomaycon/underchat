import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';

interface OfficialWhatsappInteractiveValidationIssueBase {
  field: string;
}

export interface OfficialWhatsappInteractiveMaximumIssue extends OfficialWhatsappInteractiveValidationIssueBase {
  code: 'max_length' | 'max_items';
  limit: number;
  actual: number;
}

export interface OfficialWhatsappInteractiveRuleIssue extends OfficialWhatsappInteractiveValidationIssueBase {
  code:
    | 'emoji_not_allowed'
    | 'unsupported_field'
    | 'required_field'
    | 'invalid_url';
}

export type OfficialWhatsappInteractiveValidationIssue =
  | OfficialWhatsappInteractiveMaximumIssue
  | OfficialWhatsappInteractiveRuleIssue;

const formatIssue = (
  issue: OfficialWhatsappInteractiveValidationIssue
): string => {
  if (issue.code === 'emoji_not_allowed') {
    return `${issue.field} does not support emoji`;
  }
  if (issue.code === 'unsupported_field') {
    return `${issue.field} is not supported`;
  }
  if (issue.code === 'required_field') {
    return `${issue.field} is required`;
  }
  if (issue.code === 'invalid_url') {
    return `${issue.field} must be a valid HTTP or HTTPS URL`;
  }

  if ('limit' in issue) {
    const unit = issue.code === 'max_length' ? 'characters' : 'items';
    return `${issue.field} supports at most ${issue.limit} ${unit} (received ${issue.actual})`;
  }

  return `${issue.field} violates the interactive message policy`;
};

export class OfficialWhatsappInteractiveValidationError extends Error {
  readonly code = 'official_whatsapp_interactive_limit_exceeded';
  readonly httpStatusCode = EHTTPStatusCode.bad_request;

  constructor(
    readonly issues: readonly OfficialWhatsappInteractiveValidationIssue[],
    message?: string
  ) {
    super(
      message ??
        `${'official_whatsapp_interactive_limit_exceeded'}: ${issues
          .map(formatIssue)
          .join('; ')}`
    );
    this.name = 'OfficialWhatsappInteractiveValidationError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OfficialWhatsappInteractiveValidationError);
    }
  }
}

export const isOfficialWhatsappInteractiveValidationError = (
  error: unknown
): error is OfficialWhatsappInteractiveValidationError =>
  error instanceof OfficialWhatsappInteractiveValidationError ||
  (error instanceof Error &&
    error.name === 'OfficialWhatsappInteractiveValidationError');
