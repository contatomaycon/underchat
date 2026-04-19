<script setup lang="ts">
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { ref, computed, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EReleasePermissions } from '@core/common/enums/EPermissions/release';
import { EReleaseType } from '@core/common/enums/EReleaseType';
import { useReleaseStore } from '@/@webcore/stores/release';
import { ListReleaseResponse } from '@core/schema/release/listRelease/response.schema';
import { ViewReleaseResponse } from '@core/schema/release/viewRelease/response.schema';
import ReleaseLeftSidebarContent from '@/components/release/ReleaseLeftSidebarContent.vue';
import ReleaseComposeDialog from '@/components/release/ReleaseComposeDialog.vue';
import { useResponsiveLeftSidebar } from '@/@webcore/composable/useResponsiveSidebar';
import { formatDateToMonthShort } from '@/@webcore/utils/formatters';
import { ListReleaseRequest } from '@core/schema/release/listRelease/request.schema';
import { getUser } from '@/@webcore/localStorage/user';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EReleasePermissions.release_group,
      EReleasePermissions.release_view,
    ],
    layoutWrapperClasses: 'layout-content-height-fixed',
  },
});

const { isLeftSidebarOpen } = useResponsiveLeftSidebar();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const releaseStore = useReleaseStore();

const isComposeDialogVisible = ref(false);
const editRelease = ref<ViewReleaseResponse | null>(null);
const isDialogDeleterShow = ref(false);
const releaseIdToDelete = ref<string | null>(null);
const searchQuery = ref('');
const debouncedSearch = refDebounced(searchQuery, 500);
const selectedType = ref<EReleaseType | null>(null);
const openedRelease = ref<ViewReleaseResponse | null>(null);
const isOpeningFromRoute = ref(false);
const releases = computed(() => releaseStore.list);
const loading = computed(() => releaseStore.loading);
const loadingMore = computed(() => releaseStore.loadingMore);
const refreshing = computed(() => releaseStore.refreshing);
const pagination = computed(() => releaseStore.pagings);
const scrollContainer = ref<InstanceType<typeof PerfectScrollbar> | null>(null);

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

const getTypeLabel = (type: EReleaseType): string => {
  const labels: Record<EReleaseType, string> = {
    [EReleaseType.news]: t('release_type_news'),
    [EReleaseType.informative]: t('release_type_informative'),
    [EReleaseType.maintenance]: t('release_type_maintenance'),
    [EReleaseType.update]: t('release_type_update'),
    [EReleaseType.fix]: t('release_type_fix'),
    [EReleaseType.warning]: t('release_type_warning'),
    [EReleaseType.reminder]: t('release_type_reminder'),
  };
  return labels[type] || type;
};

const formatReminderDateTime = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));

const scopeCssToContainer = (css: string, scopeClass: string): string => {
  if (!css) return '';

  let scopedCss = css.replace(/\/\*[\s\S]*?\*\//g, '');

  const rules: string[] = [];
  let buffer = '';
  let depth = 0;

  for (let i = 0; i < scopedCss.length; i++) {
    const char = scopedCss[i];
    buffer += char;

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        rules.push(buffer.trim());
        buffer = '';
      }
    }
  }

  return rules
    .map((rule) => {
      if (
        rule.startsWith('@keyframes') ||
        rule.startsWith('@font-face') ||
        rule.startsWith('@import')
      ) {
        return rule;
      }

      if (rule.startsWith('@media')) {
        const mediaMatch = rule.match(/@media[^{]+\{([\s\S]*)\}$/);
        if (mediaMatch) {
          const mediaQuery = rule.substring(0, rule.indexOf('{') + 1);
          const innerCss = scopeCssToContainer(mediaMatch[1], scopeClass);
          return `${mediaQuery}${innerCss}}`;
        }
        return rule;
      }

      const braceIndex = rule.indexOf('{');
      if (braceIndex === -1) return rule;

      const selectors = rule.substring(0, braceIndex).trim();
      const declarations = rule.substring(braceIndex);

      const scopedSelectors = selectors
        .split(',')
        .map((selector) => {
          selector = selector.trim();
          if (selector === 'body' || selector === 'html' || selector === '*') {
            return `.${scopeClass}`;
          }

          return `.${scopeClass} ${selector}`;
        })
        .join(', ');

      return `${scopedSelectors} ${declarations}`;
    })
    .join('\n');
};

