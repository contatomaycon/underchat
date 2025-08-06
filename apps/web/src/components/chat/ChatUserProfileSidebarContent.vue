<script lang="ts" setup>
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';

defineEmits<{
  (e: 'close'): void;
}>();

// composables
const userStatusRadioOptions = [
  { title: 'Online', value: 'online', color: 'success' },
  { title: 'Away', value: 'away', color: 'warning' },
  { title: 'Do not disturb', value: 'busy', color: 'error' },
  { title: 'Offline', value: 'offline', color: 'secondary' },
];

const isAuthenticationEnabled = ref(true);
const isNotificationEnabled = ref(false);
const avatar = ref(false);
const status = ref(userStatusRadioOptions[0].value);
</script>

<template>
  <template>
    <!-- Close Button -->
    <div class="pt-2 me-2 text-end">
      <IconBtn @click="$emit('close')">
        <VIcon class="text-medium-emphasis" color="disabled" icon="tabler-x" />
      </IconBtn>
    </div>

    <!-- User Avatar + Name + Role -->
    <div class="text-center px-6">
      <VBadge
        location="bottom right"
        offset-x="7"
        offset-y="4"
        bordered
        color="primary"
        class="chat-user-profile-badge mb-3"
      >
        <VAvatar size="84" variant="tonal" color="primary">
          <VImg v-if="avatar" />
          <span v-else class="text-3xl">{{ avatarText('Full Name') }}</span>
        </VAvatar>
      </VBadge>
      <h5 class="text-h5">'Full Name'</h5>
      <p class="text-capitalize text-medium-emphasis mb-0">Cargo</p>
    </div>

    <!-- User Data -->
    <PerfectScrollbar
      class="ps-chat-user-profile-sidebar-content pb-5 px-6"
      :options="{ wheelPropagation: false }"
    >
      <!-- About -->
      <div class="my-6 text-medium-emphasis">
        <div for="textarea-user-about" class="text-base text-disabled">
          ABOUT
        </div>
        <AppTextarea id="textarea-user-about" auto-grow class="mt-1" rows="3" />
      </div>

      <!-- Status -->
      <div class="mb-6">
        <div class="text-base text-disabled">STATUS</div>
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

      <!-- Settings -->
      <div class="text-medium-emphasis chat-settings-section">
        <div class="text-base text-disabled">SETTINGS</div>

        <div class="d-flex align-center pa-2">
          <VIcon class="me-2 text-high-emphasis" icon="tabler-lock" size="22" />
          <div
            class="text-high-emphasis d-flex align-center justify-space-between flex-grow-1"
          >
            <div class="text-body-1 text-high-emphasis">
              Two-step Verification
            </div>
            <VSwitch
              id="two-step-verification"
              v-model="isAuthenticationEnabled"
              density="compact"
            />
          </div>
        </div>
        <div class="d-flex align-center pa-2">
          <VIcon class="me-2 text-high-emphasis" icon="tabler-bell" size="22" />
          <div
            class="text-high-emphasis d-flex align-center justify-space-between flex-grow-1"
          >
            <div class="text-body-1 text-high-emphasis">Notification</div>
            <VSwitch
              id="chat-notification"
              v-model="isNotificationEnabled"
              density="compact"
            />
          </div>
        </div>
        <div class="d-flex align-center pa-2">
          <VIcon
            class="me-2 text-high-emphasis"
            icon="tabler-user-plus"
            size="22"
          />
          <div class="text-body-1 text-high-emphasis">Invite Friends</div>
        </div>
        <div class="d-flex align-center pa-2">
          <VIcon
            class="me-2 text-high-emphasis"
            icon="tabler-trash"
            size="22"
          />
          <div class="text-body-1 text-high-emphasis">Delete Account</div>
        </div>
      </div>

      <!-- Logout Button -->
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
