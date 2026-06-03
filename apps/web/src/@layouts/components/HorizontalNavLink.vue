<script lang="ts" setup>
import { layoutConfig } from '@layouts';
import { can } from '@layouts/plugins/casl';
import type { NavLink } from '@layouts/types';
import {
  getComputedNavLinkToProp,
  getDynamicI18nProps,
  isNavLinkActive,
} from '@layouts/utils';

interface Props {
  item: NavLink;
  isSubItem?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isSubItem: false,
});
</script>

<template>
  <template v-if="props.isSubItem">
    <ul>
      <li
        v-if="can(item.permissions)"
        class="nav-link"
        :class="[
          {
            'sub-item': props.isSubItem,
            disabled: item.disable,
          },
        ]"
      >
        <Component
          :is="item.to ? 'RouterLink' : 'a'"
          v-bind="getComputedNavLinkToProp(item)"
          :active-class="item.to ? '' : undefined"
          :exact-active-class="item.to ? '' : undefined"
          :class="{
            'router-link-active router-link-exact-active': isNavLinkActive(
              item,
              $router
            ),
          }"
        >
          <Component
            :is="layoutConfig.app.iconRenderer || 'div'"
            class="nav-item-icon"
            v-bind="
              (item.icon ??
                layoutConfig.verticalNav.defaultNavItemIconProps) as Record<
                string,
                unknown
              >
            "
          />
          <Component
            :is="layoutConfig.app.i18n.enable ? 'i18n-t' : 'span'"
            class="nav-item-title"
            v-bind="getDynamicI18nProps(item.title, 'span')"
          >
            {{ item.title }}
          </Component>
          <span
            v-if="item.badgeContent"
            class="nav-item-badge"
            :class="item.badgeClass"
          >
            {{ item.badgeContent }}
          </span>
        </Component>
      </li>
    </ul>
  </template>
  <ul v-else>
    <li
      v-if="can(item.permissions)"
      class="nav-link"
      :class="[
        {
          'sub-item': props.isSubItem,
          disabled: item.disable,
        },
      ]"
    >
      <Component
        :is="item.to ? 'RouterLink' : 'a'"
        v-bind="getComputedNavLinkToProp(item)"
        :active-class="item.to ? '' : undefined"
        :exact-active-class="item.to ? '' : undefined"
        :class="{
          'router-link-active router-link-exact-active': isNavLinkActive(
            item,
            $router
          ),
        }"
      >
        <Component
          :is="layoutConfig.app.iconRenderer || 'div'"
          class="nav-item-icon"
          v-bind="
            (item.icon ??
              layoutConfig.verticalNav.defaultNavItemIconProps) as Record<
              string,
              unknown
            >
          "
        />
        <Component
          :is="layoutConfig.app.i18n.enable ? 'i18n-t' : 'span'"
          class="nav-item-title"
          v-bind="getDynamicI18nProps(item.title, 'span')"
        >
          {{ item.title }}
        </Component>
        <span
          v-if="item.badgeContent"
          class="nav-item-badge"
          :class="item.badgeClass"
        >
          {{ item.badgeContent }}
        </span>
      </Component>
    </li>
  </ul>
</template>

<style lang="scss">
.layout-horizontal-nav {
  .nav-link a {
    display: flex;
    align-items: center;
  }
}
</style>
