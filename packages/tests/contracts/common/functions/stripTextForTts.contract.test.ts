import { stripTextForTts } from '@core/common/functions/stripTextForTts';

describe('stripTextForTts', () => {
  it('returns empty string for invalid runtime values', () => {
    expect(stripTextForTts('')).toBe('');
    expect(stripTextForTts(null as never)).toBe('');
    expect(stripTextForTts(123 as never)).toBe('');
  });

  it('removes markdown syntax, bracket blocks and excessive empty lines', () => {
    const input = `
## Título
Texto com **negrito** e _itálico_ e \`codigo\`.
Veja [link](https://example.com).
Bloco 【meta】 removido.


Fim
`;

    expect(stripTextForTts(input)).toBe(
      'Título\nTexto com negrito e itálico e codigo.\nVeja link.\nBloco removido.\n\nFim'
    );
  });
});
