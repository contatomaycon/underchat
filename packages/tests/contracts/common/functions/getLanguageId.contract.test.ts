import { ELanguage } from '@core/common/enums/ELanguage';
import { getLanguageId } from '@core/common/functions/getLanguageId';

describe('getLanguageId', () => {
  it('maps known languages to fixed ids', () => {
    expect(getLanguageId(ELanguage.pt)).toBe(1);
    expect(getLanguageId(ELanguage.en)).toBe(2);
    expect(getLanguageId(ELanguage.es)).toBe(3);
  });

  it('defaults to pt id for unknown runtime values', () => {
    expect(getLanguageId('de' as never)).toBe(1);
  });
});
