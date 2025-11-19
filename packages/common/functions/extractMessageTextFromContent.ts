import { IContent } from '@core/common/interfaces/IChatMessage';
import { EMessageType } from '@core/common/enums/EMessageType';

function getTextByMessageType(content: IContent): string | null {
  switch (content.type) {
    case EMessageType.image:
      return content.image?.caption ?? '[Imagem]';

    case EMessageType.video:
      return content.video?.caption ?? '[Vídeo]';

    case EMessageType.location:
      return (
        content.location?.name ?? content.location?.address ?? '[Localização]'
      );

    case EMessageType.contacts:
      return content.contact?.name ?? '[Contato]';

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
