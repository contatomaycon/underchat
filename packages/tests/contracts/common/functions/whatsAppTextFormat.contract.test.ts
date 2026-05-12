import {
  formatWhatsAppPreviewToHtml,
  formatWhatsAppTextToHtml,
} from '@core/common/functions/whatsAppTextFormat';

describe('whatsAppTextFormat', () => {
  it('renders WhatsApp quote and monospace formatting', () => {
    expect(
      formatWhatsAppTextToHtml(
        'Menu Principal\n\n> ```Chave de segurança: 5CQKL01NTI```'
      )
    ).toBe(
      'Menu Principal<br /><br /><span class="whatsapp-quote"><code>Chave de segurança: 5CQKL01NTI</code></span>'
    );
  });

  it('keeps text escaped inside formatted quote blocks', () => {
    expect(formatWhatsAppTextToHtml('> ```<script>alert(1)</script>```')).toBe(
      '<span class="whatsapp-quote"><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></span>'
    );
  });

  it('removes quote markers from one-line previews', () => {
    expect(
      formatWhatsAppPreviewToHtml(
        'Menu Principal\n\n> ```Chave de segurança: 5CQKL01NTI```',
        80
      )
    ).toBe('Menu Principal  <code>Chave de segurança: 5CQKL01NTI</code>');
  });
});
