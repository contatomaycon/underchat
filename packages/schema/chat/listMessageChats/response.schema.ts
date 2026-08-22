import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { Static, Type } from '@sinclair/typebox';
import { viewLinkPreviewResponseSchema } from '../viewLinkPreview/response.schema';
import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { officialWindowSchema } from '@core/schema/chat/officialWindow.schema';

export const userSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const summarySchema = Type.Object({
  is_sent: Type.Boolean(),
  is_delivered: Type.Boolean(),
  is_seen: Type.Boolean(),
  is_sent_to_internal: Type.Boolean(),
});

export const messageKeySchema = Type.Object({
  remote_jid: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  remote_jid_alt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  from_me: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  participant: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  participant_alt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  addressing_mode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  is_view_once: Type.Optional(Type.Boolean()),
});

export const imageSchema = Type.Object({
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  caption: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  extension: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  size: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  thumbnail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const videoSchema = Type.Object({
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  caption: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  extension: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  size: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  duration: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  thumbnail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const audioSchema = Type.Object({
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  extension: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  size: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  duration: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  ptt: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  view_once: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  waveform: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  transcription: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const documentSchema = Type.Object({
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  extension: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  size: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
});

export const stickerSchema = Type.Object({
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mimetype: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  extension: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  size: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  is_animated: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
});

export const locationSchema = Type.Object({
  latitude: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  longitude: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  address: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const contactSchema = Type.Object({
  contact_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.String(),
  last_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  email_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const buttonMessageOptionSchema = Type.Object(
  {
    id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    display_text: Type.String(),
    type: Type.Optional(
      Type.Union([Type.String(), Type.Number(), Type.Null()])
    ),
  },
  { additionalProperties: true }
);

export const buttonMessageSchema = Type.Object(
  {
    text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    footer: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    header: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    header_type: Type.Optional(
      Type.Union([Type.String(), Type.Number(), Type.Null()])
    ),
    buttons: Type.Array(buttonMessageOptionSchema),
  },
  { additionalProperties: true }
);

export const listMessageRowSchema = Type.Object(
  {
    id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    title: Type.String(),
    description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: true }
);

export const listMessageSectionSchema = Type.Object(
  {
    id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    rows: Type.Array(listMessageRowSchema),
  },
  { additionalProperties: true }
);

export const listMessageSchema = Type.Object(
  {
    text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    button_text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    list_type: Type.Optional(
      Type.Union([Type.String(), Type.Number(), Type.Null()])
    ),
    sections: Type.Array(listMessageSectionSchema),
  },
  { additionalProperties: true }
);

export const quotedMessageSchema = Type.Object({
  key: messageKeySchema,
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  type: Type.Optional(Type.String({ enum: Object.values(EMessageType) })),
  image: Type.Optional(Type.Union([imageSchema, Type.Null()])),
  video: Type.Optional(Type.Union([videoSchema, Type.Null()])),
  audio: Type.Optional(Type.Union([audioSchema, Type.Null()])),
  document: Type.Optional(Type.Union([documentSchema, Type.Null()])),
  sticker: Type.Optional(Type.Union([stickerSchema, Type.Null()])),
  location: Type.Optional(Type.Union([locationSchema, Type.Null()])),
  contact: Type.Optional(Type.Union([contactSchema, Type.Null()])),
  buttons: Type.Optional(Type.Union([buttonMessageSchema, Type.Null()])),
  list: Type.Optional(Type.Union([listMessageSchema, Type.Null()])),
});

export const reactionSchema = Type.Object({
  emoji: Type.String(),
  user_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  user_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const messageVersionSchema = Type.Object({
  type: Type.String({ enum: Object.values(EMessageType) }),
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  date: Type.String(),
});

export const externalAdReplySchema = Type.Object(
  {
    title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    media_type: Type.Optional(
      Type.Union([Type.Number(), Type.String(), Type.Null()])
    ),
    thumbnail_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    source_type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    source_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    source_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    contains_auto_reply: Type.Optional(
      Type.Union([Type.Boolean(), Type.Null()])
    ),
    render_larger_thumbnail: Type.Optional(
      Type.Union([Type.Boolean(), Type.Null()])
    ),
    show_ad_attribution: Type.Optional(
      Type.Union([Type.Boolean(), Type.Null()])
    ),
    ctwa_clid: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    click_to_whatsapp_call: Type.Optional(
      Type.Union([Type.Boolean(), Type.Null()])
    ),
    ad_context_preview_dismissed: Type.Optional(
      Type.Union([Type.Boolean(), Type.Null()])
    ),
    source_app: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    automated_greeting_message_shown: Type.Optional(
      Type.Union([Type.Boolean(), Type.Null()])
    ),
    greeting_message_body: Type.Optional(
      Type.Union([Type.String(), Type.Null()])
    ),
    disable_nudge: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    original_image_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    wtwa_ad_format: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  },
  { additionalProperties: true }
);

export const contextInfoSchema = Type.Object(
  {
    mentioned_jid: Type.Optional(
      Type.Union([Type.Array(Type.String()), Type.Null()])
    ),
    group_mentions: Type.Optional(
      Type.Union([Type.Array(Type.String()), Type.Null()])
    ),
    status_attributions: Type.Optional(
      Type.Union([Type.Array(Type.String()), Type.Null()])
    ),
    conversion_source: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    conversion_delay_seconds: Type.Optional(
      Type.Union([Type.Number(), Type.Null()])
    ),
    external_ad_reply: Type.Optional(
      Type.Union([externalAdReplySchema, Type.Null()])
    ),
    entry_point_conversion_source: Type.Optional(
      Type.Union([Type.String(), Type.Null()])
    ),
    entry_point_conversion_app: Type.Optional(
      Type.Union([Type.String(), Type.Null()])
    ),
    entry_point_conversion_delay_seconds: Type.Optional(
      Type.Union([Type.Number(), Type.Null()])
    ),
    trust_banner_action: Type.Optional(
      Type.Union([Type.Number(), Type.Null()])
    ),
    ctwa_signals: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    is_forwarded: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    forwarding_score: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  },
  { additionalProperties: true }
);

export const templateButtonSchema = Type.Object({
  displayText: Type.String(),
  id: Type.String(),
});

export const templateMessageSchema = Type.Object({
  hydratedTitleText: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  hydratedContentText: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  hydratedButtons: Type.Optional(
    Type.Union([Type.Array(templateButtonSchema), Type.Null()])
  ),
  templateId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  verifiedBizName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const officialTemplateVariableSchema = Type.Object({
  key: Type.String(),
  component_type: Type.Union([
    Type.Literal('HEADER'),
    Type.Literal('BODY'),
    Type.Literal('FOOTER'),
    Type.Literal('BUTTON'),
  ]),
  index: Type.Number(),
  parameter_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  button_index: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  value: Type.Optional(Type.String()),
  sample: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const officialTemplateButtonSchema = Type.Object(
  {
    type: Type.String(),
    text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    phone_number: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    variables: Type.Optional(Type.Array(officialTemplateVariableSchema)),
  },
  { additionalProperties: true }
);

export const officialTemplateComponentSchema = Type.Object(
  {
    type: Type.String(),
    format: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    buttons: Type.Optional(
      Type.Union([Type.Array(officialTemplateButtonSchema), Type.Null()])
    ),
    variables: Type.Optional(Type.Array(officialTemplateVariableSchema)),
  },
  { additionalProperties: true }
);

export const officialTemplatePreviewSchema = Type.Object({
  header: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  body: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  footer: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  buttons: Type.Optional(Type.Array(Type.String())),
});

export const officialTemplateMessageSchema = Type.Object(
  {
    name: Type.String(),
    language: Type.String(),
    category: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    parameter_format: Type.Optional(
      Type.Union([Type.Literal('POSITIONAL'), Type.Literal('NAMED')])
    ),
    components: Type.Optional(Type.Array(officialTemplateComponentSchema)),
    variables: Type.Optional(Type.Array(officialTemplateVariableSchema)),
    preview: Type.Optional(officialTemplatePreviewSchema),
  },
  { additionalProperties: true }
);

const officialWhatsappDisplayActionSchema = Type.Object(
  {
    id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    phone_number: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: true }
);

const officialWhatsappDisplayMediaSchema = Type.Object(
  {
    type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    link: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    caption: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: true }
);

const officialWhatsappDisplaySectionSchema = Type.Object(
  {
    id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    rows: Type.Optional(Type.Array(officialWhatsappDisplayActionSchema)),
    items: Type.Optional(Type.Array(officialWhatsappDisplayActionSchema)),
  },
  { additionalProperties: true }
);

const officialWhatsappDisplayCardSchema = Type.Object(
  {
    title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    body: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    footer: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    media: Type.Optional(
      Type.Union([officialWhatsappDisplayMediaSchema, Type.Null()])
    ),
    actions: Type.Optional(Type.Array(officialWhatsappDisplayActionSchema)),
    items: Type.Optional(Type.Array(officialWhatsappDisplayActionSchema)),
  },
  { additionalProperties: true }
);

const officialWhatsappDisplayMetadataSchema = Type.Object(
  {
    kind: Type.String({
      enum: [
        'button',
        'list',
        'cta_url',
        'location_request',
        'flow',
        'product',
        'product_list',
        'catalog',
        'carousel',
        'address',
        'template',
        'order',
        'reply',
        'referral',
        'system',
        'unsupported',
        'call_permission_request',
      ],
    }),
    raw_type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    body: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    footer: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    action_label: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    actions: Type.Optional(Type.Array(officialWhatsappDisplayActionSchema)),
    sections: Type.Optional(Type.Array(officialWhatsappDisplaySectionSchema)),
    items: Type.Optional(Type.Array(officialWhatsappDisplayActionSchema)),
    cards: Type.Optional(Type.Array(officialWhatsappDisplayCardSchema)),
    media: Type.Optional(
      Type.Union([officialWhatsappDisplayMediaSchema, Type.Null()])
    ),
    submitted_data: Type.Optional(
      Type.Union([Type.Record(Type.String(), Type.Any()), Type.Null()])
    ),
  },
  { additionalProperties: true }
);

export const officialWhatsappContentMetadataSchema = Type.Object(
  {
    provider: Type.Literal('meta_whatsapp'),
    type: Type.String(),
    webhook_field: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    message_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    echo: Type.Optional(Type.Boolean()),
    display: Type.Optional(
      Type.Union([officialWhatsappDisplayMetadataSchema, Type.Null()])
    ),
    interactive: Type.Optional(
      Type.Union([
        Type.Object(
          {
            type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            description: Type.Optional(
              Type.Union([Type.String(), Type.Null()])
            ),
          },
          { additionalProperties: true }
        ),
        Type.Null(),
      ])
    ),
    order: Type.Optional(
      Type.Union([
        Type.Object(
          {
            catalog_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            product_items: Type.Optional(Type.Array(Type.Any())),
          },
          { additionalProperties: true }
        ),
        Type.Null(),
      ])
    ),
    button: Type.Optional(
      Type.Union([
        Type.Object(
          {
            text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            payload: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          },
          { additionalProperties: true }
        ),
        Type.Null(),
      ])
    ),
    unsupported: Type.Optional(
      Type.Union([
        Type.Object(
          {
            type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          },
          { additionalProperties: true }
        ),
        Type.Null(),
      ])
    ),
    referral: Type.Optional(
      Type.Union([Type.Record(Type.String(), Type.Any()), Type.Null()])
    ),
    errors: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
    raw: Type.Optional(Type.Record(Type.String(), Type.Any())),
  },
  { additionalProperties: true }
);

export const pinMessageSchema = Type.Object({
  pin_action: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  pin_user_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  pin_user_phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const ephemeralMessageSchema = Type.Object({
  enabled: Type.Boolean(),
  expiration_seconds: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  user_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  user_phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const albumMessageSchema = Type.Object({
  id: Type.String(),
  parent_message_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  item_index: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  association_type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  source: Type.Optional(
    Type.Union([
      Type.Literal('baileys'),
      Type.Literal('wwebjs'),
      Type.Literal('whatsmeow'),
      Type.Null(),
    ])
  ),
});

export const forwardMessageSchema = Type.Object(
  {
    source_message_id: Type.String(),
    source_chat_id: Type.String(),
    source_type: Type.String({ enum: Object.values(EMessageType) }),
    source_worker_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    source_message_key: Type.Optional(
      Type.Union([messageKeySchema, Type.Null()])
    ),
  },
  { additionalProperties: true }
);

export const contentSchema = Type.Object(
  {
    type: Type.String({ enum: Object.values(EMessageType) }),
    message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    message_quoted_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    link_preview: Type.Optional(
      Type.Union([viewLinkPreviewResponseSchema, Type.Null()])
    ),
    quoted: Type.Optional(Type.Union([quotedMessageSchema, Type.Null()])),
    image: Type.Optional(Type.Union([imageSchema, Type.Null()])),
    video: Type.Optional(Type.Union([videoSchema, Type.Null()])),
    sticker: Type.Optional(Type.Union([stickerSchema, Type.Null()])),
    location: Type.Optional(Type.Union([locationSchema, Type.Null()])),
    contact: Type.Optional(Type.Union([contactSchema, Type.Null()])),
    contacts: Type.Optional(
      Type.Union([Type.Array(contactSchema), Type.Null()])
    ),
    audio: Type.Optional(Type.Union([audioSchema, Type.Null()])),
    document: Type.Optional(Type.Union([documentSchema, Type.Null()])),
    reactions: Type.Optional(
      Type.Union([Type.Array(reactionSchema), Type.Null()])
    ),
    version: Type.Optional(
      Type.Union([Type.Array(messageVersionSchema), Type.Null()])
    ),
    context_info: Type.Optional(Type.Union([contextInfoSchema, Type.Null()])),
    template: Type.Optional(Type.Union([templateMessageSchema, Type.Null()])),
    buttons: Type.Optional(Type.Union([buttonMessageSchema, Type.Null()])),
    list: Type.Optional(Type.Union([listMessageSchema, Type.Null()])),
    official_template: Type.Optional(
      Type.Union([officialTemplateMessageSchema, Type.Null()])
    ),
    official: Type.Optional(
      Type.Union([officialWhatsappContentMetadataSchema, Type.Null()])
    ),
    pin: Type.Optional(Type.Union([pinMessageSchema, Type.Null()])),
    ephemeral: Type.Optional(Type.Union([ephemeralMessageSchema, Type.Null()])),
    album: Type.Optional(Type.Union([albumMessageSchema, Type.Null()])),
    forward: Type.Optional(Type.Union([forwardMessageSchema, Type.Null()])),
    annotation_subtype: Type.Optional(
      Type.Union([
        Type.Literal('closure'),
        Type.Literal('closure_audit'),
        Type.Null(),
      ])
    ),
  },
  { additionalProperties: true }
);

export const listMessageResultSchema = Type.Object({
  message_id: Type.String(),
  chat_id: Type.String(),
  message_key: Type.Optional(Type.Union([messageKeySchema, Type.Null()])),
  type_user: Type.String({ enum: Object.values(ETypeUserChat) }),
  user: Type.Optional(Type.Union([userSchema, Type.Null()])),
  content: Type.Optional(Type.Union([contentSchema, Type.Null()])),
  summary: Type.Optional(Type.Union([summarySchema, Type.Null()])),
  date: Type.String(),
  deleted: Type.Optional(Type.Boolean()),
  has_quoted: Type.Optional(Type.Boolean()),
  hash: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sent_from_platform: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  delivery_status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  provider_error_code: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  provider_status_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listMessageResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listMessageResultSchema),
  official_window: Type.Optional(
    Type.Union([officialWindowSchema, Type.Null()])
  ),
});

export type ListMessageResult = Static<typeof listMessageResultSchema>;
export type LinkPreview = Static<typeof viewLinkPreviewResponseSchema>;
export type ContentMessageChat = Static<typeof contentSchema>;
export type MessageVersion = Static<typeof messageVersionSchema>;
export type AlbumMessageChat = Static<typeof albumMessageSchema>;
export type ForwardMessageChat = Static<typeof forwardMessageSchema>;
export type ButtonMessageChat = Static<typeof buttonMessageSchema>;
export type ListInteractiveMessageChat = Static<typeof listMessageSchema>;
export type ImageMessageChat = Static<typeof imageSchema>;
export type VideoMessageChat = Static<typeof videoSchema>;
export type AudioMessageChat = Static<typeof audioSchema>;
export type DocumentMessageChat = Static<typeof documentSchema>;
export type StickerMessageChat = Static<typeof stickerSchema>;
export type LocationMessageChat = Static<typeof locationSchema>;
export type ListMessageResponse = Static<typeof listMessageResponseSchema>;
