<script lang="ts" setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useChatStore } from '@/@webcore/stores/chat';
import {
  LinkPreview,
  ListMessageResult,
} from '@core/schema/chat/listMessageChats/response.schema';
import { isTypeUser } from '@core/common/functions/isTypeUser';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EColor } from '@core/common/enums/EColor';
import { IReaction } from '@core/common/interfaces/IChatMessage';
import { Picker, EmojiIndex } from 'emoji-mart-vue-fast/src';
import data from 'emoji-mart-vue-fast/data/all.json';
import 'emoji-mart-vue-fast/css/emoji-mart.css';

const { t } = useI18n();
const chatStore = useChatStore();
const chatLogContainer = ref<HTMLElement | null>(null);

const reactionEmojiIndex = new EmojiIndex(data);

const viewerOpen = ref(false);
const viewerSrc = ref<string>('');
const viewerCaption = ref<string>('');

const resolveFeedbackIcon = (
  message: ListMessageResult
): { icon: string; color: string | undefined } => {
  if (message.summary?.is_seen)
    return { icon: 'tabler-checks', color: 'success' };
  if (message.summary?.is_delivered)
    return { icon: 'tabler-checks', color: undefined };
  return { icon: 'tabler-check', color: undefined };
};

const resolvePhoto = (message: ListMessageResult): string => {
  if (isTypeUser(message) && chatStore.activeChat?.photo)
    return chatStore.activeChat.photo;
  if (!isTypeUser(message) && message.user?.photo) return message.user.photo;
  if (!isTypeUser(message) && chatStore.user?.info.photo)
    return chatStore.user.info.photo;
  return '';
};

const isPhotoExist = (message: ListMessageResult): boolean =>
  !!resolvePhoto(message);

const avatarText = (name?: string) => {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
};

const avatarChat = (message: ListMessageResult) => {
  if (isTypeUser(message) && chatStore.activeChat?.name)
    return avatarText(chatStore.activeChat.name);
  const name = message.user?.name ?? chatStore.user?.info.name;
  return avatarText(name);
};

const resolvePreviewImage = (lp?: LinkPreview): string => {
  if (!lp) return '';
  if (lp.originalThumbnailUrl) return lp.originalThumbnailUrl;
  if (lp.jpegThumbnail) return `data:image/jpeg;base64,${lp.jpegThumbnail}`;
  return '';
};

const domainFromUrl = (u?: string | null): string => {
  if (!u) return '';
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

const resolvePreviewUrl = (lp?: LinkPreview): string =>
  lp?.['matched-text'] ?? lp?.['canonical-url'] ?? '';

const isDeleted = (m: ListMessageResult): boolean => m.deleted === true;

const onReply = (m: ListMessageResult) => {
  if (isDeleted(m)) return;

  chatStore.setMessageReply(m);
  (globalThis as Window & typeof globalThis).dispatchEvent(
    new CustomEvent('focus-composer')
  );
};

const onCopy = async (m: ListMessageResult) => {
  if (isDeleted(m)) return;

  const text =
    m.content?.message ||
    m.content?.link_preview?.['matched-text'] ||
    m.content?.link_preview?.['canonical-url'] ||
    '';
  if (text) await navigator.clipboard.writeText(text);
};

const hoveredMessageId = ref<string | null>(null);
const showReactionPicker = ref<string | null>(null);
const showEmojiPicker = ref<string | null>(null);

const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const ignoreOutsideOnce = ref(false);

const onReact = async (m: ListMessageResult, emoji: string) => {
  if (isDeleted(m)) return;
  if (!chatStore.activeChat?.chat_id) return;

  const success = await chatStore.reactToMessage(
    chatStore.activeChat.chat_id,
    m.message_id,
    emoji
  );

  if (success) {
    showReactionPicker.value = null;
    showEmojiPicker.value = null;
  }
};

const onMouseEnter = (message: ListMessageResult) => {
  if (isDeleted(message)) return;

  hoveredMessageId.value = message.message_id;
};

const onMouseLeave = () => {
  hoveredMessageId.value = null;
};

const toggleReactionPicker = (message: ListMessageResult) => {
  if (isDeleted(message)) return;

  ignoreOutsideOnce.value = true;
  if (showReactionPicker.value === message.message_id) {
    showReactionPicker.value = null;
    return;
  }
  showReactionPicker.value = message.message_id;
  showEmojiPicker.value = null;
};

const onClickOutside = (event: MouseEvent) => {
  if (ignoreOutsideOnce.value) {
    ignoreOutsideOnce.value = false;
    return;
  }
  const target = event.target as HTMLElement;
  if (
    !target.closest('.reaction-picker') &&
    !target.closest('.reaction-trigger')
  ) {
    showReactionPicker.value = null;
    showEmojiPicker.value = null;
  }
};

const toggleEmojiPicker = (messageId: string) => {
  if (showEmojiPicker.value === messageId) {
    showEmojiPicker.value = null;
    return;
  }
  showEmojiPicker.value = messageId;
};

const onSelectReactionEmoji = async (
  m: ListMessageResult,
  emoji: { native?: string; id?: string }
) => {
  const value = emoji?.native ?? emoji?.id;
  if (!value) return;

  await onReact(m, value);
  showEmojiPicker.value = null;
};

const getReactionsSummary = (
  reactions?: IReaction[] | null
): Array<{ emoji: string; count: number }> => {
  if (!reactions?.length) return [];
  const summary = new Map<string, { emoji: string; count: number }>();
  reactions.forEach((reaction) => {
    if (!reaction?.emoji) return;
    const current = summary.get(reaction.emoji);
    if (!current) {
      summary.set(reaction.emoji, { emoji: reaction.emoji, count: 1 });

      return;
    }
    current.count += 1;
  });

  return Array.from(summary.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.emoji.localeCompare(b.emoji);
  });
};

