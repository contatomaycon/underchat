<script lang="ts" setup>
import { getUser, setUser } from '@/@webcore/localStorage/user';
import { useChatStore } from '@/@webcore/stores/chat';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';

defineEmits<{
  (e: 'close'): void;
}>();

const chatStore = useChatStore();
const { t } = useI18n();

const user = ref<AuthUserResponse | null>(getUser());

const resolveAvatarBadgeVariant = (status: EChatUserStatus) => {
  if (status === EChatUserStatus.online) return 'success';
  if (status === EChatUserStatus.busy) return 'error';
  if (status === EChatUserStatus.away) return 'warning';
  if (status === EChatUserStatus.offline) return 'secondary';
  if (status === EChatUserStatus.do_not_disturb) return 'error';

  return 'secondary';
};

const userStatusRadioOptions = [
  { title: t('online'), value: 'online', color: 'success' },
  { title: t('busy'), value: 'busy', color: 'error' },
  { title: t('away'), value: 'away', color: 'warning' },
  { title: t('offline'), value: 'offline', color: 'secondary' },
  { title: t('do_not_disturb'), value: 'do_not_disturb', color: 'error' },
];

function updateChatUserImmediate(chatUser: AuthUserResponse['chat_user']) {
  if (!user?.value?.status) return;

  const chatUserUpdate = {
    chat_user_id: chatUser?.chat_user_id ?? '',
    status: chatUser?.status as EChatUserStatus,
    about: chatUser?.about ?? '',
    notifications: chatUser?.notifications ?? false,
  };

  setUser({ ...user.value, chat_user: chatUserUpdate });
  user.value.chat_user = chatUserUpdate as AuthUserResponse['chat_user'];
}

function updateChatUserDebounce(chatUser: AuthUserResponse['chat_user']) {
  if (!user?.value?.status) return;

  const chatUserUpdate = {
    chat_user_id: chatUser?.chat_user_id ?? '',
    status: chatUser?.status as EChatUserStatus,
    about: chatUser?.about ?? '',
    notifications: chatUser?.notifications ?? false,
  };

  chatStore.updateChatsUser({
    about: chatUserUpdate.about,
    status: chatUserUpdate.status,
    notifications: chatUserUpdate.notifications,
  });
}

const updateChatUser = useDebounceFn(updateChatUserDebounce, 500);

const about = computed<string>({
  get: () => user?.value?.chat_user?.about ?? '',
  set: (val) => {
    if (user?.value?.chat_user) {
      updateChatUserImmediate({ ...user.value.chat_user, about: val });
      updateChatUser({ ...user.value.chat_user, about: val });
    }
  },
});

const status = computed({
  get: () => user?.value?.chat_user?.status ?? EChatUserStatus.offline,
  set: (val: EChatUserStatus) => {
    if (user?.value?.chat_user) {
      updateChatUserImmediate({ ...user.value.chat_user, status: val });
      updateChatUser({ ...user.value.chat_user, status: val });
    }
  },
});

const notifications = computed<boolean>({
  get: () => user?.value?.chat_user?.notifications ?? false,
  set: (val) => {
    if (user?.value?.chat_user) {
      updateChatUserImmediate({ ...user.value.chat_user, notifications: val });
      updateChatUser({ ...user.value.chat_user, notifications: val });
    }
  },
});
</script>

<template>
  <template v-if="user?.chat_user">
    <div class="pt-2 me-2 text-end">
      <IconBtn @click="$emit('close')">
        <VIcon class="text-medium-emphasis" color="disabled" icon="tabler-x" />
      </IconBtn>
    </div>

    <div class="text-center px-6">
      <VBadge
        location="bottom right"
        offset-x="7"
        offset-y="4"
        bordered
        :color="resolveAvatarBadgeVariant(status as EChatUserStatus)"
        class="chat-user-profile-badge mb-3"
      >
        <VAvatar
          size="84"
          :variant="!user?.info.photo ? 'tonal' : undefined"
          :color="
            !user?.info.photo
              ? resolveAvatarBadgeVariant(status as EChatUserStatus)
              : undefined
          "
        >
          <VImg v-if="user?.info.photo" :src="user?.info.photo" />
          <span v-else class="text-3xl">{{ avatarText(user?.info.name) }}</span>
        </VAvatar>
      </VBadge>
      <h5 class="text-h5">
        {{ user?.info.name }}
      </h5>
      <p class="text-capitalize text-medium-emphasis mb-0">
        {{ user?.type.name }}
      </p>
    </div>

    <PerfectScrollbar
      class="ps-chat-user-profile-sidebar-content pb-5 px-6"
      :options="{ wheelPropagation: false }"
    >
      <div class="my-6 text-medium-emphasis">
        <div for="textarea-user-about" class="text-base text-disabled">
          {{ $t('about') }}
        </div>
        <AppTextarea
          id="textarea-user-about"
          v-model="about"
          auto-grow
          class="mt-1"
          rows="3"
          :rules="[maxLengthValidator(about, 200, $t('max_length_200'))]"
          counter
        />
      </div>

      <div class="mb-6">
        <div class="text-base text-disabled">{{ $t('status_chat') }}</div>
        <VRadioGroup v-model="status" class="mt-1">
          <VRadio
            v-for="(radioOption, index) in userStatusRadioOptions"
            :id="`${index}`"
            :key="radioOption.title"
            :name="radioOption.title"
            :label="radioOption.title"
            :value="radioOption.value"
            :color="radioOption.color"
          />
        </VRadioGroup>
      </div>

      <div class="text-medium-emphasis chat-settings-section">
        <div class="text-base text-disabled">{{ $t('settings') }}</div>

        <div class="d-flex align-center pa-2">
          <VIcon class="me-2 text-high-emphasis" icon="tabler-bell" size="22" />
          <div
            class="text-high-emphasis d-flex align-center justify-space-between flex-grow-1"
          >
            <div class="text-body-1 text-high-emphasis">
              {{ $t('notification') }}
            </div>
            <VSwitch
              id="chat-notification"
              v-model="notifications"
              density="compact"
            />
          </div>
        </div>
      </div>

      <VBtn color="primary" class="mt-12" block append-icon="tabler-logout">
        Logout
      </VBtn>
    </PerfectScrollbar>
  </template>
</template>

<style lang="scss">
.chat-settings-section {
  .v-switch {
    .v-input__control {
      .v-selection-control__wrapper {
        block-size: 18px;
      }
    }
  }
}
</style>
