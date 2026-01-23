<script setup lang="ts">
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { ref, computed, watch } from 'vue';
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
const { t } = useI18n();
const releaseStore = useReleaseStore();

const isComposeDialogVisible = ref(false);
const searchQuery = ref('');
const debouncedSearch = refDebounced(searchQuery, 500);
const selectedType = ref<EReleaseType | null>(null);
const openedRelease = ref<ViewReleaseResponse | null>(null);
const releases = ref<ListReleaseResponse[]>([]);
const loading = computed(() => releaseStore.loading);
const pagination = computed(() => releaseStore.pagings);

const getTypeColor = (type: EReleaseType): string => {
  const colors: Record<EReleaseType, string> = {
    [EReleaseType.news]: 'success',
    [EReleaseType.informative]: 'primary',
    [EReleaseType.maintenance]: 'warning',
    [EReleaseType.update]: 'info',
    [EReleaseType.fix]: 'secondary',
    [EReleaseType.warning]: 'error',
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
  };
  return labels[type] || type;
};

const getRenderableHtml = (html: string): string => {
  if (!html) return '';

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1]) {
    return bodyMatch[1].trim();
  }

  if (html.includes('<!DOCTYPE') || html.includes('<html')) {
    let cleaned = html
      .replace(/<!DOCTYPE[^>]*>/gi, '')
      .replace(/<html[^>]*>/gi, '')
      .replace(/<\/html>/gi, '')
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
      .replace(/<body[^>]*>/gi, '')
      .replace(/<\/body>/gi, '')
      .trim();

    if (cleaned) {
      return cleaned;
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const body = doc.querySelector('body');
      if (body && body.innerHTML.trim()) {
        return body.innerHTML.trim();
      }
    } catch (error) {}
  }

  return html;
};

const extractHtmlContent = (html: string): string => {
  if (!html) return '';

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1]) {
    return bodyMatch[1].trim();
  }

  if (html.includes('<!DOCTYPE') || html.includes('<html')) {
    let cleaned = html
      .replace(/<!DOCTYPE[^>]*>/gi, '')
      .replace(/<html[^>]*>/gi, '')
      .replace(/<\/html>/gi, '')
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
      .replace(/<body[^>]*>/gi, '')
      .replace(/<\/body>/gi, '')
      .trim();

    if (cleaned) {
      return cleaned;
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const body = doc.querySelector('body');
      if (body && body.innerHTML.trim()) {
        return body.innerHTML.trim();
      }
    } catch (error) {}
  }

  return html;
};

const stripHtml = (html: string): string => {
  if (!html) return '';

  try {
    const content = extractHtmlContent(html);
    const div = globalThis.document.createElement('div');
    div.innerHTML = content;
    const text = div.textContent || div.innerText || '';

    return text.trim();
  } catch (error) {
    const content = extractHtmlContent(html);
    return content.replace(/<[^>]*>/g, '').trim();
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

const fetchReleases = async () => {
  const query: ListReleaseRequest = {
    current_page: pagination.value.current_page,
    per_page: pagination.value.per_page,
  };

  if (debouncedSearch.value) {
    query.search = debouncedSearch.value;
  }

  if (selectedType.value) {
    query.type = selectedType.value;
  }

  const response = await releaseStore.listReleases(query);

  if (response) {
    releases.value = response.results;
  }
};

const openRelease = async (release: ListReleaseResponse) => {
  const response = await releaseStore.viewRelease(release.release_id);

  if (response) {
    openedRelease.value = response;
    await fetchReleases();
  }
};

const closeRelease = () => {
  openedRelease.value = null;
};

const selectType = (type: EReleaseType | null) => {
  selectedType.value = type;
  releaseStore.pagings.current_page = 1;
  fetchReleases();
};

watch(debouncedSearch, () => {
  releaseStore.pagings.current_page = 1;
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

fetchReleases();
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
      :model-value="!!openedRelease"
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
          </div>
        </div>

        <VDivider />

        <PerfectScrollbar
          tag="div"
          class="release-content-container flex-grow-1 pa-sm-12 pa-6"
          :options="{ wheelPropagation: false }"
        >
          <VCard class="mb-4">
            <VCardText>
              <div
                v-if="openedRelease.message"
                v-html="openedRelease.message"
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
          <IconBtn @click="fetchReleases">
            <VIcon icon="tabler-refresh" size="22" />
          </IconBtn>
        </div>

        <VDivider />

        <PerfectScrollbar
          tag="ul"
          :options="{ wheelPropagation: false }"
          class="release-list"
        >
          <li
            v-for="release in releases"
            v-show="releases?.length"
            :key="release.release_id"
            class="release-item d-flex align-center pa-4 gap-2 cursor-pointer"
            @click="openRelease(release)"
          >
            <VChip
              :color="release.viewed ? 'success' : 'error'"
              size="x-small"
              variant="flat"
              class="flex-shrink-0"
            >
              {{ release.viewed ? t('read') : t('unread') }}
            </VChip>

            <div class="flex-grow-1">
              <h6
                class="text-h6"
                :class="{ 'font-weight-bold': !release.viewed }"
              >
                {{ release.title }}
              </h6>
              <span class="text-body-2 text-truncate d-block">
                {{ getMessagePreview(release.message) }}
              </span>
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

          <li
            v-show="!releases.length && !loading"
            class="py-4 px-5 text-center"
          >
            <span class="text-high-emphasis">{{ $t('no_items_found') }}</span>
          </li>

          <li v-show="loading" class="py-4 px-5 text-center">
            <VProgressCircular indeterminate color="primary" />
          </li>
        </PerfectScrollbar>
      </VCard>

      <ReleaseComposeDialog
        v-model="isComposeDialogVisible"
        @created="fetchReleases"
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

  @media only screen and (min-width: 1280px) {
    inline-size: calc(100% - 256px) !important;
  }

  .v-navigation-drawer__content {
    display: flex;
    flex-direction: column;
  }
}

.release-content-container {
  background-color: rgb(var(--v-theme-on-surface), var(--v-hover-opacity));
}

.release-message-content {
  max-width: 100%;
  overflow-x: auto;
}

.release-message-content :deep(img) {
  max-width: 100%;
  height: auto;
}

.release-message-content :deep(table) {
  max-width: 100%;
  overflow-x: auto;
}

.release-message-content :deep(*) {
  max-width: 100%;
}
</style>

<route lang="json">
{
  "name": "release",
  "meta": { "public": true }
}
</route>