const onDelete = async (m: ListMessageResult) => {
  if (isDeleted(m)) return;
  if (!chatStore.activeChat?.chat_id) return;

  if (hoveredMessageId.value === m.message_id) {
    hoveredMessageId.value = null;
  }
  if (showReactionPicker.value === m.message_id) {
    showReactionPicker.value = null;
    showEmojiPicker.value = null;
  }

  const success = await chatStore.deleteMessage(
    chatStore.activeChat.chat_id,
    m.message_id
  );

  if (success) {
    chatStore.showSnackbar(t('chat_delete_success'), EColor.success);
    return;
  }

  chatStore.showSnackbar(t('chat_delete_error'), EColor.error);
};

const showQuoted = (m: ListMessageResult) => {
  if (m.content?.type !== EMessageType.text_quoted || !m.content?.quoted) {
    return false;
  }

  if (m.content.quoted.type === EMessageType.image) {
    return !!(m.content.quoted.image?.url || m.content.quoted.image?.thumbnail);
  }

  return !!m.content.quoted.message;
};

const resolveQuotedName = (m: ListMessageResult): string => {
  const fromMe = m.content?.quoted?.key?.from_me ?? null;
  if (fromMe === true) return chatStore.user?.info.name ?? '';
  if (fromMe === false) return chatStore.activeChat?.name ?? '';
  return '';
};

const resolveQuotedText = (m: ListMessageResult): string => {
  if (!m.content?.quoted) {
    return '';
  }

  if (m.content.quoted.type === EMessageType.image || m.content.quoted.image) {
    return m.content.quoted.image?.caption || t('photo_label');
  }

  return m.content.quoted.message ?? '';
};

const resolveQuotedImageSrc = (m: ListMessageResult): string => {
  const image = m.content?.quoted?.image;
  if (!image) return '';
  return image.url || image.thumbnail || '';
};

const hasQuotedImage = (m: ListMessageResult): boolean => {
  const image = m.content?.quoted?.image;
  if (!image) return false;
  return !!(image.url || image.thumbnail);
};

const getQuotedTargetId = (m: ListMessageResult): string | null => {
  const byExplicitId = m.content?.message_quoted_id || null;
  if (byExplicitId) return String(byExplicitId);

  const byKeyId = m.content?.quoted?.key?.id || null;
  if (byKeyId) {
    const matchByKey = chatStore.listMessages.find(
      (x) => x.message_key?.id === byKeyId
    );
    if (matchByKey) {
      return matchByKey.message_id;
    }
  }

  const text = m.content?.quoted?.message?.trim();
  if (!text) return null;

  const found = chatStore.listMessages.find(
    (x) => x.content?.message?.trim() === text
  );
  return found?.message_id || null;
};

