<script lang="ts" setup>
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { useDisplay, useTheme } from 'vuetify';
import { themes } from '@/plugins/vuetify/theme';
import ChatActiveChatUserProfileSidebarContent from '@/components/chat/ChatActiveChatUserProfileSidebarContent.vue';
import ChatLeftSidebarContent from '@/components/chat/ChatLeftSidebarContent.vue';
import ChatLog from '@/components/chat/ChatLog.vue';
import ChatUserProfileSidebarContent from '@/components/chat/ChatUserProfileSidebarContent.vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';

definePage({
  meta: {
    layoutWrapperClasses: 'layout-content-height-fixed',
    permissions: [EGeneralPermissions.full_access],
  },
});

const activeChat = ref(null);
const contact_id = ref('contact-id');

// composables
const vuetifyDisplays = useDisplay();
const { isLeftSidebarOpen } = useResponsiveLeftSidebar(
  vuetifyDisplays.smAndDown
);
// Perfect scrollbar
const chatLogPS = ref();

const scrollToBottomInChatLog = () => {
  const scrollEl = chatLogPS.value.$el || chatLogPS.value;

  scrollEl.scrollTop = scrollEl.scrollHeight;
};

// Search query
const q = ref('');

// Open Sidebar in smAndDown when "start conversation" is clicked
const startConversation = () => {
  if (vuetifyDisplays.mdAndUp.value) return;
  isLeftSidebarOpen.value = true;
};

// Chat message
const msg = ref('');
const avatar = ref(false);

const sendMessage = async () => {
  if (!msg.value) return;

  // Reset message input
  msg.value = '';

  // Scroll to bottom
  nextTick(() => {
    scrollToBottomInChatLog();
  });
};

// User profile sidebar
const isUserProfileSidebarOpen = ref(false);

// Active chat user profile sidebar
const isActiveChatUserProfileSidebarOpen = ref(false);

// file input
const refInputEl = ref<HTMLElement>();

const { name } = useTheme();

const chatContentContainerBg = computed(() => {
  let color = 'transparent';

  if (themes) color = themes?.[name.value].colors?.background as string;

  return color;
});
</script>

