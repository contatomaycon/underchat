<script lang="ts" setup>
import { layoutConfig } from '@layouts';
import { can } from '@layouts/plugins/casl';
import { useLayoutConfigStore } from '@layouts/stores/config';
import type { NavLink } from '@layouts/types';
import {
  getComputedNavLinkToProp,
  getDynamicI18nProps,
  isNavLinkActive,
} from '@layouts/utils';

defineProps<{
  item: NavLink;
}>();

const configStore = useLayoutConfigStore();
const hideTitleAndBadge = configStore.isVerticalNavMini();
</script>

<template>
  <ul>
    <li
      v-if="can(item.permissions)"
      class="nav-link"
      :class="{ disabled: item.disable }"
    >
      <Component
        :is="item.to ? 'RouterLink' : 'a'"
        v-bind="getComputedNavLinkToProp(item)"
        :class="{
          'router-link-active router-link-exact-active': isNavLinkActive(
            item,
            $router
          ),
        }"
      >
        <Component
          :is="layoutConfig.app.iconRenderer || 'div'"
          v-bind="
            item.icon ||
            (layoutConfig.verticalNav.defaultNavItemIconProps as Record<
              string,
              unknown
            >)
          "
          class="nav-item-icon"
        />
        <TransitionGroup name="transition-slide-x">
          <Component
            :is="layoutConfig.app.i18n.enable ? 'i18n-t' : 'span'"
            v-show="!hideTitleAndBadge"
            key="title"
            class="nav-item-title"
            v-bind="getDynamicI18nProps(item.title, 'span')"
          >
            {{ item.title }}
          </Component>

          <Component
            :is="layoutConfig.app.i18n.enable ? 'i18n-t' : 'span'"
            v-if="item.badgeContent"
            v-show="!hideTitleAndBadge"
            key="badge"
            class="nav-item-badge"
            :class="item.badgeClass"
            v-bind="getDynamicI18nProps(item.badgeContent, 'span')"
          >
            {{ item.badgeContent }}
          </Component>
        </TransitionGroup>
      </Component>
    </li>
  </ul>
</template>

<style lang="scss">
.layout-vertical-nav {
  .nav-link a {
    display: flex;
    align-items: center;
  }
}
</style>
