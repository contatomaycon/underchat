import { IContent } from '@core/common/interfaces/IChatMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import { IOfficialWhatsappDisplayMetadata } from '@core/common/interfaces/IOfficialWhatsappContentMetadata';

function getTextByOfficialDisplay(
  display?: IOfficialWhatsappDisplayMetadata | null
): string | null {
  if (!display) {
    return null;
  }

  if (display.body) return display.body;
  if (display.title) return display.title;

  if (display.kind === 'order' && display.items?.length) {
    return `[Pedido] ${display.items.length} item(ns)`;
  }

  if (display.kind === 'product_list' && display.sections?.length) {
    return '[Lista de produtos]';
  }

  if (display.kind === 'carousel' && display.cards?.length) {
    return '[Carrossel]';
  }

  if (display.kind === 'unsupported') {
    return '[Mensagem não suportada]';
  }

  return null;
}

function getTextByMessageType(content: IContent): string | null {
  const displayText = getTextByOfficialDisplay(content.official?.display);
  if (displayText) {
    return displayText;
  }

  if (content.official?.interactive?.title) {
    return content.official.interactive.title;
  }

  if (content.official?.button?.text) {
    return content.official.button.text;
  }

  if (content.official?.order?.text) {
    return content.official.order.text;
  }

  if (content.buttons?.text) {
    return content.buttons.text;
  }

  if (content.buttons?.buttons?.length) {
    return '[Botões]';
  }

  switch (content.type) {
    case EMessageType.image:
      return content.image?.caption ?? '[Imagem]';

    case EMessageType.video:
      return content.video?.caption ?? '[Vídeo]';

    case EMessageType.video_note:
      return content.video?.caption ?? '[Recado de vídeo]';

    case EMessageType.location:
      return (
        content.location?.name ?? content.location?.address ?? '[Localização]'
      );

    case EMessageType.contact_card:
      return '[Contato]';

    case EMessageType.document:
      return content.document?.name ?? '[Documento]';

    case EMessageType.audio:
      return '[Áudio]';

    case EMessageType.sticker:
      return '[Figurinha]';

    default:
      return null;
  }
}

export function extractMessageTextFromContent(
  content: IContent
): string | null {
  if (content.message) {
    return content.message;
  }

  return getTextByMessageType(content);
}
