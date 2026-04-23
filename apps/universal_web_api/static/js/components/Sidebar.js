// ==================== Componente da barra lateral ====================
window.SidebarComponent = {
    name: 'SidebarComponent',
    props: {
        sites: { type: Object, required: true },
        currentDomain: { type: String, default: '' },
        browserStatus: { type: Object, required: true },
        authEnabled: { type: Boolean, default: false },
        hasToken: { type: Boolean, default: false },
        darkMode: { type: Boolean, default: false },
        activeTab: { type: String, default: 'config' }  // ✨ Novo
    },
    emits: [
        'select-site', 
        'add-site', 
        'delete-site', 
        'export-site', 
        'toggle-dark', 
        'refresh-status', 
        'trigger-import', 
        'export-all', 
        'show-token-dialog',
        'change-tab'  // ✨ Novo
    ],
    data() {
        return {
            searchQuery: ''
        };
    },
    computed: {
        filteredSites() {
            const domains = Object.keys(this.sites);
            if (!this.searchQuery) return domains;
            const query = this.searchQuery.toLowerCase();
            return domains.filter(d => d.toLowerCase().includes(query));
        }
    },
    template: `
        <aside class="w-64 bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col">
            <div class="p-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-sm font-semibold dark:text-white">Status do serviço</span>
                    <div class="flex gap-2">
                        <button @click.prevent.stop="$emit('toggle-dark')"
                                class="rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-600 transition hover:bg-gray-100 hover:text-blue-700 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-blue-300"
                                :title="darkMode ? 'Mudar para o modo diurno' : 'Mudar para o modo noturno'">
                            {{ darkMode ? '☀️ dia' : '🌙 à noite' }}
                        </button>
                        <button @click="$emit('refresh-status')" 
                                class="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
                            atualizar
                        </button>
                    </div>
                </div>
                <div class="text-xs space-y-1">
                    <div class="flex items-center dark:text-gray-300">
                        <span :class="['inline-block w-2 h-2 rounded-full mr-1', 
                                       browserStatus.connected ? 'bg-green-500' : 'bg-red-500']"></span>
                        <span>Navegador: {{ browserStatus.connected ? 'Conectado' : 'Não conectado' }}</span>
                    </div>
                    <div class="text-gray-600 dark:text-gray-400">
                        Configuração do site: {{ Object.keys(sites).length }} individual                     </div>
                    <div v-if="authEnabled" class="text-gray-600 dark:text-gray-400 flex items-center justify-between">
                        <span>🔒 Certificação: {{ hasToken ? 'configurado' : 'Não configurado' }}</span>
                        <button @click.stop="$emit('show-token-dialog')" 
                                class="text-blue-500 dark:text-blue-400">configurar</button>
                    </div>
                </div>
            </div>

            <!-- ✨ Novo:Tab trocar -->
            <div class="border-b dark:border-gray-700">
                <div class="flex">
                    <button @click="$emit('change-tab', 'config')"
                            :class="['flex-1 py-2 text-xs font-medium transition-colors border-b-2',
                                     activeTab === 'config'
                                     ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                                     : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50']">
                        ⚙️ site
                    </button>
                    <button @click="$emit('change-tab', 'tabpool')"
                            :class="['flex-1 py-2 text-xs font-medium transition-colors border-b-2',
                                     activeTab === 'tabpool'
                                     ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                                     : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50']">
                        🗂️ página da guia
                    </button>
                    <button @click="$emit('change-tab', 'logs')"
                            :class="['flex-1 py-2 text-xs font-medium transition-colors border-b-2',
                                     activeTab === 'logs' 
                                     ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' 
                                     : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50']">
                        📋 registro
                    </button>
                    <button @click="$emit('change-tab', 'settings')"
                            :class="['flex-1 py-2 text-xs font-medium transition-colors border-b-2',
                                     activeTab === 'settings' 
                                     ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' 
                                     : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50']">
                        🔧 configurar
                    </button>
                </div>
            </div>

            <div class="p-3 border-b dark:border-gray-700">
                <input v-model="searchQuery"
                       type="search"
                       name="site_search_query_final"
                       autocomplete="new-password"
                       placeholder="Local de pesquisa..."
                       class="border dark:border-gray-700 px-2 py-1 rounded focus:outline-none focus:border-blue-400 w-full text-sm bg-white dark:bg-gray-700 dark:text-white dark:placeholder-gray-400">
            </div>

            <div class="flex-1 overflow-auto">
                <div v-for="domain in filteredSites"
                     :key="domain"
                     @click="$emit('select-site', domain)"
                     class="cursor-pointer px-3 py-2 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group"
                     :class="{'bg-blue-50 dark:bg-blue-900/30 border-l-4 border-l-blue-500': currentDomain === domain}">
                    <div class="flex items-center justify-between">
                        <span class="text-sm dark:text-white truncate flex-1">{{ domain }}</span>
                        <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button @click.stop="$emit('export-site', domain)"
                                    class="text-blue-500 text-xs" title="Exportar este site">
                                <span v-html="$icons.arrowUpTray"></span>
                            </button>
                            <button @click.stop="$emit('delete-site', domain)"
                                    class="text-red-500 text-xs" title="excluir">
                                <span v-html="$icons.trash"></span>
                            </button>
                        </div>
                    </div>
                </div>
                <div v-if="filteredSites.length === 0" 
                     class="p-4 text-center text-gray-400 dark:text-gray-500 text-sm">
                    Nenhum resultado correspondente
                </div>
            </div>

            <div class="p-3 border-t dark:border-gray-700 space-y-2">
                <button @click="$emit('add-site')" 
                        class="px-3 py-1 border dark:border-gray-700 rounded transition-colors bg-blue-500 text-white hover:bg-blue-600 border-blue-500 w-full text-sm">
                    <span v-html="$icons.plusCircle"></span> Adicionar novo site
                </button>
                <div class="flex gap-2">
                    <button @click="$emit('trigger-import')" 
                            class="flex-1 px-3 py-1 border dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-white transition-colors text-sm">
                        <span v-html="$icons.documentArrowDown"></span> importar
                    </button>
                    <button @click="$emit('export-all')" 
                            class="flex-1 px-3 py-1 border dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-white transition-colors text-sm">
                        <span v-html="$icons.arrowUpTray"></span> Exportar
                    </button>
                </div>
            </div>
        </aside>
    `
};
