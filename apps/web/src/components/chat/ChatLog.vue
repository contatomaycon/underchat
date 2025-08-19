<script lang="ts" setup>
import { useChatStore } from '@/@webcore/stores/chat';
import {
  LinkPreview,
  ListMessageResponse,
} from '@core/schema/chat/listMessageChats/response.schema';
import { isTypeUser } from '@core/common/functions/isTypeUser';
import { EMessageType } from '@core/common/enums/EMessageType';

const chatStore = useChatStore();

const resolveFeedbackIcon = (
  message: ListMessageResponse
): { icon: string; color: string | undefined } => {
  if (message.summary?.is_seen)
    return { icon: 'tabler-checks', color: 'success' };
  if (message.summary?.is_delivered)
    return { icon: 'tabler-checks', color: undefined };
  return { icon: 'tabler-check', color: undefined };
};

const resolvePhoto = (message: ListMessageResponse): string => {
  if (isTypeUser(message) && chatStore.activeChat?.photo)
    return chatStore.activeChat.photo;
  if (!isTypeUser(message) && message.user?.photo) return message.user.photo;
  if (!isTypeUser(message) && chatStore.user?.info.photo)
    return chatStore.user.info.photo;
  return '';
};

const isPhotoExist = (message: ListMessageResponse): boolean => {
  return !!resolvePhoto(message);
};

const avatarChat = (message: ListMessageResponse) => {
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

const resolvePreviewUrl = (lp?: LinkPreview): string => {
  return lp?.['matched-text'] ?? lp?.['canonical-url'] ?? '';
};

const onReply = (m: ListMessageResponse) => {
  chatStore.setMessageReply(m);
  window.dispatchEvent(new CustomEvent('focus-composer'));
};

const onCopy = async (m: ListMessageResponse) => {
  const text =
    m.content?.message ||
    m.content?.link_preview?.['matched-text'] ||
    m.content?.link_preview?.['canonical-url'] ||
    '';
  if (text) await navigator.clipboard.writeText(text);
};

const onReact = (m: ListMessageResponse) => {};
const onDelete = (m: ListMessageResponse) => {};

const showQuoted = (m: ListMessageResponse) =>
  m.content?.type === EMessageType.text_quoted && !!m.content?.quoted?.message;

const resolveQuotedName = (m: ListMessageResponse): string => {
  const fromMe = m.content?.quoted?.key?.from_me ?? null;

  if (fromMe === true) return chatStore.user?.info.name ?? '';
  if (fromMe === false) return chatStore.activeChat?.name ?? '';

  return '';
};

const getQuotedTargetId = (m: ListMessageResponse): string | null => {
  const byExplicitId = m.content?.message_quoted_id || null;
  if (byExplicitId) return String(byExplicitId);

  const text = m.content?.quoted?.message?.trim();
  if (!text) return null;

  const found = chatStore.listMessages.find(
    (x) => x.content?.message?.trim() === text
  );

  return found?.message_id || null;
};

const goToQuoted = (m: ListMessageResponse) => {
  const targetId = getQuotedTargetId(m);
  if (!targetId) return;

  window.dispatchEvent(
    new CustomEvent('scroll-to-message', { detail: targetId })
  );
};
</script>

<template>
  <div class="chat-log pa-6">
    <div
      v-for="(msgGrp, index) in chatStore.listMessages"
      :key="msgGrp.message_id"
      class="chat-group d-flex align-start"
      :id="`msg-${msgGrp.message_id}`"
      :data-message-id="msgGrp.message_id"
      :class="[
        {
          'flex-row-reverse': !isTypeUser(msgGrp),
          'mb-6': chatStore.listMessages.length - 1 !== index,
        },
      ]"
    >
      <div class="chat-avatar" :class="!isTypeUser(msgGrp) ? 'ms-4' : 'me-4'">
        <VAvatar
          v-if="msgGrp.user"
          size="32"
          :variant="!isPhotoExist(msgGrp) ? 'tonal' : undefined"
        >
          <VImg v-if="isPhotoExist(msgGrp)" :src="resolvePhoto(msgGrp)" />
          <span v-else class="text-1xl">{{ avatarChat(msgGrp) }}</span>
        </VAvatar>
        <VAvatar
          v-else
          size="32"
          :variant="!isPhotoExist(msgGrp) ? 'tonal' : undefined"
        >
          <VImg v-if="isPhotoExist(msgGrp)" :src="resolvePhoto(msgGrp)" />
          <span v-else class="text-1xl">{{ avatarChat(msgGrp) }}</span>
        </VAvatar>
      </div>

      <div
        class="chat-body d-inline-flex flex-column"
        :class="!isTypeUser(msgGrp) ? 'align-end' : 'align-start'"
      >
        <div
          class="chat-content py-2 px-4 elevation-2 has-actions"
          :style="{
            backgroundColor: isTypeUser(msgGrp)
              ? 'rgb(var(--v-theme-surface))'
              : 'rgb(217, 253, 211)',
          }"
          :class="[isTypeUser(msgGrp) ? 'chat-left' : 'chat-right']"
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
                  <template #prepend
                    ><VIcon size="18">tabler-corner-up-left</VIcon></template
                  >
                  <VListItemTitle>Responder</VListItemTitle>
                </VListItem>
                <VListItem @click="onCopy(msgGrp)">
                  <template #prepend
                    ><VIcon size="18">tabler-copy</VIcon></template
                  >
                  <VListItemTitle>Copiar</VListItemTitle>
                </VListItem>
                <VListItem @click="onReact(msgGrp)">
                  <template #prepend
                    ><VIcon size="18">tabler-mood-smile</VIcon></template
                  >
                  <VListItemTitle>Reagir</VListItemTitle>
                </VListItem>
                <VListItem @click="onDelete(msgGrp)">
                  <template #prepend
                    ><VIcon size="18">tabler-trash</VIcon></template
                  >
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
              <div class="quoted-name">{{ resolveQuotedName(msgGrp) }}</div>
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
              :style="{
                backgroundColor: isTypeUser(msgGrp)
                  ? 'rgb(var(--v-theme-grey-200))'
                  : 'rgb(214, 243, 207)',
                color: isTypeUser(msgGrp)
                  ? 'rgb(var(--v-theme-on-grey))'
                  : 'rgb(var(--v-theme-title))',
              }"
              :class="
                !isTypeUser(msgGrp)
                  ? 'link-preview--right'
                  : 'link-preview--left'
              "
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

            <p
              class="mb-2 mr-6 text-base message-text"
              v-if="msgGrp.content?.message"
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
        top: 4px;
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
    }
  }
}
</style>