const sanitizeHtmlContent = (html: string): string => {
  if (!html) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const styles: string[] = [];
  doc.querySelectorAll('style').forEach((style) => {
    if (style.textContent) {
      styles.push(style.textContent);
    }
  });

  const headStyles = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  if (headStyles) {
    headStyles.forEach((styleTag) => {
      const content = styleTag
        .replace(/<style[^>]*>/gi, '')
        .replace(/<\/style>/gi, '');
      if (content && !styles.includes(content)) {
        styles.push(content);
      }
    });
  }

  let content = doc.body?.innerHTML || html;

  content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<link[^>]*>/gi, '');

  if (styles.length > 0) {
    const scopedCss = styles
      .map((css) => scopeCssToContainer(css, 'release-message-content'))
      .join('\n');

    const baseStyles = `
      .release-message-content { max-width: 100% !important; overflow: hidden !important; }
      .release-message-content img { max-width: 100% !important; height: auto !important; display: block; }
      .release-message-content table { max-width: 100% !important; width: 100% !important; table-layout: fixed !important; }
      .release-message-content * { max-width: 100% !important; box-sizing: border-box !important; }
      .release-message-content .img-placeholder { max-width: 100% !important; }
      .release-message-content .img-placeholder img { width: 100% !important; }
    `;

    content = `<style>${scopedCss}\n${baseStyles}</style>${content}`;
  }

  return content;
};

const stripHtml = (html: string): string => {
  if (!html) return '';

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    doc.querySelectorAll('style, script').forEach((el) => el.remove());

    const text = doc.body?.textContent || '';
    return text.replace(/\s+/g, ' ').trim();
  } catch (error) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
};

const getMessagePreview = (message: string): string => {
  if (!message) return '';

  const plainText = stripHtml(message);

  if (plainText.length > 100) {
    return plainText.substring(0, 100) + '...';
  }

  return plainText;
};

const fetchReleases = async (append: boolean = false) => {
  const query: ListReleaseRequest = {
    current_page: append
      ? pagination.value.current_page + 1
      : pagination.value.current_page,
    per_page: pagination.value.per_page,
  };

  if (debouncedSearch.value) {
    query.search = debouncedSearch.value;
  }

  if (selectedType.value) {
    query.type = selectedType.value;
  }

  await releaseStore.listReleases(query, append);
};

const handleRefresh = async () => {
  releaseStore.pagings.current_page = 1;
  releaseStore.list = [];

  const query: ListReleaseRequest = {
    current_page: 1,
    per_page: pagination.value.per_page,
  };

  if (debouncedSearch.value) {
    query.search = debouncedSearch.value;
  }

  if (selectedType.value) {
    query.type = selectedType.value;
  }

  await releaseStore.refreshReleases(query);
  await releaseStore.listReleaseNotifications();
};

const handleScroll = async (e: Event) => {
  const target = e.target as HTMLElement;
  if (!target) return;

  const scrollElement =
    target.closest('.ps__container') || target.closest('.ps') || target;

  if (!scrollElement) return;

  const scrollTop = (scrollElement as HTMLElement).scrollTop || 0;
  const scrollHeight = (scrollElement as HTMLElement).scrollHeight || 0;
  const clientHeight = (scrollElement as HTMLElement).clientHeight || 0;

  const threshold = 200;
  const isNearBottom = scrollTop + clientHeight >= scrollHeight - threshold;

  if (
    isNearBottom &&
    !loadingMore.value &&
    !loading.value &&
    pagination.value.current_page < pagination.value.total_pages
  ) {
    await fetchReleases(true);
  }
};

const openRelease = async (release: ListReleaseResponse) => {
  const response = await releaseStore.viewRelease(release.release_id);

  if (response) {
    openedRelease.value = response;
    await handleRefresh();
  }
};

const closeRelease = () => {
  if (route.query.open) {
    router.replace({ path: '/release' });
  }
  openedRelease.value = null;
  editRelease.value = null;
};

const isCreatorFor = (r: { created_by_user_id?: string | null } | null): boolean => {
  const user = getUser();
  if (!user?.user_id || !r?.created_by_user_id) return false;
  return r.created_by_user_id === user.user_id;
};

const isCreator = computed(() => isCreatorFor(openedRelease.value));

const openEditDialog = async (
  r?: ListReleaseResponse | ViewReleaseResponse | null
) => {
  const source = r ?? openedRelease.value;
  if (!source) return;
  editRelease.value = {
    release_id: source.release_id,
    type: source.type,
    title: source.title,
    message: source.message,
    ...('reminder_at' in source
      ? { reminder_at: source.reminder_at ?? null }
      : {}),
  } as ViewReleaseResponse;
  await nextTick();
  isComposeDialogVisible.value = true;
};