<template>
  <VLayout class="chat-app-layout" style="z-index: 0">
    <!-- 👉 user profile sidebar -->
    <VNavigationDrawer
      v-model="isUserProfileSidebarOpen"
      data-allow-mismatch
      temporary
      touchless
      absolute
      class="user-profile-sidebar"
      location="start"
      width="370"
    >
      <ChatUserProfileSidebarContent
        @close="isUserProfileSidebarOpen = false"
      />
    </VNavigationDrawer>

    <!-- 👉 Active Chat sidebar -->
    <VNavigationDrawer
      v-model="isActiveChatUserProfileSidebarOpen"
      data-allow-mismatch
      width="374"
      absolute
      temporary
      location="end"
      touchless
      class="active-chat-user-profile-sidebar"
    >
      <ChatActiveChatUserProfileSidebarContent
        @close="isActiveChatUserProfileSidebarOpen = false"
      />
    </VNavigationDrawer>

    <!-- 👉 Left sidebar   -->
    <VNavigationDrawer
      v-model="isLeftSidebarOpen"
      data-allow-mismatch
      absolute
      touchless
      location="start"
      width="370"
      :temporary="$vuetify.display.smAndDown"
      class="chat-list-sidebar"
      :permanent="$vuetify.display.mdAndUp"
    >
      <ChatLeftSidebarContent
        v-model:is-drawer-open="isLeftSidebarOpen"
        v-model:search="q"
        @open-chat-of-contact=""
        @show-user-profile="isUserProfileSidebarOpen = true"
        @close="isLeftSidebarOpen = false"
      />
    </VNavigationDrawer>

    <!-- 👉 Chat content -->
    <VMain class="chat-content-container">
      <!-- 👉 Right content: Active Chat -->
      <div v-if="activeChat" class="d-flex flex-column h-100">
        <!-- 👉 Active chat header -->
        <div
          class="active-chat-header d-flex align-center text-medium-emphasis bg-surface"
        >
          <!-- Sidebar toggler -->
          <IconBtn class="d-md-none me-3" @click="isLeftSidebarOpen = true">
            <VIcon icon="tabler-menu-2" />
          </IconBtn>

          <!-- avatar -->
          <div
            class="d-flex align-center cursor-pointer"
            @click="isActiveChatUserProfileSidebarOpen = true"
          >
            <VBadge
              dot
              location="bottom right"
              offset-x="3"
              offset-y="0"
              color="primary"
              bordered
            >
              <VAvatar
                size="40"
                variant="tonal"
                color="primary"
                class="cursor-pointer"
              >
                <VImg v-if="avatar" src="avatar" alt="fullName" />
                <span v-else>{{ avatarText('Full Name') }}</span>
              </VAvatar>
            </VBadge>

            <div class="flex-grow-1 ms-4 overflow-hidden">
              <div class="text-h6 mb-0 font-weight-regular">Full Name</div>
              <p class="text-truncate mb-0 text-body-2">Cargo</p>
            </div>
          </div>

          <VSpacer />

          <!-- Header right content -->
          <div class="d-sm-flex align-center d-none text-medium-emphasis">
            <IconBtn>
              <VIcon icon="tabler-phone" />
            </IconBtn>
            <IconBtn>
              <VIcon icon="tabler-video" />
            </IconBtn>
            <IconBtn>
              <VIcon icon="tabler-search" />
            </IconBtn>
            <IconBtn>
              <VIcon icon="tabler-dots-vertical" />
            </IconBtn>
          </div>
        </div>

        <VDivider />

        <!-- Chat log -->
        <PerfectScrollbar
          ref="chatLogPS"
          tag="ul"
          :options="{ wheelPropagation: false }"
          class="flex-grow-1"
        >
          <ChatLog />
        </PerfectScrollbar>

        <!-- Message form -->
        <VForm
          class="chat-log-message-form mb-5 mx-5"
          @submit.prevent="sendMessage"
        >
          <VTextField
            :key="contact_id"
            v-model="msg"
            variant="solo"
            density="default"
            class="chat-message-input"
            placeholder="Type your message..."
            autofocus
          >
            <template #append-inner>
              <div class="d-flex gap-1">
                <IconBtn>
                  <VIcon icon="tabler-microphone" size="22" />
                </IconBtn>
                <IconBtn @click="refInputEl?.click()">
                  <VIcon icon="tabler-paperclip" size="22" />
                </IconBtn>
                <div class="d-none d-md-block">
                  <VBtn append-icon="tabler-send" @click="sendMessage">
                    Send
                  </VBtn>
                </div>
                <IconBtn class="d-block d-md-none" @click="sendMessage">
                  <VIcon icon="tabler-send" />
                </IconBtn>
              </div>
            </template>
          </VTextField>

          <input
            ref="refInputEl"
            type="file"
            name="file"
            accept=".jpeg,.png,.jpg,GIF"
            hidden
          />
        </VForm>
      </div>

      <!-- 👉 Start conversation -->
      <div v-else class="d-flex h-100 align-center justify-center flex-column">
        <VAvatar size="98" variant="tonal" color="primary" class="mb-4">
          <VIcon size="50" class="rounded-0" icon="tabler-message-2" />
        </VAvatar>
        <VBtn
          v-if="$vuetify.display.smAndDown"
          rounded="pill"
          @click="startConversation"
        >
          Start Conversation
        </VBtn>

        <p
          v-else
          style="max-inline-size: 40ch; text-wrap: balance"
          class="text-center text-disabled"
        >
          {{ $t('select_a_contact') }}
        </p>
      </div>
    </VMain>
  </VLayout>
</template>

<style lang="scss">
@use '@styles/variables/vuetify';
@use '@webcore/scss/base/mixins';
@use '@layouts/styles/mixins' as layoutsMixins;

// Variables
$chat-app-header-height: 76px;

// Placeholders
%chat-header {
  display: flex;
  align-items: center;
  min-block-size: $chat-app-header-height;
  padding-inline: 1.5rem;
}

.chat-start-conversation-btn {
  cursor: default;
}

.chat-app-layout {
  border-radius: vuetify.$card-border-radius;

  @include mixins.elevation(vuetify.$card-elevation);

  $sel-chat-app-layout: &;

  @at-root {
    .skin--bordered {
      @include mixins.bordered-skin($sel-chat-app-layout);
    }
  }

  .active-chat-user-profile-sidebar,
  .user-profile-sidebar {
    .v-navigation-drawer__content {
      display: flex;
      flex-direction: column;
    }
  }

  .chat-list-header,
  .active-chat-header {
    @extend %chat-header;
  }

  .chat-list-sidebar {
    .v-navigation-drawer__content {
      display: flex;
      flex-direction: column;
    }
  }
}

.chat-content-container {
  /* stylelint-disable-next-line value-keyword-case */
  background-color: v-bind(chatContentContainerBg);

  // Adjust the padding so text field height stays 48px
  .chat-message-input {
    .v-field__input {
      font-size: 0.9375rem !important;
      line-height: 1.375rem !important;
      padding-block: 0.6rem 0.5rem;
    }

    .v-field__append-inner {
      align-items: center;
      padding-block-start: 0;
    }

    .v-field--appended {
      padding-inline-end: 8px;
    }
  }
}

.chat-user-profile-badge {
  .v-badge__badge {
    /* stylelint-disable liberty/use-logical-spec */
    min-width: 12px !important;
    height: 0.75rem;
    /* stylelint-enable liberty/use-logical-spec */
  }
}
</style>
