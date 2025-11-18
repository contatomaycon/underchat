import { IContent } from '@core/common/interfaces/IChatMessage';
import { EMessageType } from '@core/common/enums/EMessageType';

export function extractMessageTextFromContent(
  content: IContent
): string | null {
  if (content.message) {
    return content.message;
  }

  if (content.type === EMessageType.image && content.image?.caption) {
    return content.image.caption;
  }

  if (content.type === EMessageType.video && content.video?.caption) {
    return content.video.caption;
  }

  if (content.type === EMessageType.location && content.location?.name) {
    return content.location.name;
  }

  if (content.type === EMessageType.location && content.location?.address) {
    return content.location.address;
  }

  if (content.type === EMessageType.contacts && content.contact?.name) {
    return content.contact.name;
  }

  if (content.type === EMessageType.image) {
    return '[Imagem]';
  }

  if (content.type === EMessageType.video) {
    return '[Vídeo]';
  }

  if (content.type === EMessageType.document) {
    return content.document?.name ?? '[Documento]';
  }

  if (content.type === EMessageType.audio) {
    return '[Áudio]';
  }

  if (content.type === EMessageType.sticker) {
    return '[Figurinha]';
  }

  if (content.type === EMessageType.location) {
    return '[Localização]';
  }

  if (content.type === EMessageType.contacts) {
    return '[Contato]';
  }

  return null;
}