const openDeleteDialog = (r?: ListReleaseResponse) => {
  const id = r?.release_id ?? openedRelease.value?.release_id;
  if (!id) return;
  releaseIdToDelete.value = id;
  isDialogDeleterShow.value = true;
};

const handleDeleteRelease = async () => {
  const id = releaseIdToDelete.value;
  if (!id) return;
  const ok = await releaseStore.deleteRelease(id);
  if (ok) {
    if (openedRelease.value?.release_id === id) closeRelease();
    await handleRefresh();
  }
  releaseIdToDelete.value = null;
};

const onReleaseUpdated = async () => {
  editRelease.value = null;
  await handleRefresh();
  if (openedRelease.value) {
    const updated = await releaseStore.viewRelease(
      openedRelease.value.release_id
    );
    if (updated) openedRelease.value = updated;
  }
};

const handleDrawerUpdate = (value: boolean) => {
  if (!value && !isOpeningFromRoute.value) {
    closeRelease();
  }
};

const selectType = (type: EReleaseType | null) => {
  closeRelease();
  selectedType.value = type;
  releaseStore.pagings.current_page = 1;
  releaseStore.list = [];
  fetchReleases();
};

watch(debouncedSearch, () => {
  releaseStore.pagings.current_page = 1;
  releaseStore.list = [];
  fetchReleases();
});

watch(
  () => route.query,
  () => {
    if (route.query.type) {
      selectedType.value = route.query.type as EReleaseType;
    }
  },
  { immediate: true }
);

watch(
  () => route.query.open,
  async (openId) => {
    if (route.path !== '/release') return;
    const id =
      typeof openId === 'string'
        ? openId
        : Array.isArray(openId)
          ? openId[0]
          : null;
    if (!id) {
      openedRelease.value = null;
      return;
    }
    isOpeningFromRoute.value = true;
    try {
      const data = await releaseStore.viewRelease(id);
      if (data) {
        openedRelease.value = data;
        await nextTick();
      }
    } finally {
      isOpeningFromRoute.value = false;
    }
  },
  { immediate: true }
);

fetchReleases();
void releaseStore.listReleaseNotifications();
</script>

