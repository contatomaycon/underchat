<script setup lang="ts">
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { useReleaseStore } from '@/@webcore/stores/release';
import { useAbility } from '@/plugins/0.casl/composables/useAbility';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EReleasePermissions } from '@core/common/enums/EPermissions/release';
import { EReleaseType } from '@core/common/enums/EReleaseType';
import { ListReleaseResponse } from '@core/schema/release/listRelease/response.schema';
import { formatDateToMonthShort } from '@/@webcore/utils/formatters';

const router = useRouter();
const route = useRoute();
const releaseStore = useReleaseStore();
const { t } = useI18n();
const ability = useAbility();

const canViewReleases = computed(
  () =>
    ability.can(
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access
    ) ||
    ability.can(
      EGeneralPermissions.full_access_group,
      EGeneralPermissions.full_access_group
    ) ||
    ability.can(
      EReleasePermissions.release_view,
      EReleasePermissions.release_view
    ) ||
    ability.can(
      EReleasePermissions.release_group,
      EReleasePermissions.release_group
    )
);

const loading = ref(false);
const menuOpen = ref(false);

const notifications = computed(
  () => releaseStore.releaseNotificationResults
);
const unreadCount = computed(
  () => releaseStore.releaseNotificationUnreadCount
);

const unreadNotificationsOnly = computed(() =>
  notifications.value.filter((r) => !r.viewed)
);

const fetchNotifications = async () => {
  if (!canViewReleases.value) return;
  loading.value = true;
  await releaseStore.listReleaseNotifications();
  loading.value = false;
};

const getTypeColor = (type: EReleaseType): string => {
  const colors: Record<EReleaseType, string> = {
    [EReleaseType.news]: 'success',
    [EReleaseType.informative]: 'primary',
    [EReleaseType.maintenance]: 'warning',
    [EReleaseType.update]: 'info',
    [EReleaseType.fix]: 'secondary',
    [EReleaseType.warning]: 'error',
    [EReleaseType.reminder]: 'error',
  };
  return colors[type] || 'primary';
};

const stripHtml = (html: string): string => {
  if (!html) return '';
  try {
    const div = globalThis.document.createElement('div');
    div.innerHTML = html.replace(/<[^>]*>/g, ' ');
    return (div.textContent || div.innerText || '').trim();
  } catch {
    return html.replace(/<[^>]*>/g, ' ').trim();
  }
};

const getMessagePreview = (message: string, max = 60): string => {
  const plain = stripHtml(message);
  if (!plain) return '';
  return plain.length > max ? plain.slice(0, max) + '...' : plain;
};

const onMenuUpdate = (open: boolean) => {
  menuOpen.value = open;
  if (open) fetchNotifications();
};

const openNotification = async (release: ListReleaseResponse) => {
  const target = { path: '/release', query: { open: release.release_id } };
  if (route.path === '/release') {
    await router.replace(target);
  } else {
    await router.push(target);
  }
  menuOpen.value = false;
};

const onBellClickCapture = async (event: MouseEvent) => {
  if (unreadCount.value <= 0 || loading.value) return;
  // Com mais de uma não lida: abre o menu para escolher. Só navega direto com exatamente uma.
  if (unreadCount.value > 1) return;
  const firstUnread = notifications.value.find((r) => !r.viewed);
  if (!firstUnread) return;
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  }
  await openNotification(firstUnread);
};

const viewAll = () => {
  menuOpen.value = false;
  router.push('/release');
};

onMounted(() => {
  if (canViewReleases.value) void fetchNotifications();
});

watch(
  () => route.fullPath,
  () => {
    if (canViewReleases.value) void fetchNotifications();
  }
);

watch(
  canViewReleases,
  (allowed) => {
    if (allowed) void fetchNotifications();
  }
);
</script>