const goToQuoted = (m: ListMessageResult) => {
  if (isDeleted(m)) return;

  const targetId = getQuotedTargetId(m);
  if (!targetId) return;

  (globalThis as Window & typeof globalThis).dispatchEvent(
    new CustomEvent('scroll-to-message', { detail: targetId })
  );
};

const openImage = (m: ListMessageResult) => {
  if (isDeleted(m)) return;

  viewerSrc.value = m.content?.image?.url || '';
  viewerCaption.value = m.content?.image?.caption || '';
  viewerOpen.value = true;
};

const handleScroll = async (e: Event) => {
  const target = e.target as HTMLElement;
  if (!target) return;

  const scrollTop = target.scrollTop;
  const threshold = 200;

  if (
    scrollTop < threshold &&
    !chatStore.loadingMoreMessages &&
    chatStore.currentPage < chatStore.totalPages
  ) {
    const previousScrollHeight = target.scrollHeight;
    const previousScrollTop = target.scrollTop;

    const success = await chatStore.loadMoreMessages();

    if (success) {
      await nextTick();
      const newScrollHeight = target.scrollHeight;
      const scrollDifference = newScrollHeight - previousScrollHeight;
      target.scrollTop = previousScrollTop + scrollDifference;
    }
  }
};

onMounted(() => {
  nextTick(() => {
    const psContainer = chatLogContainer.value?.closest('.ps') as HTMLElement;
    const scrollElement =
      (psContainer?.querySelector('.ps__rail-y')
        ?.parentElement as HTMLElement) || psContainer;

    if (scrollElement) {
      scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    }

    document.addEventListener('click', onClickOutside);
  });
});

onUnmounted(() => {
  const psContainer = chatLogContainer.value?.closest('.ps') as HTMLElement;
  const scrollElement =
    (psContainer?.querySelector('.ps__rail-y')?.parentElement as HTMLElement) ||
    psContainer;

  if (scrollElement) {
    scrollElement.removeEventListener('scroll', handleScroll);
  }

  document.removeEventListener('click', onClickOutside);
});
</script>

