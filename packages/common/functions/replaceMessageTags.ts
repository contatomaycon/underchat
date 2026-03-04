import { TFunction } from 'i18next';
import { IChat } from '../interfaces/IChat';
import { formatPhoneBR } from './formatPhoneBR';
import { generateProtocol } from './generateProtocol';
import { extractPhoneAndDdi } from './extractPhoneAndDdi';

interface ReplaceMessageTagsOptions {
  message: string | null;
  chat: IChat;
  protocol?: string | null;
  t?: TFunction<'translation', undefined>;
  contactName?: string | null;
  sectorName?: string | null;
  userName?: string | null;
}

function getGreeting(t?: TFunction<'translation', undefined>): string {
  const hour = new Date().getHours();

  if (!t) {
    if (hour >= 5 && hour < 12) {
      return 'Bom dia';
    }
    if (hour >= 12 && hour < 18) {
      return 'Boa tarde';
    }
    return 'Boa noite';
  }

  if (hour >= 5 && hour < 12) {
    return t('good_morning');
  }
  if (hour >= 12 && hour < 18) {
    return t('good_afternoon');
  }
  return t('good_evening');
}

function getContactNameFromChat(chat: IChat): string {
  if (chat.contact?.name) {
    return chat.contact.name;
  }

  return chat.name || '';
}

function getPhoneFormatted(chat: IChat): string {
  if (!chat.phone) {
    return '';
  }

  try {
    const phoneAndDdi = extractPhoneAndDdi(chat.phone);
    if (!phoneAndDdi) {
      return formatPhoneBR(chat.phone);
    }

    const fullPhone = phoneAndDdi.phone_ddi
      ? `${phoneAndDdi.phone_ddi}${phoneAndDdi.phone}`
      : phoneAndDdi.phone;

    return formatPhoneBR(fullPhone);
  } catch {
    return formatPhoneBR(chat.phone);
  }
}

function getCurrentProtocol(
  chat: IChat,
  providedProtocol?: string | null
): string {
  if (providedProtocol) {
    return providedProtocol;
  }

  if (chat.protocol_start && chat.protocol_start.length > 0) {
    return chat.protocol_start[chat.protocol_start.length - 1];
  }

  if (chat.protocol_transfer && chat.protocol_transfer.length > 0) {
    return chat.protocol_transfer[chat.protocol_transfer.length - 1];
  }

  if (chat.protocol_ura && chat.protocol_ura.length > 0) {
    return chat.protocol_ura[chat.protocol_ura.length - 1];
  }

  return generateProtocol();
}

export function replaceMessageTags(options: ReplaceMessageTagsOptions): string {
  const { message, chat, protocol, t, contactName, sectorName, userName } =
    options;

  if (!message) {
    return '';
  }

  let replaced = message;

  const greeting = getGreeting(t);
  replaced = replaced.replaceAll(/\{\{\s*greeting\s*\}\}/gi, greeting);

  const name = contactName || getContactNameFromChat(chat);
  replaced = replaced.replaceAll(/\{\{\s*name\s*\}\}/gi, name);

  const currentProtocol = getCurrentProtocol(chat, protocol);
  replaced = replaced.replaceAll(/\{\{\s*protocol\s*\}\}/gi, currentProtocol);
  replaced = replaced.replaceAll(/\{\{\s*protocolo\s*\}\}/gi, currentProtocol);

  const now = new Date();
  const date = now.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  replaced = replaced.replaceAll(/\{\{\s*date\s*\}\}/gi, date);

  const time = now.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  replaced = replaced.replaceAll(/\{\{\s*time\s*\}\}/gi, time);

  const accountName = chat.account?.name || '';
  replaced = replaced.replaceAll(/\{\{\s*account_name\s*\}\}/gi, accountName);
  replaced = replaced.replaceAll(/\{\{\s*accountname\s*\}\}/gi, accountName);

  const phone = getPhoneFormatted(chat);
  replaced = replaced.replaceAll(/\{\{\s*phone\s*\}\}/gi, phone);

  const channelName = chat.worker?.name || '';
  replaced = replaced.replaceAll(/\{\{\s*channel_name\s*\}\}/gi, channelName);
  replaced = replaced.replaceAll(/\{\{\s*channelname\s*\}\}/gi, channelName);

  const sector = sectorName || chat.sector?.name || '';
  replaced = replaced.replaceAll(/\{\{\s*sector\s*\}\}/gi, sector);

  const user = userName || chat.user?.name || '';
  replaced = replaced.replaceAll(/\{\{\s*user\s*\}\}/gi, user);

  return replaced;
}
