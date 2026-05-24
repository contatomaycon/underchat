import { IElasticsearchBoolClause } from '@core/common/interfaces/IElasticsearchQuery';
import { buildPhoneSearchTerms } from '@core/common/functions/buildPhoneSearchTerms';

export function buildPhoneSearchClause(
  rawPhoneInput: string
): IElasticsearchBoolClause | null {
  const phoneSearchTerms = buildPhoneSearchTerms(rawPhoneInput);
  const shouldClauses: IElasticsearchBoolClause[] = [];

  if (phoneSearchTerms.candidates.length > 0) {
    shouldClauses.push(
      {
        terms: {
          phone: phoneSearchTerms.candidates,
        },
      } as unknown as IElasticsearchBoolClause,
      {
        nested: {
          path: 'contact',
          query: {
            terms: {
              'contact.phone': phoneSearchTerms.candidates,
            },
          },
        },
      } as unknown as IElasticsearchBoolClause
    );
  }

  for (const wildcardToken of phoneSearchTerms.wildcardTokens) {
    shouldClauses.push(
      {
        wildcard: {
          phone: {
            value: `*${wildcardToken}*`,
            case_insensitive: true,
          },
        },
      } as unknown as IElasticsearchBoolClause,
      {
        wildcard: {
          'phone.keyword': {
            value: `*${wildcardToken}*`,
            case_insensitive: true,
          },
        },
      } as unknown as IElasticsearchBoolClause,
      {
        nested: {
          path: 'contact',
          query: {
            bool: {
              should: [
                {
                  wildcard: {
                    'contact.phone': {
                      value: `*${wildcardToken}*`,
                      case_insensitive: true,
                    },
                  },
                },
                {
                  wildcard: {
                    'contact.phone.keyword': {
                      value: `*${wildcardToken}*`,
                      case_insensitive: true,
                    },
                  },
                },
              ],
              minimum_should_match: 1,
            },
          },
        },
      } as unknown as IElasticsearchBoolClause
    );
  }

  if (shouldClauses.length === 0) {
    return null;
  }

  return {
    bool: {
      should: shouldClauses,
      minimum_should_match: 1,
    },
  } as unknown as IElasticsearchBoolClause;
}
