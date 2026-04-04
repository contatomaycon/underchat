import { WAMessage, proto } from '@whiskeysockets/baileys';
import { normalizeExternalAdReplyMediaType } from './normalizeExternalAdReplyMediaType';

export interface IMessageContextInfo {
  mentioned_jid?: string[] | null;
  group_mentions?: string[] | null;
  status_attributions?: string[] | null;
  conversion_source?: string | null;
  conversion_delay_seconds?: number | null;
  external_ad_reply?: IExternalAdReply | null;
  entry_point_conversion_source?: string | null;
  entry_point_conversion_app?: string | null;
  entry_point_conversion_delay_seconds?: number | null;
  trust_banner_action?: number | null;
  ctwa_signals?: string | null;
  is_forwarded?: boolean | null;
  forwarding_score?: number | null;
}

export interface IExternalAdReply {
  title?: string | null;
  media_type?: number | null;
  thumbnail_url?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  source_url?: string | null;
  contains_auto_reply?: boolean | null;
  render_larger_thumbnail?: boolean | null;
  show_ad_attribution?: boolean | null;
  ctwa_clid?: string | null;
  click_to_whatsapp_call?: boolean | null;
  ad_context_preview_dismissed?: boolean | null;
  source_app?: string | null;
  automated_greeting_message_shown?: boolean | null;
  greeting_message_body?: string | null;
  disable_nudge?: boolean | null;
  original_image_url?: string | null;
  wtwa_ad_format?: boolean | null;
}

function getContextInfoFromMessage(
  message: proto.IMessage
): proto.ContextInfo | null {
  const contextSources = [
    message.extendedTextMessage?.contextInfo,
    message.imageMessage?.contextInfo,
    message.videoMessage?.contextInfo,
    message.ptvMessage?.contextInfo,
    message.documentMessage?.contextInfo,
    message.audioMessage?.contextInfo,
    message.stickerMessage?.contextInfo,
    message.locationMessage?.contextInfo,
    message.contactMessage?.contextInfo,
    message.contactsArrayMessage?.contextInfo,
    message.buttonsMessage?.contextInfo,
    message.templateButtonReplyMessage?.contextInfo,
    (message as any).interactiveResponseMessage?.contextInfo,
  ];

  return (
    contextSources.find(
      (context) => context !== null && context !== undefined
    ) ?? null
  );
}

function buildExternalAdReply(
  externalAdReply: proto.ContextInfo.IExternalAdReplyInfo | null | undefined
): IExternalAdReply | null {
  if (!externalAdReply) {
    return null;
  }

  return {
    title: externalAdReply.title ?? null,
    media_type: normalizeExternalAdReplyMediaType(externalAdReply.mediaType),
    thumbnail_url: externalAdReply.thumbnailUrl ?? null,
    source_type: externalAdReply.sourceType ?? null,
    source_id: externalAdReply.sourceId ?? null,
    source_url: externalAdReply.sourceUrl ?? null,
    contains_auto_reply: externalAdReply.containsAutoReply ?? null,
    render_larger_thumbnail: externalAdReply.renderLargerThumbnail ?? null,
    show_ad_attribution: externalAdReply.showAdAttribution ?? null,
    ctwa_clid: externalAdReply.ctwaClid ?? null,
    click_to_whatsapp_call: externalAdReply.clickToWhatsappCall ?? null,
    ad_context_preview_dismissed:
      externalAdReply.adContextPreviewDismissed ?? null,
    source_app: externalAdReply.sourceApp ?? null,
    automated_greeting_message_shown:
      externalAdReply.automatedGreetingMessageShown ?? null,
    greeting_message_body: externalAdReply.greetingMessageBody ?? null,
    disable_nudge: externalAdReply.disableNudge ?? null,
    original_image_url: externalAdReply.originalImageUrl ?? null,
    wtwa_ad_format: externalAdReply.wtwaAdFormat ?? null,
  };
}

export function buildContextInfoFromMessage(
  m: WAMessage
): IMessageContextInfo | null {
  const message = m?.message;
  if (!message) {
    return null;
  }

  const contextInfo = getContextInfoFromMessage(message);
  if (!contextInfo) {
    return null;
  }

  const mentionedJid = (contextInfo.mentionedJid ?? []) as string[];
  const groupMentions = contextInfo.groupMentions ?? [];
  const statusAttributions = contextInfo.statusAttributions ?? [];

  const groupMentionsStrings: string[] =
    groupMentions.length > 0
      ? (groupMentions
          .map((gm) =>
            typeof gm === 'string' ? gm : String((gm as any)?.groupJid ?? '')
          )
          .filter(Boolean) as string[])
      : [];
  const statusAttributionsStrings: string[] =
    statusAttributions.length > 0
      ? (statusAttributions
          .map((sa) =>
            typeof sa === 'string' ? sa : String((sa as any)?.groupJid ?? '')
          )
          .filter(Boolean) as string[])
      : [];

  const isForwarded = contextInfo.isForwarded ?? false;
  const forwardingScore = contextInfo.forwardingScore ?? null;

  if (
    mentionedJid.length === 0 &&
    groupMentionsStrings.length === 0 &&
    statusAttributionsStrings.length === 0 &&
    !contextInfo.conversionSource &&
    !contextInfo.externalAdReply &&
    !contextInfo.entryPointConversionSource &&
    !contextInfo.ctwaSignals &&
    !isForwarded
  ) {
    return null;
  }

  return {
    mentioned_jid: mentionedJid.length > 0 ? mentionedJid : null,
    group_mentions:
      groupMentionsStrings.length > 0 ? groupMentionsStrings : null,
    status_attributions:
      statusAttributionsStrings.length > 0 ? statusAttributionsStrings : null,
    conversion_source: contextInfo.conversionSource ?? null,
    conversion_delay_seconds: contextInfo.conversionDelaySeconds ?? null,
    external_ad_reply: buildExternalAdReply(contextInfo.externalAdReply),
    entry_point_conversion_source:
      contextInfo.entryPointConversionSource ?? null,
    entry_point_conversion_app: contextInfo.entryPointConversionApp ?? null,
    entry_point_conversion_delay_seconds:
      contextInfo.entryPointConversionDelaySeconds ?? null,
    trust_banner_action: contextInfo.trustBannerAction ?? null,
    ctwa_signals: contextInfo.ctwaSignals ?? null,
    is_forwarded: isForwarded || null,
    forwarding_score: forwardingScore,
  };
}
