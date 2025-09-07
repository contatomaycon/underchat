<script setup lang="ts">
import { removeUserData } from '@/@webcore/localStorage/user';
import { useChatStore } from '@/@webcore/stores/chat';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

const router = useRouter();
const chatStore = useChatStore();

const logout = async () => {
  const result = removeUserData();

  if (result) {
    await nextTick(() => {
      router.replace({
        name: 'login',
      });
    });
  }
};
</script>

<template>
  <VBadge
    dot
    location="bottom right"
    offset-x="3"
    offset-y="3"
    bordered
    :color="
      resolveAvatarBadgeVariant(
        chatStore.user?.chat_user?.status as EChatUserStatus
      )
    "
  >
    <VAvatar class="cursor-pointer" color="primary" variant="tonal">
      <VImg
        v-if="chatStore.user?.info.photo"
        :src="chatStore.user?.info.photo"
      />
      <span v-else class="text-3xl">{{
        avatarText(chatStore.user?.info.name)
      }}</span>

      <!-- SECTION Menu -->
      <VMenu activator="parent" width="230" location="bottom end" offset="14px">
        <VList>
          <!-- 👉 User Avatar & Name -->
          <VListItem>
            <template #prepend>
              <VListItemAction start>
                <VBadge
                  dot
                  location="bottom right"
                  offset-x="3"
                  offset-y="3"
                  :color="
                    resolveAvatarBadgeVariant(
                      chatStore.user?.chat_user?.status as EChatUserStatus
                    )
                  "
                >
                  <VAvatar color="primary" variant="tonal">
                    <VImg
                      v-if="chatStore.user?.info.photo"
                      :src="chatStore.user?.info.photo"
                    />
                    <span v-else class="text-3xl">{{
                      avatarText(chatStore.user?.info.name)
                    }}</span>
                  </VAvatar>
                </VBadge>
              </VListItemAction>
            </template>

            <VListItemTitle class="font-weight-semibold">
              {{ chatStore.user?.info.name }}
            </VListItemTitle>
            <VListItemSubtitle>{{
              chatStore.user?.type.name
            }}</VListItemSubtitle>
          </VListItem>

          <VDivider class="my-2" />

          <!-- 👉 Profile -->
          <VListItem link>
            <template #prepend>
              <VIcon class="me-2" icon="tabler-user" size="22" />
            </template>

            <VListItemTitle>Profile</VListItemTitle>
          </VListItem>

          <!-- 👉 Settings -->
          <VListItem link>
            <template #prepend>
              <VIcon class="me-2" icon="tabler-settings" size="22" />
            </template>

            <VListItemTitle>Settings</VListItemTitle>
          </VListItem>

          <!-- 👉 Pricing -->
          <VListItem link>
            <template #prepend>
              <VIcon class="me-2" icon="tabler-currency-dollar" size="22" />
            </template>

            <VListItemTitle>Pricing</VListItemTitle>
          </VListItem>

          <!-- 👉 FAQ -->
          <VListItem link>
            <template #prepend>
              <VIcon class="me-2" icon="tabler-help" size="22" />
            </template>

            <VListItemTitle>FAQ</VListItemTitle>
          </VListItem>

          <VDivider class="my-2" />

          <VListItem @click="logout" link>
            <template #prepend>
              <VIcon class="me-2" icon="tabler-logout" size="22" />
            </template>

            <VListItemTitle>Logout</VListItemTitle>
          </VListItem>
        </VList>
      </VMenu>
    </VAvatar>
  </VBadge>
</template>
