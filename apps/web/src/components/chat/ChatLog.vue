<script lang="ts" setup>
import { ref, watch } from 'vue';
import { useChatStore } from '@/@webcore/stores/chat';
import {
  LinkPreview,
  ListMessageResult,
} from '@core/schema/chat/listMessageChats/response.schema';
import { isTypeUser } from '@core/common/functions/isTypeUser';
import { EMessageType } from '@core/common/enums/EMessageType';

const { t } = useI18n();
const chatStore = useChatStore();

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

const onReply = (m: ListMessageResult) => {
  chatStore.setMessageReply(m);
  (globalThis as Window & typeof globalThis).dispatchEvent(
    new CustomEvent('focus-composer')
  );
};

const onCopy = async (m: ListMessageResult) => {
  const text =
    m.content?.message ||
    m.content?.link_preview?.['matched-text'] ||
    m.content?.link_preview?.['canonical-url'] ||
    '';
  if (text) await navigator.clipboard.writeText(text);
};

const onReact = (_m: ListMessageResult) => {};
const onDelete = (_m: ListMessageResult) => {};

const showQuoted = (m: ListMessageResult) =>
  m.content?.type === EMessageType.text_quoted && !!m.content?.quoted?.message;

const resolveQuotedName = (m: ListMessageResult): string => {
  const fromMe = m.content?.quoted?.key?.from_me ?? null;
  if (fromMe === true) return chatStore.user?.info.name ?? '';
  if (fromMe === false) return chatStore.activeChat?.name ?? '';
  return '';
};

const getQuotedTargetId = (m: ListMessageResult): string | null => {
  const byExplicitId = m.content?.message_quoted_id || null;
  if (byExplicitId) return String(byExplicitId);

  const text = m.content?.quoted?.message?.trim();
  if (!text) return null;

  const found = chatStore.listMessages.find(
    (x) => x.content?.message?.trim() === text
  );
  return found?.message_id || null;
};

const goToQuoted = (m: ListMessageResult) => {
  const targetId = getQuotedTargetId(m);
  if (!targetId) return;

  (globalThis as Window & typeof globalThis).dispatchEvent(
    new CustomEvent('scroll-to-message', { detail: targetId })
  );
};

const openImage = (m: ListMessageResult) => {
  viewerSrc.value = m.content?.image?.url || '';
  viewerCaption.value = m.content?.image?.caption || '';
  viewerOpen.value = true;
};

watch(
  () => chatStore.listMessages,
  () => {
    console.log('listMessages changed', chatStore.listMessages);
  }
);
</script>

<template>
  <div class="chat-log pa-6">
    <div
      v-for="(msgGrp, index) in chatStore.listMessages"
      :key="msgGrp.message_id"
      :id="`msg-${msgGrp.message_id}`"
      :data-message-id="msgGrp.message_id"
      class="chat-group d-flex align-start"
      :class="[
        {
          'flex-row-reverse': !isTypeUser(msgGrp),
          'mb-6': chatStore.listMessages.length - 1 !== index,
        },
      ]"
    >
      <div class="chat-avatar" :class="!isTypeUser(msgGrp) ? 'ms-4' : 'me-4'">
        <VAvatar
          size="32"
          :variant="!isPhotoExist(msgGrp) ? 'tonal' : undefined"
        >
          <VImg v-if="isPhotoExist(msgGrp)" :src="resolvePhoto(msgGrp)" />
          <span v-else class="text-1xl">
            {{ avatarChat(msgGrp) }}
          </span>
        </VAvatar>
      </div>

      <div
        class="chat-body d-inline-flex flex-column"
        :class="!isTypeUser(msgGrp) ? 'align-end' : 'align-start'"
      >
        <div
          class="chat-content py-2 px-2 elevation-2 has-actions"
          :class="[isTypeUser(msgGrp) ? 'chat-left' : 'chat-right']"
          :style="{
            backgroundColor: isTypeUser(msgGrp)
              ? 'rgb(var(--v-theme-surface))'
              : 'rgb(217, 253, 211)',
          }"
        >
          <div class="message-actions">
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

                <VListItem @click="onReact(msgGrp)">
                  <template #prepend>
                    <VIcon size="18">tabler-mood-smile</VIcon>
                  </template>
                  <VListItemTitle>Reagir</VListItemTitle>
                </VListItem>

                <VListItem @click="onDelete(msgGrp)">
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
              :class="{ 'is-right': !isTypeUser(msgGrp), 'is-clickable': true }"
              @click="goToQuoted(msgGrp)"
            >
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
                {{ msgGrp.content?.quoted?.message }}
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
                msgGrp.message_key?.is_view_once !== true
              "
              class="image-bubble"
              :class="
                !isTypeUser(msgGrp)
                  ? 'image-bubble--right'
                  : 'image-bubble--left'
              "
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
              v-if="msgGrp.message_key?.is_view_once === true"
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
                msgGrp.message_key?.is_view_once !== true
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
        </div>

        <div :class="{ 'text-right': !isTypeUser(msgGrp) }">
          <VIcon size="16" :color="resolveFeedbackIcon(msgGrp).color">
            {{ resolveFeedbackIcon(msgGrp).icon }}
          </VIcon>

          <span class="text-sm ms-2 text-disabled">
            {{
              formatDate(msgGrp.date, { hour: 'numeric', minute: 'numeric' })
            }}
          </span>
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

    .message-text {
      white-space: pre-line;
    }

    .chat-content {
      position: relative;
      border-end-end-radius: 6px;
      border-end-start-radius: 6px;
      padding-right: 1.8rem !important;

      p {
        overflow-wrap: anywhere;
      }

      &.chat-left {
        border-start-end-radius: 6px;
      }

      &.chat-right {
        border-start-start-radius: 6px;
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
        background: rgba(var(--v-theme-primary), 0.08);
        border-inline-start: 3px solid rgb(var(--v-theme-primary));
        border-radius: 8px;
        padding: 8px 10px;
        margin-bottom: 6px;
      }

      .quoted-block.is-clickable {
        cursor: pointer;
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
      }

      .image-bubble--left .image-thumb {
        border-start-end-radius: 6px;
      }

      .image-bubble--right .image-thumb {
        border-start-start-radius: 6px;
      }
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
</style>