<template>
  <template v-if="canViewReleases">
    <VMenu
      v-model="menuOpen"
      location="bottom end"
      width="380"
      offset="12"
      :close-on-content-click="false"
      @update:model-value="onMenuUpdate"
    >
      <template #activator="{ props: menuActivatorProps }">
        <IconBtn
          id="release-notification-btn"
          v-bind="menuActivatorProps"
          class="nav-bar-release-notifications"
          :class="{ 'release-bell-attention': unreadCount > 0 }"
          @click.capture="onBellClickCapture"
        >
          <VBadge
            :model-value="unreadCount > 0"
            color="error"
            dot
            offset-x="2"
            offset-y="3"
          >
            <VIcon icon="tabler-bell" />
          </VBadge>
        </IconBtn>
      </template>

      <VCard class="d-flex flex-column">
          <VCardItem class="notification-section">
            <VCardTitle class="text-h6">
              {{ t('notifications') }}
            </VCardTitle>
            <template #append>
              <VChip
                v-show="unreadCount > 0"
                size="small"
                color="primary"
                class="me-2"
              >
                {{ unreadCount }}
                {{ unreadCount > 1 ? t('new_plural') : t('new') }}
              </VChip>
            </template>
          </VCardItem>

          <VDivider />

          <PerfectScrollbar
            :options="{ wheelPropagation: false }"
            style="max-block-size: 23.75rem"
          >
            <VList class="notification-list rounded-0 py-0">
              <template v-if="loading">
                <VListItem
                  v-for="i in 4"
                  :key="`skeleton-${i}`"
                  class="list-item-hover-class"
                  min-height="66"
                >
                  <div class="d-flex align-start gap-3 w-100">
                    <VSkeletonLoader type="chip" width="40" height="24" />
                    <div class="flex-grow-1">
                      <VSkeletonLoader
                        type="text"
                        width="80%"
                        height="20"
                        class="mb-1"
                      />
                      <VSkeletonLoader type="text" width="60%" height="14" />
                    </div>
                  </div>
                </VListItem>
              </template>
              <template v-else>
                <template
                  v-for="(item, index) in unreadNotificationsOnly"
                  :key="item.release_id"
                >
                  <VDivider v-if="index > 0" />
                  <VListItem
                    link
                    class="list-item-hover-class"
                    min-height="66"
                    @click="openNotification(item)"
                  >
                    <div class="d-flex align-start gap-3 w-100">
                      <VIcon
                        icon="tabler-circle-filled"
                        :color="getTypeColor(item.type)"
                        size="12"
                        class="mt-1 flex-shrink-0"
                      />
                      <div class="flex-grow-1 min-w-0">
                        <p
                          class="text-sm font-weight-medium mb-1 text-truncate"
                        >
                          {{ item.title }}
                        </p>
                        <p
                          class="text-body-2 mb-0 text-medium-emphasis text-truncate"
                          style="letter-spacing: 0.4px; line-height: 18px"
                        >
                          {{ getMessagePreview(item.message) }}
                        </p>
                        <p
                          class="text-sm text-disabled mt-1 mb-0"
                          style="letter-spacing: 0.4px; line-height: 18px"
                        >
                          {{ formatDateToMonthShort(item.created_at, t) }}
                        </p>
                      </div>
                      <span
                        class="text-caption flex-shrink-0 mt-1 text-nowrap text-primary"
                      >
                        {{ t('unread') }}
                      </span>
                    </div>
                  </VListItem>
                </template>

                <VListItem
                  v-show="!unreadNotificationsOnly.length && !loading"
                  class="text-center text-medium-emphasis"
                  style="block-size: 56px"
                >
                  <VListItemTitle>{{ t('no_items_found') }}</VListItemTitle>
                </VListItem>
              </template>
            </VList>
          </PerfectScrollbar>

          <VDivider />

          <VCardText v-show="!loading" class="pa-4">
            <VBtn block size="small" @click="viewAll">
              {{ t('view_all_notifications') }}
            </VBtn>
          </VCardText>
        </VCard>
    </VMenu>
  </template>
</template>

<style lang="scss" scoped>
.notification-section {
  padding-block: 0.75rem;
  padding-inline: 1rem;
}

.notification-list.v-list :deep(.v-list-item) {
  border-radius: 0 !important;
  margin-block-end: 0 !important;
  padding-block: 0.75rem !important;
}

.list-item-hover-class {
  cursor: pointer;
}

.release-bell-attention :deep(.v-icon) {
  animation: release-bell-wiggle 2.4s ease-in-out infinite;
  transform-origin: 50% 0%;
}

@keyframes release-bell-wiggle {
  0%,
  100% {
    transform: rotate(0deg);
  }

  10% {
    transform: rotate(-14deg);
  }

  20% {
    transform: rotate(14deg);
  }

  30% {
    transform: rotate(-10deg);
  }

  40% {
    transform: rotate(10deg);
  }

  50% {
    transform: rotate(0deg);
  }
}
</style>