<template>
  <VLayout style="z-index: 0; min-block-size: 100%" class="release-app-layout">
    <VNavigationDrawer
      v-model="isLeftSidebarOpen"
      data-allow-mismatch
      absolute
      touchless
      location="start"
      :temporary="$vuetify.display.mdAndDown"
    >
      <ReleaseLeftSidebarContent
        :selected-type="selectedType"
        @toggle-compose-dialog-visibility="
          isComposeDialogVisible = !isComposeDialogVisible
        "
        @select-type="selectType"
      />
    </VNavigationDrawer>

    <VNavigationDrawer
      data-allow-mismatch
      temporary
      :model-value="!!openedRelease || isOpeningFromRoute"
      @update:model-value="handleDrawerUpdate"
      location="right"
      :scrim="false"
      floating
      class="release-view"
    >
      <template v-if="openedRelease">
        <div class="release-view-header d-flex align-center px-5 py-3">
          <IconBtn class="me-2" @click="closeRelease">
            <VIcon size="22" icon="tabler-chevron-left" class="flip-in-rtl" />
          </IconBtn>

          <div
            class="d-flex align-center flex-wrap flex-grow-1 overflow-hidden gap-2"
          >
            <div class="text-body-1 text-high-emphasis text-truncate">
              {{ openedRelease.title }}
            </div>

            <VChip
              :color="getTypeColor(openedRelease.type)"
              class="text-capitalize flex-shrink-0"
              size="small"
              :label="false"
            >
              {{ getTypeLabel(openedRelease.type) }}
            </VChip>

            <span
              v-if="
                openedRelease.type === EReleaseType.reminder &&
                openedRelease.reminder_at
              "
              class="text-caption text-error text-no-wrap flex-shrink-0"
            >
              {{ formatReminderDateTime(openedRelease.reminder_at) }}
            </span>

            <VSpacer />

            <template v-if="isCreator">
              <IconBtn @click="openEditDialog(openedRelease)">
                <VIcon size="20" icon="tabler-edit" />
              </IconBtn>
              <IconBtn @click="openDeleteDialog">
                <VIcon size="20" icon="tabler-trash" />
              </IconBtn>
            </template>
          </div>
        </div>

        <VDivider />

        <PerfectScrollbar
          tag="div"
          class="release-content-container flex-grow-1 pa-sm-12 pa-6"
          :options="{ wheelPropagation: false }"
        >
          <template v-if="loading && !openedRelease">
            <VCard class="mb-4">
              <VCardText>
                <VSkeletonLoader
                  type="text"
                  width="100%"
                  height="24"
                  class="mb-2"
                />
                <VSkeletonLoader
                  type="text"
                  width="90%"
                  height="16"
                  class="mb-2"
                />
                <VSkeletonLoader
                  type="text"
                  width="95%"
                  height="16"
                  class="mb-2"
                />
                <VSkeletonLoader type="text" width="85%" height="16" />
              </VCardText>
            </VCard>
          </template>
          <VCard v-else class="mb-4">
            <VCardText>
              <div
                v-if="openedRelease?.message"
                v-html="sanitizeHtmlContent(openedRelease.message)"
                class="release-message-content"
              ></div>
              <div v-else class="text-body-1">-</div>
            </VCardText>
          </VCard>
        </PerfectScrollbar>
      </template>
    </VNavigationDrawer>

    <VMain>
      <VCard flat class="release-content-list h-100 d-flex flex-column">
        <div class="d-flex align-center">
          <IconBtn class="d-lg-none ms-3" @click="isLeftSidebarOpen = true">
            <VIcon icon="tabler-menu-2" />
          </IconBtn>

          <VTextField
            v-model="searchQuery"
            density="default"
            class="release-search px-sm-2 flex-grow-1 py-1"
            :placeholder="$t('search_releases')"
          >
            <template #prepend-inner>
              <VIcon
                icon="tabler-search"
                size="24"
                class="me-1 text-medium-emphasis"
              />
            </template>
          </VTextField>
        </div>

        <VDivider />

        <div class="py-2 px-4 d-flex align-center gap-x-1">
          <VSpacer />
          <IconBtn @click="handleRefresh" :disabled="refreshing">
            <VIcon
              icon="tabler-refresh"
              size="22"
              :class="{ rotating: refreshing }"
            />
          </IconBtn>
        </div>

        <VDivider />

        <PerfectScrollbar
          ref="scrollContainer"
          tag="ul"
          :options="{ wheelPropagation: false }"
          class="release-list"
          @ps-scroll-y="handleScroll"
        >
          <template v-if="loading && !refreshing && releases.length === 0">
            <li
              v-for="i in 10"
              :key="`skeleton-initial-${i}`"
              class="release-item d-flex align-center pa-4 gap-2"
            >
              <VSkeletonLoader
                type="chip"
                width="60"
                height="24"
                class="flex-shrink-0"
              />
              <div class="flex-grow-1">
                <VSkeletonLoader
                  type="text"
                  width="70%"
                  height="24"
                  class="mb-2"
                />
                <VSkeletonLoader type="text" width="90%" height="16" />
              </div>
              <div
                class="release-meta align-center gap-2"
                :class="$vuetify.display.xs ? 'd-none' : ''"
              >
                <VSkeletonLoader type="text" width="80" height="16" />
              </div>
            </li>
          </template>

          <template v-else>
            <li
              v-for="release in releases"
              :key="release.release_id"
              class="release-item d-flex align-center pa-4 gap-2 cursor-pointer"
              @click="openRelease(release)"
            >
              <VChip
                v-if="!release.viewed"
                color="error"
                size="x-small"
                variant="flat"
                class="flex-shrink-0"
              >
                {{ t('unread') }}
              </VChip>

              <div class="flex-grow-1">
                <h6
                  class="text-h6"
                  :class="{ 'font-weight-bold': !release.viewed }"
                >
                  {{ release.title }}
                </h6>
                <p
                  v-if="
                    release.type === EReleaseType.reminder && release.reminder_at
                  "
                  class="text-caption text-error mb-1"
                >
                  {{ t('release_reminder_datetime') }}:
                  {{ formatReminderDateTime(release.reminder_at) }}
                </p>
                <span class="text-body-2 text-truncate d-block">
                  {{ getMessagePreview(release.message) }}
                </span>
              </div>

              <div
                v-if="isCreatorFor(release)"
                class="d-flex align-center gap-1 flex-shrink-0"
                @click.stop
              >
                <IconBtn @click="openEditDialog(release)">
                  <VIcon size="18" icon="tabler-edit" />
                </IconBtn>
                <IconBtn @click="openDeleteDialog(release)">
                  <VIcon size="18" icon="tabler-trash" />
                </IconBtn>
              </div>

              <div
                class="release-meta align-center gap-2"
                :class="$vuetify.display.xs ? 'd-none' : ''"
              >
                <VIcon
                  icon="tabler-circle-filled"
                  size="10"
                  :color="getTypeColor(release.type)"
                />

                <span class="text-sm text-disabled">
                  {{ formatDateToMonthShort(release.created_at, t) }}
                </span>
              </div>
            </li>

            <template v-if="loadingMore">
              <li
                v-for="i in 5"
                :key="`skeleton-load-more-${i}`"
                class="release-item d-flex align-center pa-4 gap-2"
              >
                <VSkeletonLoader
                  type="chip"
                  width="60"
                  height="24"
                  class="flex-shrink-0"
                />
                <div class="flex-grow-1">
                  <VSkeletonLoader
                    type="text"
                    width="70%"
                    height="24"
                    class="mb-2"
                  />
                  <VSkeletonLoader type="text" width="90%" height="16" />
                </div>
                <div
                  class="release-meta align-center gap-2"
                  :class="$vuetify.display.xs ? 'd-none' : ''"
                >
                  <VSkeletonLoader type="text" width="80" height="16" />
                </div>
              </li>
            </template>

            <li
              v-show="!releases.length && !loading && !refreshing"
              class="py-4 px-5 text-center"
            >
              <span class="text-high-emphasis">{{ $t('no_items_found') }}</span>
            </li>
          </template>
        </PerfectScrollbar>
      </VCard>

      <ReleaseComposeDialog
        v-model="isComposeDialogVisible"
        :release="editRelease"
        @created="handleRefresh"
        @updated="onReleaseUpdated"
      />

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete')"
        :message="$t('release_confirm_delete')"
        @confirm="handleDeleteRelease"
      />
    </VMain>
  </VLayout>