<template>
  <div ref="chatLogContainer" class="chat-log pa-6">
    <div
      v-if="chatStore.loadingMoreMessages"
      class="d-flex justify-center align-center py-4"
    >
      <VChip color="primary" variant="flat" size="small">
        <VIcon start icon="tabler-loader-2" class="spin" />
        {{ t('loading_more_messages') }}
      </VChip>
    </div>

    <div
      v-for="(msgGrp, index) in chatStore.listMessages"
      :key="msgGrp.message_id"
      :id="`msg-${msgGrp.message_id}`"
      :data-message-id="msgGrp.message_id"
      class="chat-group d-flex align-start position-relative"
      :class="[
        {
          'flex-row-reverse': !isTypeUser(msgGrp),
          'mb-6': chatStore.listMessages.length - 1 !== index,
        },
      ]"
      @mouseenter="onMouseEnter(msgGrp)"
      @mouseleave="onMouseLeave"
    >
      <div class="chat-avatar" :class="!isTypeUser(msgGrp) ? 'ms-4' : 'me-4'">
        <VAvatar
          size="32"
          :variant="!isPhotoExist(msgGrp) ? 'tonal' : undefined"
        >
          <VImg v-if="isPhotoExist(msgGrp)" :src="resolvePhoto(msgGrp)" />
          <span v-if="!isPhotoExist(msgGrp)" class="text-1xl">
            {{ avatarChat(msgGrp) }}
          </span>
        </VAvatar>
      </div>

      <div
        class="chat-body d-inline-flex flex-column position-relative"
        :class="!isTypeUser(msgGrp) ? 'align-end' : 'align-start'"
      >
        <div
          class="chat-content-wrapper"
          :class="!isTypeUser(msgGrp) ? 'wrapper-operator' : 'wrapper-client'"
        >
          <VBtn
            v-if="hoveredMessageId === msgGrp.message_id && !msgGrp.deleted"
            icon
            size="28"
            variant="flat"
            :class="[
              'reaction-trigger',
              !isTypeUser(msgGrp) ? 'wrapper-operator' : 'wrapper-client',
            ]"
            color="grey-600"
            @click.stop="toggleReactionPicker(msgGrp)"
          >
            <VIcon size="18">tabler-mood-smile</VIcon>
          </VBtn>

          <div
            class="chat-content py-2 px-2 elevation-2"
            :class="[
              isTypeUser(msgGrp) ? 'chat-left' : 'chat-right',
              {
                'is-deleted': msgGrp.deleted,
                'has-actions': !msgGrp.deleted,
              },
            ]"
            :style="{
              backgroundColor: isTypeUser(msgGrp)
                ? 'rgb(var(--v-theme-surface))'
                : 'rgb(217, 253, 211)',
            }"
          >
            <div v-if="!msgGrp.deleted" class="message-actions">
              <VMenu
                :close-on-content-click="true"
                location="bottom end"
                offset="6"
              >
                <template #activator="{ props }">
                  <VBtn
                    v-bind="props"
                    icon
                    size="24"
                    density="comfortable"
                    variant="text"
                    :color="
                      isTypeUser(msgGrp)
                        ? 'rgb(var(--v-theme-on-surface))'
                        : 'rgb(var(--v-theme-title))'
                    "
                  >
                    <VIcon size="18">tabler-chevron-down</VIcon>
                  </VBtn>
                </template>

                <VList density="compact" min-width="180">
                  <VListItem @click="onReply(msgGrp)">
                    <template #prepend>
                      <VIcon size="18">tabler-corner-up-left</VIcon>
                    </template>
                    <VListItemTitle>Responder</VListItemTitle>
                  </VListItem>

                  <VListItem @click="onCopy(msgGrp)">
                    <template #prepend>
                      <VIcon size="18">tabler-copy</VIcon>
                    </template>
                    <VListItemTitle>Copiar</VListItemTitle>
                  </VListItem>

                  <VListItem @click="toggleReactionPicker(msgGrp)">
                    <template #prepend>
                      <VIcon size="18">tabler-mood-smile</VIcon>
                    </template>
                    <VListItemTitle>Reagir</VListItemTitle>
                  </VListItem>

                  <VListItem
                    v-if="!isTypeUser(msgGrp)"
                    @click="onDelete(msgGrp)"
                  >
                    <template #prepend>
                      <VIcon size="18">tabler-trash</VIcon>
                    </template>
                    <VListItemTitle>Apagar</VListItemTitle>
                  </VListItem>
                </VList>
              </VMenu>
            </div>

            <div class="message-block">
              <div
                v-if="showQuoted(msgGrp)"
                class="quoted-block"
                :class="{
                  'is-right': !isTypeUser(msgGrp),
                  'is-clickable': !msgGrp.deleted,
                }"
                @click="goToQuoted(msgGrp)"
              >
                <div v-if="hasQuotedImage(msgGrp)" class="quoted-media">
                  <VImg
                    :src="resolveQuotedImageSrc(msgGrp)"
                    width="44"
                    height="44"
                    cover
                  />
                </div>
                <div class="quoted-body">
                  <div class="quoted-name">
                    {{ resolveQuotedName(msgGrp) }}
                  </div>

                  <div
                    class="quoted-text"
                    :style="{
                      color: isTypeUser(msgGrp)
                        ? 'rgb(var(--v-theme-on-surface))'
                        : 'rgb(var(--v-theme-title))',
                    }"
                  >
                    {{ resolveQuotedText(msgGrp) }}
                  </div>
                </div>
              </div>

              <div
                v-if="msgGrp.content?.link_preview?.title"
                class="link-preview rounded"
                :class="
                  !isTypeUser(msgGrp)
                    ? 'link-preview--right'
                    : 'link-preview--left'
                "
                :style="{
                  backgroundColor: isTypeUser(msgGrp)
                    ? 'rgb(var(--v-theme-grey-200))'
                    : 'rgb(214, 243, 207)',
                  color: isTypeUser(msgGrp)
                    ? 'rgb(var(--v-theme-on-grey))'
                    : 'rgb(var(--v-theme-title))',
                }"
              >
                <div class="lp-main d-flex">
                  <div v-if="resolvePreviewImage(msgGrp.content.link_preview)">
                    <div class="lp-thumb me-3">
                      <img
                        :src="resolvePreviewImage(msgGrp.content.link_preview)"
                        alt=""
                      />
                    </div>
                  </div>

                  <div class="lp-text">
                    <div class="lp-domain text-xs mb-1">
                      {{
                        domainFromUrl(
                          msgGrp.content.link_preview['canonical-url'] ||
                            msgGrp.content.link_preview['matched-text']
                        )
                      }}
                    </div>

                    <div class="lp-title text-sm mb-1">
                      {{ msgGrp.content.link_preview.title }}
                    </div>

                    <div class="lp-desc text-xs">
                      {{ msgGrp.content.link_preview.description }}
                    </div>
                  </div>
                </div>

                <a
                  v-if="resolvePreviewUrl(msgGrp.content.link_preview)"
                  class="lp-url d-block mt-2 text-sm"
                  :href="resolvePreviewUrl(msgGrp.content.link_preview)"
                  target="_blank"
                  rel="noopener"
                >
                  {{ resolvePreviewUrl(msgGrp.content.link_preview) }}
                </a>
              </div>

              <div
                v-if="
                  msgGrp.content?.type === EMessageType.image &&
                  msgGrp.content?.image?.url &&
                  !msgGrp.message_key?.is_view_once
                "
                :class="[
                  'image-bubble',
                  !isTypeUser(msgGrp)
                    ? 'image-bubble--right'
                    : 'image-bubble--left',
                  { 'is-deleted': msgGrp.deleted },
                ]"
                @click="openImage(msgGrp)"
              >
                <VImg
                  :src="msgGrp.content.image.url"
                  :aspect-ratio="
                    msgGrp.content.image.width && msgGrp.content.image.height
                      ? msgGrp.content.image.width / msgGrp.content.image.height
                      : undefined
                  "
                  class="image-thumb"
                  width="120"
                  cover
                />

                <p
                  v-if="msgGrp.content.image.caption"
                  class="image-caption mt-2"
                  :style="{
                    color: isTypeUser(msgGrp)
                      ? 'rgb(var(--v-theme-on-surface))'
                      : 'rgb(var(--v-theme-title))',
                  }"
                >
                  {{ msgGrp.content.image.caption }}
                </p>
              </div>

              <p
                v-if="msgGrp.message_key?.is_view_once"
                class="mb-2 mr-6 text-base message-text"
                style="font-style: italic"
                :style="{
                  color: isTypeUser(msgGrp)
                    ? 'rgb(var(--v-theme-on-surface))'
                    : 'rgb(var(--v-theme-title))',
                }"
              >
                {{ t('view_once_message') }}
              </p>

              <p
                v-if="
                  msgGrp.content?.message &&
                  msgGrp.content?.type !== EMessageType.image &&
                  !msgGrp.message_key?.is_view_once
                "
                class="mb-2 mr-6 text-base message-text"
                :style="{
                  color: isTypeUser(msgGrp)
                    ? 'rgb(var(--v-theme-on-surface))'
                    : 'rgb(var(--v-theme-title))',
                }"
              >
                {{ msgGrp.content?.message }}
              </p>
            </div>

            <div class="message-meta">
              <span class="message-time text-xs">
                {{
                  formatDate(msgGrp.date, {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })
                }}
              </span>
              <VIcon size="16" :color="resolveFeedbackIcon(msgGrp).color">
                {{ resolveFeedbackIcon(msgGrp).icon }}
              </VIcon>
            </div>

            <div
              v-if="
                !msgGrp.deleted &&
                getReactionsSummary(msgGrp.content?.reactions).length
              "
              class="reactions-summary"
              :class="{
                'reactions-summary--right': !isTypeUser(msgGrp),
                'reactions-summary--left': isTypeUser(msgGrp),
              }"
            >
              <div class="reaction-summary-bubble">
                <template
                  v-for="reaction in getReactionsSummary(
                    msgGrp.content?.reactions
                  )"
                  :key="`${msgGrp.message_id}-${reaction.emoji}`"
                >
                  <span class="reaction-summary-item">
                    <span class="reaction-summary-emoji">
                      {{ reaction.emoji }}
                    </span>
                    <span
                      v-if="reaction.count > 1"
                      class="reaction-summary-count"
                    >
                      {{ reaction.count }}
                    </span>
                  </span>
                </template>
              </div>
            </div>
          </div>

          <div
            v-if="showReactionPicker === msgGrp.message_id && !msgGrp.deleted"
            class="reaction-picker"
            :class="
              !isTypeUser(msgGrp)
                ? 'reaction-picker-operator'
                : 'reaction-picker-client'
            "
            @click.stop
          >
            <div class="reaction-picker-content d-flex align-center ga-1">
              <VBtn
                v-for="emoji in quickReactions"
                :key="emoji"
                icon
                size="32"
                variant="text"
                class="reaction-btn"
                @click="onReact(msgGrp, emoji)"
              >
                <span class="text-h6">{{ emoji }}</span>
              </VBtn>
              <VDivider vertical class="mx-1" />
              <VBtn
                icon
                size="32"
                variant="text"
                class="reaction-btn"
                @click.stop="toggleEmojiPicker(msgGrp.message_id)"
              >
                <VIcon size="20">tabler-plus</VIcon>
              </VBtn>
            </div>
            <div
              v-if="showEmojiPicker === msgGrp.message_id"
              class="reaction-picker-full"
            >
              <Picker
                :data="reactionEmojiIndex"
                :per-line="8"
                :show-preview="false"
                :show-skin-tones="false"
                :show-search="true"
                @select="onSelectReactionEmoji(msgGrp, $event)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <VDialog
    v-model="viewerOpen"
    fullscreen
    scrim="rgba(0,0,0,.9)"
    :scrollable="false"
  >
    <div class="viewer-wrap" @click="viewerOpen = false">
      <div class="viewer-box" @click.stop>
        <button class="viewer-close" @click="viewerOpen = false">
          <VIcon size="28">tabler-x</VIcon>
        </button>

        <img
          :src="viewerSrc"
          alt=""
          class="viewer-img"
          loading="eager"
          decoding="async"
        />

        <div v-if="viewerCaption" class="viewer-caption">
          {{ viewerCaption }}
        </div>
      </div>
    </div>
  </VDialog>
