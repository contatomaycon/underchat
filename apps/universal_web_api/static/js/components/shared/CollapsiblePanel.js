// ==================== Montagem de painel dobrável universal ====================

window.CollapsiblePanel = {
    name: 'CollapsiblePanel',
    props: {
        title: { type: String, required: true },
        icon: { type: String, default: '' },
        badge: { type: [String, Number], default: null },
        collapsed: { type: Boolean, default: true },
        headerClass: { type: String, default: '' }
    },
    emits: ['toggle'],
    methods: {
        toggle() {
            this.$emit('toggle');
        },
        
        stopPropagation(event) {
            event.stopPropagation();
        }
    },
    template: `
        <div class="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-sm">
            <!-- barra de título -->
            <div :class="[
                'px-4 py-3 border-b dark:border-gray-700 flex justify-between items-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors',
                headerClass
            ]" @click="toggle">
                <div class="flex items-center gap-2">
                    <span class="text-gray-500 dark:text-gray-400" 
                          v-html="collapsed ? $icons.chevronDown : $icons.chevronUp"></span>
                    <h3 class="font-semibold text-gray-900 dark:text-white">
                        {{ icon }} {{ title }}
                    </h3>
                    <span v-if="badge !== null" class="text-sm text-gray-500 dark:text-gray-400">
                        ({{ badge }})
                    </span>
                    <!-- Espaço extra para crachá -->
                    <slot name="badges"></slot>
                </div>
                
                <!-- Área operacional direita -->
                <div @click.stop="stopPropagation">
                    <slot name="actions"></slot>
                </div>
            </div>

            <!-- área de conteúdo -->
            <div v-show="!collapsed">
                <slot></slot>
            </div>
        </div>
    `
};