</template>

<style lang="scss">
@use '@styles/variables/vuetify';
@use '@webcore/scss/base/mixins';

.release-search {
  .v-field__outline {
    display: none;
  }

  .v-field__field {
    .v-field__input {
      font-size: 0.9375rem !important;
      line-height: 1.375rem !important;
    }
  }
}

.release-app-layout {
  border-radius: vuetify.$card-border-radius;

  @include mixins.elevation(vuetify.$card-elevation);

  $sel-release-app-layout: &;

  @at-root {
    .skin--bordered {
      @include mixins.bordered-skin($sel-release-app-layout);
    }
  }
}

.release-content-list {
  border-end-start-radius: 0;
  border-start-start-radius: 0;
}

.release-list {
  white-space: nowrap;

  .release-item {
    block-size: auto;
    min-block-size: 4.375rem;
    transition: all 0.2s ease-in-out;
    will-change: transform, box-shadow;

    & + .release-item {
      border-block-start: 1px solid
        rgba(var(--v-border-color), var(--v-border-opacity));
    }

    &:hover {
      transform: translateY(-2px);
      @include mixins.elevation(4);
    }
  }

  .release-item .release-meta {
    display: flex;
  }
}

.release-view {
  &:not(.v-navigation-drawer--active) {
    transform: translateX(110%) !important;
  }

  inline-size: 100% !important;
  overflow: hidden !important;

  @media only screen and (min-width: 1280px) {
    inline-size: calc(100% - 256px) !important;
  }

  .v-navigation-drawer__content {
    display: flex;
    flex-direction: column;
    overflow: hidden !important;
    max-width: 100%;
  }
}

.release-content-container {
  background-color: rgb(var(--v-theme-on-surface), var(--v-hover-opacity));
  max-width: 100%;
  width: 100%;

  &.ps {
    overflow: hidden !important;
  }

  .ps__rail-x {
    display: none !important;
  }

  .v-card {
    max-width: 100% !important;
    width: 100%;
    overflow: hidden;
  }

  .v-card-text {
    max-width: 100% !important;
    width: 100%;
    overflow: hidden;
    padding: 1rem;
  }
}

.release-message-content {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: break-word;
}

.release-list {
  .ps__rail-y {
    opacity: 0.6;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 1;
    }

    .ps__thumb-y {
      background-color: rgba(var(--v-theme-on-surface), 0.3);
      border-radius: 6px;
      width: 6px;
      transition: background-color 0.2s ease;

      &:hover {
        background-color: rgba(var(--v-theme-on-surface), 0.5);
        width: 8px;
      }
    }
  }

  .ps__rail-x {
    opacity: 0.6;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 1;
    }

    .ps__thumb-x {
      background-color: rgba(var(--v-theme-on-surface), 0.3);
      border-radius: 6px;
      height: 6px;
      transition: background-color 0.2s ease;

      &:hover {
        background-color: rgba(var(--v-theme-on-surface), 0.5);
        height: 8px;
      }
    }
  }
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.rotating {
  animation: rotate 1s linear infinite;
}
</style>

<route lang="json">
{
  "name": "release",
  "meta": { "public": true }
}
</route>