</template>

<style lang="scss">
.chat-log {
  .chat-body {
    max-inline-size: calc(100% - 6.75rem);
    .chat-content-wrapper {
      position: relative;
      display: inline-flex;
    }

    .message-text {
      white-space: pre-line;
    }

    .chat-content {
      position: relative;
      border-end-end-radius: 6px;
      border-end-start-radius: 6px;
      padding-right: 1.8rem !important;
      padding-bottom: 1.4rem !important;

      p {
        overflow-wrap: anywhere;
      }

      &.chat-left {
        border-start-end-radius: 6px;
        .message-meta {
          color: rgba(var(--v-theme-on-surface), 0.6);
        }
      }

      &.chat-right {
        border-start-start-radius: 6px;
        .message-meta {
          color: rgba(17, 27, 33, 0.6);
        }
      }

      &.is-deleted {
        opacity: 0.7;
      }

      &.is-deleted .message-text,
      &.is-deleted .image-caption {
        text-decoration: line-through;
      }

      &.is-deleted .link-preview,
      &.is-deleted .quoted-block {
        pointer-events: none;
        cursor: default;
        opacity: 0.75;
      }

      &.is-deleted a {
        pointer-events: none;
        cursor: default;
      }

      .message-actions {
        position: absolute;
        top: 2px;
        right: 1px !important;
        inset-inline-end: 6px;
        opacity: 0;
        visibility: hidden;
        z-index: 2;
        transition: opacity 0.15s ease;

        .v-btn {
          width: 28px !important;
          height: 28px !important;
          min-width: 28px !important;
        }
      }

      &:hover .message-actions {
        opacity: 1;
        visibility: visible;
      }

      &.has-actions {
        padding-inline-end: 36px;
      }

      .quoted-block {
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(var(--v-theme-primary), 0.08);
        border-inline-start: 3px solid rgb(var(--v-theme-primary));
        border-radius: 8px;
        padding: 8px 10px;
        margin-bottom: 6px;
      }

      .quoted-block.is-clickable {
        cursor: pointer;
      }

      .quoted-media {
        inline-size: 44px;
        block-size: 44px;
        border-radius: 6px;
        overflow: hidden;
        flex-shrink: 0;

        .v-img {
          inline-size: 100%;
          block-size: 100%;
        }
      }

      .quoted-body {
        min-inline-size: 0;
        flex: 1;
      }

      .quoted-name {
        color: rgb(var(--v-theme-primary));
        font-weight: 600;
        font-size: 0.85rem;
        margin-bottom: 4px;
        line-height: 1.1;
      }

      .quoted-text {
        font-size: 0.9rem;
        color: rgb(var(--v-theme-on-surface));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .link-preview {
        padding: 10px;
        border-radius: 8px;
        border: 1px solid rgb(var(--v-theme-on-secondary));
        transition: border-color 0.2s ease;

        .lp-thumb img {
          inline-size: 48px;
          block-size: 48px;
          object-fit: cover;
          border-radius: 6px;
          display: block;
        }

        .lp-title {
          font-weight: 600;
          overflow: hidden;
          display: -webkit-box;
          -webkit-box-orient: vertical;
        }

        .lp-desc {
          opacity: 0.8;
          overflow: hidden;
          display: -webkit-box;
          -webkit-box-orient: vertical;
        }

        .lp-url {
          word-break: break-all;
          text-decoration: none;
        }
      }

      .image-bubble {
        max-inline-size: 260px;
        inline-size: 100%;
        cursor: zoom-in;

        .image-thumb {
          border-radius: 8px;
          inline-size: 100%;
          max-inline-size: 260px;
          max-block-size: 360px;
        }

        .image-caption {
          font-size: 0.95rem;
          line-height: 1.25rem;
          white-space: pre-line;
          margin-bottom: 0 !important;
        }

        &.is-deleted {
          cursor: default;
          pointer-events: none;
          filter: grayscale(0.85);
          opacity: 0.6;
        }
      }

      .image-bubble--left .image-thumb {
        border-start-end-radius: 6px;
      }

      .image-bubble--right .image-thumb {
        border-start-start-radius: 6px;
      }
    }
  }

  .reaction-trigger {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    background: rgb(var(--v-theme-surface));
    border-radius: 50%;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    min-width: 28px;
    height: 28px;
    border: 0.5px solid rgba(var(--v-theme-on-surface), 0.06);
    color: rgba(var(--v-theme-on-surface), 0.6);
  }

  .reaction-picker {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 11;
    background: rgb(var(--v-theme-surface));
    border-radius: 24px;
    padding: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

    .reaction-picker-content {
      .reaction-btn {
        min-width: 36px;
        height: 36px;
        border-radius: 50%;
        transition: transform 0.2s;

        &:hover {
          transform: scale(1.1);
        }
      }
    }
  }

  .wrapper-operator {
    .reaction-trigger {
      right: calc(100% + 4px);
    }

    .reaction-picker {
      right: calc(100% + 4px);
    }
  }

  .wrapper-client {
    .reaction-trigger {
      left: calc(100% + 4px);
    }

    .reaction-picker {
      left: calc(100% + 4px);
    }
  }

  .reaction-picker-operator {
    right: calc(100% + 4px);
  }

  .reaction-picker-client {
    left: calc(100% + 4px);
  }

  .reactions-summary {
    position: absolute;
    display: inline-flex;
    gap: 4px;
    bottom: -2px;
    transform: translateY(60%);
    margin-inline-start: auto;

    &--right {
      justify-content: flex-end;
      right: 16px;
    }

    &--left {
      justify-content: flex-start;
      margin-inline-start: 0;
      left: 16px;
    }

    .reaction-summary-bubble {
      display: inline-flex;
      align-items: center;
      background: rgb(var(--v-theme-surface));
      border-radius: 999px;
      padding: 2px 8px;
      min-height: 22px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
      border: 0.5px solid rgba(var(--v-theme-on-surface), 0.08);
      gap: 8px;
    }

    .reaction-summary-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .reaction-summary-emoji {
      font-size: 0.9rem;
      line-height: 1;
    }

    .reaction-summary-count {
      font-size: 0.7rem;
      font-weight: 600;
      color: rgba(var(--v-theme-on-surface), 0.7);
    }
  }

  .message-meta {
    position: absolute;
    right: 12px;
    bottom: 6px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;

    .v-icon {
      font-size: 0.95rem;
    }

    .message-time {
      line-height: 1;
    }
  }
}

.viewer-wrap {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: transparent;
  padding: 16px;
  overflow: hidden;
}

.viewer-box {
  position: relative;
  display: grid;
  place-items: center;
  gap: 8px;
}

.viewer-close {
  position: absolute;
  top: 10px;
  right: 10px;
  inline-size: 40px;
  block-size: 40px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: #fff;
  cursor: pointer;
}

.viewer-img {
  display: block;
  width: auto;
  height: auto;
  max-width: 96vw;
  max-height: 96vh;
  object-fit: contain;
  border-radius: 12px;
}

.viewer-caption {
  margin-top: 6px;
  color: #fff;
  text-align: center;
  font-size: 0.95rem;
  opacity: 0.9;
  white-space: pre-line;
  user-select: text;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
