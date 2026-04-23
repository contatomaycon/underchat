// ==================== CommandsTab Template ====================
window.CommandsTabTemplate = `
    <div class="p-4 space-y-4">
        <!-- barra de título -->
        <div class="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(241,245,249,0.92))] p-4 shadow-[0_14px_36px_-32px_rgba(15,23,42,0.55)] dark:border-slate-700/70 dark:bg-[linear-gradient(145deg,rgba(15,23,42,0.98),rgba(30,41,59,0.92))] lg:flex-row lg:items-center lg:justify-between">
            <div>
                <h2 class="text-xl font-bold dark:text-white">⚡ Comandos de automação</h2>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Defina condições de gatilho e ações de execução para realizar o gerenciamento automático de guias                 </p>
            </div>
            <div class="flex flex-wrap items-center gap-3">
                <button @click.stop="toggleHelp"
                        class="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-300/60 bg-white/80 text-sm font-bold text-amber-600 transition hover:bg-amber-50 dark:border-amber-500/30 dark:bg-slate-900/70 dark:text-amber-300 dark:hover:bg-slate-800">
                    ?
                </button>
                <button @click="fetchCommands" :disabled="loading"
                        class="rounded-xl border border-slate-300/80 bg-white/85 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900/70 dark:text-white dark:hover:bg-slate-800">
                    {{ loading ? 'Refrescante...' : 'atualizar' }}
                </button>
                <button @click="openNewCommand"
                        class="rounded-xl bg-blue-500 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition hover:bg-blue-600">
                    + Novo comando                 </button>
            </div>
        </div>

        <!-- Instruções de uso -->
        <div v-if="showHelpTip" class="p-4 bg-amber-50/90 dark:bg-amber-900/20 rounded-2xl border border-amber-200 dark:border-amber-800 shadow-sm">
            <h3 class="font-semibold text-amber-800 dark:text-amber-300 mb-2">💡 Princípio de funcionamento</h3>
            <ul class="text-sm text-amber-700 dark:text-amber-200 space-y-1">
                <li>• <strong>Modo simples</strong>：Selecione as condições de disparo + Configure listas de ações para obter automação sem código</li>
                <li>• <strong>Modo avançado</strong>：Escreva diretamente JavaScript ou Python Script, total liberdade de controle</li>
                <li>• apoiar“resultados do comando correspondem”Ramificação condicional, interceptação de código de status de rede,Webhook alarme externo</li>
                <li>• O comando verifica automaticamente as condições de disparo após a conclusão de cada conversa e será executado imediatamente quando a interceptação da rede for atingida.</li>
            </ul>
        </div>

        <!-- Estado vazio -->
        <div v-if="commands.length === 0 && !loading" class="text-center py-12 text-gray-500 dark:text-gray-400">
            <div class="text-4xl mb-4">⚙️</div>
            <p>Ainda não há comandos automatizados</p>
            <p class="text-sm mt-2">Clique em "Novo Comando" para iniciar a configuração</p>
        </div>

        <!-- lista de comandos -->
        <div v-if="commands.length > 0" class="rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div class="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                    <span class="rounded-full bg-slate-900/5 px-3 py-1.5 dark:bg-white/5">total {{ commands.length }}</span>
                    <span class="rounded-full bg-emerald-500/10 px-3 py-1.5 text-emerald-600 dark:text-emerald-300">habilitar {{ enabledCount }}</span>
                    <span class="rounded-full bg-slate-500/10 px-3 py-1.5">Desativar {{ disabledCount }}</span>
                    <span>Atualmente em exibição {{ pageStartIndex }} - {{ pageEndIndex }}</span>
                </div>
                <label class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <span>por página</span>
                    <input v-model.number="pageSize"
                           @change="applyPageSize"
                           type="number"
                           min="1"
                           max="500"
                           list="command-page-size-options"
                           class="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                    <datalist id="command-page-size-options">
                        <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }}</option>
                    </datalist>
                </label>
            </div>
        </div>

        <div v-if="commands.length > 0" class="rounded-xl border border-sky-200/80 bg-[linear-gradient(135deg,rgba(240,249,255,0.96),rgba(238,242,255,0.92))] p-2.5 shadow-sm dark:border-sky-800/60 dark:bg-[linear-gradient(145deg,rgba(10,25,47,0.7),rgba(30,41,59,0.75))]">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <span class="rounded-full bg-slate-900/5 px-3 py-1.5 dark:bg-white/5">grupo de comando {{ commandGroups.length }}</span>
                    <span class="rounded-full bg-slate-900/5 px-3 py-1.5 dark:bg-white/5">Selecionado {{ selectedCommands.length }}</span>
                </div>
                <button @click="showGroupTools = !showGroupTools"
                        class="rounded-xl border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-800">
                    {{ showGroupTools ? 'Recolher ferramentas de agrupamento' : 'Expandir ferramentas de agrupamento' }}
                </button>
            </div>
            <div v-show="showGroupTools" class="mt-3 space-y-3">
                <div class="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.45fr)_minmax(0,1fr)]">
                    <div class="rounded-2xl border border-slate-200/80 bg-white/70 p-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/50">
                        <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Selecione a ação</div>
                        <div class="flex flex-wrap items-center gap-2">
                            <button @click="toggleCurrentPageSelection"
                                    class="rounded-xl border border-slate-200 bg-white/85 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:bg-slate-800">
                                Atualmente visível selecionar tudo/Contra-eleição                             </button>
                            <button @click="clearSelection"
                                    :disabled="!hasSelection"
                                    class="rounded-xl border border-slate-200 bg-white/85 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:bg-slate-800">
                                Limpar seleção                             </button>
                            <div class="relative">
                                <button @click.stop="toggleBulkActionMenu"
                                        class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/85 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:bg-slate-800">
                                    <span>Operação em lote</span>
                                    <span class="text-[10px]">{{ isBulkActionMenuOpen() ? '▲' : '▼' }}</span>
                                </button>
                                <div v-if="isBulkActionMenuOpen()"
                                     class="absolute left-0 top-full z-20 mt-2 min-w-[140px] overflow-hidden rounded-xl border border-slate-200/90 bg-white/95 p-1.5 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
                                    <button @click.stop="disableAllCommands"
                                            :disabled="groupWorking || commands.length === 0"
                                            class="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-40 dark:text-rose-300 dark:hover:bg-slate-800">
                                        Desativar tudo                                     </button>
                                    <button @click.stop="enableAllDisabledCommands"
                                            :disabled="groupWorking || disabledCount === 0"
                                            class="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-slate-800">
                                        Desbloquear tudo                                     </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="rounded-2xl border border-slate-200/80 bg-white/70 p-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/50">
                        <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Operações de grupo de comando</div>
                        <div class="space-y-2.5">
                            <div class="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                                <input v-model.trim="pendingGroupName"
                                       type="text"
                                       list="existing-command-groups"
                                       placeholder="Digite um novo nome de grupo, ele será gerado automaticamente se for deixado em branco"
                                       class="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                                <button @click="assignSelectedToGroup"
                                        :disabled="groupWorking || !hasSelection"
                                        class="rounded-xl bg-sky-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-40">
                                    Consolidado em grupo de comando                                 </button>
                            </div>
                            <datalist id="existing-command-groups">
                                <option v-for="group in commandGroups" :key="'group_hint_' + group.name" :value="group.name"></option>
                            </datalist>
                            <div class="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                                <select v-model="selectedExistingGroupName"
                                        :disabled="groupWorking || commandGroups.length === 0"
                                        class="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                                    <option value="" disabled>Selecione um grupo de comandos existente</option>
                                    <option v-for="group in commandGroups" :key="'group_pick_' + group.name" :value="group.name">
                                        {{ group.name }}
                                    </option>
                                </select>
                                <button @click="assignSelectedToExistingGroup"
                                        :disabled="groupWorking || !hasSelection || !selectedExistingGroupName"
                                        class="rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 disabled:opacity-40 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/40">
                                    Junte-se ao grupo existente                                 </button>
                                <button @click="renameSelectedGroup"
                                        :disabled="groupWorking || !selectedExistingGroupName || !pendingGroupName.trim()"
                                        class="rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-40 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-300 dark:hover:bg-violet-900/30">
                                    Renomear                                 </button>
                            </div>
                            <button @click="ungroupSelectedCommands"
                                    :disabled="groupWorking || !hasSelection"
                                    class="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-40 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/30">
                                Dispensar grupo selecionado                             </button>
                        </div>
                    </div>

                    <div class="rounded-2xl border border-slate-200/80 bg-white/70 p-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/50">
                        <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Configurações do grupo de execução</div>
                        <div class="space-y-2.5">
                            <label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/85 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300">
                                <input type="checkbox" v-model="includeDisabledWhenRunGroup">
                                <span>Incluir comandos desabilitados ao executar um grupo</span>
                            </label>
                            <label class="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white/85 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300">
                                <span>Executar política de ocupação de grupo</span>
                                <select v-model="runGroupAcquirePolicy"
                                        class="rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                                    <option value="inherit_session">Herdar a sessão atual</option>
                                    <option value="try_acquire">Tente reocupar</option>
                                    <option value="require_acquire">deve ser reocupado</option>
                                </select>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="text-xs text-slate-500 dark:text-slate-400">
                    Você pode arrastar diretamente o cartão de comando para um cabeçalho de grupo para concluir o armazenamento.                 </div>
            </div>
        </div>

        <div class="space-y-3">
            <div v-for="row in paginatedDisplayRows" :key="row.key"
                 :class="[
                    row.isGroup ? 'rounded-xl border border-sky-200/80 bg-sky-50/50 p-2.5 dark:border-sky-800/50 dark:bg-sky-900/10' : '',
                    row.isGroup && isGroupDropTarget(row.groupName) ? 'ring-2 ring-sky-400 ring-offset-1 ring-offset-white dark:ring-offset-slate-900' : ''
                 ]">
                <div v-if="row.isGroup"
                     @dragover.prevent="onGroupDragOver(row.groupName, $event)"
                     @dragleave="onGroupDragLeave(row.groupName)"
                     @drop.prevent="onGroupDrop(row.groupName)"
                     class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                        <button @click="toggleGroupCollapse(row.groupName)"
                                class="rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                            {{ isGroupCollapsed(row.groupName) ? 'Expandir' : 'dobrar' }}
                        </button>
                        <span class="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                            {{ row.groupName }}
                        </span>
                        <span class="text-xs text-slate-500 dark:text-slate-300">
                            {{ row.commands.filter(item => item.enabled).length }}/{{ row.commands.length }}
                        </span>
                        <span class="text-xs text-slate-400 dark:text-slate-500">
                            Selecionado {{ getSelectedCount(row.commands) }}/{{ row.commands.length }}
                        </span>
                    </div>
                    <div class="relative">
                        <button @click.stop="toggleGroupActionMenu(row.groupName)"
                                class="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800">
                            <span>Operação em lote</span>
                            <span class="text-[10px]">{{ isGroupActionMenuOpen(row.groupName) ? '▲' : '▼' }}</span>
                        </button>
                        <div v-if="isGroupActionMenuOpen(row.groupName)"
                             class="absolute right-0 top-full z-20 mt-2 min-w-[150px] overflow-hidden rounded-xl border border-slate-200/90 bg-white/95 p-1.5 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
                            <button @click.stop="toggleGroupSelection(row.commands)"
                                    class="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                                {{ getGroupSelectionActionLabel(row.commands) }}
                            </button>
                            <button @click.stop="runGroup(row.groupName)"
                                    :disabled="groupWorking"
                                    class="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-blue-600 transition hover:bg-blue-50 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-slate-800">
                                grupo executivo                             </button>
                            <button @click.stop="disableGroup(row.groupName)"
                                    :disabled="groupWorking || row.commands.filter(item => item.enabled).length === 0"
                                    class="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-amber-700 transition hover:bg-amber-50 disabled:opacity-40 dark:text-amber-300 dark:hover:bg-slate-800">
                                Desativar tudo                             </button>
                            <button @click.stop="enableGroup(row.groupName)"
                                    :disabled="groupWorking || row.commands.filter(item => !item.enabled).length === 0"
                                    class="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-slate-800">
                                Desbloquear tudo                             </button>
                            <button @click.stop="disbandGroup(row.groupName)"
                                    :disabled="groupWorking"
                                    class="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-slate-800">
                                dissolver grupo                             </button>
                        </div>
                    </div>
                </div>

                <div :class="row.isGroup ? 'mt-2 space-y-2' : 'space-y-2'" v-show="!row.isGroup || !isGroupCollapsed(row.groupName)">
                    <div v-for="cmd in row.commands" :key="cmd.id"
                         draggable="true"
                         @dragstart="beginGroupDrag(cmd.id, $event)"
                         @dragend="clearGroupDragState"
                         :class="['rounded-xl border p-3 transition-all shadow-sm',
                                  cmd.enabled
                                  ? 'bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(241,245,249,0.94))] border-slate-200/80 hover:-translate-y-0.5 hover:shadow-md dark:bg-[linear-gradient(145deg,rgba(15,23,42,0.96),rgba(30,41,59,0.92))] dark:border-slate-700/70'
                                  : 'bg-slate-100/85 dark:bg-slate-900 border-slate-200 dark:border-slate-700 opacity-70']">
                        <div class="flex items-start justify-between">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-3 mb-2">
                                    <label class="inline-flex items-center">
                                        <input type="checkbox"
                                               :checked="isCommandSelected(cmd.id)"
                                               @change="toggleCommandSelection(cmd.id)"
                                               class="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500">
                                    </label>
                                    <span class="inline-flex h-7 min-w-7 items-center justify-center rounded-xl bg-slate-900 px-2 text-[11px] font-bold text-white dark:bg-slate-100 dark:text-slate-900">
                                        {{ getCommandOrder(cmd.id) }}
                                    </span>
                                    <span class="font-semibold dark:text-white text-base">{{ cmd.name }}</span>
                                    <span v-if="cmd.group_name"
                                          class="px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">
                                        Grupo: {{ cmd.group_name }}
                                    </span>
                                    <span :class="['px-2 py-0.5 rounded-full text-xs font-medium',
                                                   cmd.mode === 'advanced'
                                                   ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                                                   : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300']">
                                        {{ cmd.mode === 'advanced' ? 'avançado' : 'Simples' }}
                                    </span>
                                    <span v-if="!cmd.enabled" class="px-2 py-0.5 rounded-full text-xs bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                        Desabilitado                                     </span>
                                </div>

                                <div class="text-sm text-gray-600 dark:text-gray-300 mb-1">
                                    <span class="font-medium">acionar:</span>
                                    {{ getTriggerLabel(cmd.trigger?.type) }}
                                    <span v-if="getTriggerValueDisplay(cmd.trigger)" class="text-blue-600 dark:text-blue-400 font-mono">= {{ getTriggerValueDisplay(cmd.trigger) }}</span>
                                    <span class="text-gray-400 mx-1">|</span>
                                    <span>escopo:{{ getScopeLabel(cmd.trigger?.scope) }}</span>
                                    <span v-if="cmd.trigger?.scope === 'domain' && cmd.trigger?.domain" class="text-green-600 dark:text-green-400">
                                        ({{ cmd.trigger.domain }})
                                    </span>
                                    <span v-if="cmd.trigger?.scope === 'tab' && cmd.trigger?.tab_index != null" class="text-green-600 dark:text-green-400">
                                        (#{{ cmd.trigger.tab_index }})
                                    </span>
                                </div>

                                <div v-if="cmd.mode === 'simple'" class="text-sm text-gray-500 dark:text-gray-400">
                                    <span class="font-medium">Ação:</span>
                                    <span v-for="(a, i) in (cmd.actions || []).slice(0, 3)" :key="i">
                                        {{ getActionLabel(a.type) }}<span v-if="i < Math.min((cmd.actions || []).length, 3) - 1">、</span>
                                    </span>
                                    <span v-if="(cmd.actions || []).length > 3"> espere{{ cmd.actions.length }} etapa</span>
                                </div>
                                <div v-else class="text-sm text-gray-500 dark:text-gray-400">
                                    <span class="font-medium">Roteiro:</span>
                                    {{ cmd.script_lang === 'python' ? 'Python' : 'JavaScript' }}
                                    ({{ (cmd.script || '').split('\\n').length }} OK)
                                </div>

                                <div class="text-xs text-gray-400 dark:text-gray-500 mt-2">
                                    Provocado{{ cmd.trigger_count || 0 }} Segunda categoria                                     <span v-if="cmd.last_triggered"> · última vez: {{ formatTime(cmd.last_triggered) }}</span>
                                </div>
                            </div>

                            <div class="flex flex-wrap items-center gap-2 ml-4">
                                <button @click="moveCommand(cmd, -1)" :disabled="reordering || getCommandOrder(cmd.id) === 1"
                                        class="rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800">
                                    ↑ subir                                 </button>
                                <button @click="moveCommand(cmd, 1)" :disabled="reordering || getCommandOrder(cmd.id) === commands.length"
                                        class="rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800">
                                    ↓ descer                                 </button>
                                <button @click="testCommand(cmd)" title="Execução manual"
                                        class="rounded-lg bg-blue-500 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-blue-600">
                                    ▶️
                                </button>
                                <button @click="toggleCommand(cmd)" :title="cmd.enabled ? 'Desativar' : 'habilitar'"
                                        class="rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800">
                                    {{ cmd.enabled ? '⏸️' : '▶️' }}
                                </button>
                                <button @click="openEditCommand(cmd)" title="editar"
                                        class="rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800">
                                    ✏️
                                </button>
                                <button @click="deleteCommand(cmd)" title="excluir"
                                        class="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-500 transition hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20">
                                    🗑️
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <!-- ========== Editar janela pop-up ========== -->
        <div v-if="commands.length > 0" class="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white/85 p-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/75 sm:flex-row sm:items-center sm:justify-between">
            <div class="text-sm text-slate-500 dark:text-slate-400">
                Não.<span class="font-semibold text-slate-900 dark:text-white">{{ currentPage }}</span> / {{ totalPages }} Página            </div>
            <div class="flex flex-wrap items-center gap-2">
                <button @click="changePage(currentPage - 1)" :disabled="currentPage === 1"
                        class="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800">
                    Página anterior                </button>
                <button v-for="page in visiblePageNumbers" :key="page"
                        @click="changePage(page)"
                        :class="[
                            'rounded-xl px-3 py-2 text-sm font-medium transition',
                            page === currentPage
                                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                : 'border border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800'
                        ]">
                    {{ page }}
                </button>
                <button @click="changePage(currentPage + 1)" :disabled="currentPage === totalPages"
                        class="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800">
                    Próxima página                </button>
            </div>
        </div>

        <div v-if="showEditor" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto m-4">
                <div class="p-6">
                    <!-- Título da janela pop-up -->
                    <div class="flex justify-between items-center mb-6">
                        <h3 class="text-lg font-bold dark:text-white">
                            {{ isNew ? 'Novo comando' : 'Editar comando' }}
                        </h3>
                        <button @click="showEditor = false" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl">✕</button>
                    </div>

                    <!-- Informações básicas -->
                    <div class="space-y-4 mb-6">
                        <div>
                            <label class="block text-sm font-medium dark:text-gray-300 mb-1">Nome do comando</label>
                            <input v-model="editingCommand.name" type="text"
                                   class="w-full px-3 py-2 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-400">
                        </div>
                        <div>
                            <label class="block text-sm font-medium dark:text-gray-300 mb-1">Grupo de comando (opcional)</label>
                            <input v-model.trim="editingCommand.group_name"
                                   list="command-group-options"
                                   type="text"
                                   placeholder="Por exemplo: grupo de processos Shield"
                                   class="w-full px-3 py-2 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-sky-400">
                            <datalist id="command-group-options">
                                <option v-for="group in commandGroups" :key="group.name" :value="group.name"></option>
                            </datalist>
                        </div>

                        <div class="flex items-center gap-4">
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="radio" v-model="editingCommand.mode" value="simple" class="text-blue-500">
                                <span class="text-sm dark:text-gray-300">Modo simples</span>
                            </label>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="radio" v-model="editingCommand.mode" value="advanced" class="text-purple-500">
                                <span class="text-sm dark:text-gray-300">Modo avançado</span>
                            </label>
                        </div>
                    </div>

                    <!-- Condição de gatilho -->
                    <div class="mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                        <h4 class="text-sm font-semibold dark:text-gray-300 mb-3">🎯 Condição de gatilho</h4>

                        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div>
                                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">tipo</label>
                                <select v-model="editingCommand.trigger.type"
                                        @change="handleTriggerTypeChange"
                                        class="w-full px-3 py-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                    <option v-for="opt in triggerTypeOptions" :key="opt.value" :value="opt.value">
                                        {{ opt.label }}
                                    </option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                                    {{ getTriggerTargetLabel(editingCommand.trigger) }}
                                </label>
                                <div v-if="['command_triggered', 'command_result_match', 'command_result_event'].includes(editingCommand.trigger.type)"
                                     class="relative">
                                    <button type="button"
                                            @click="toggleSourceCommandPicker"
                                            :disabled="sourceCommandOptions.length === 0"
                                            class="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-sky-300 hover:bg-sky-50/70 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:border-sky-500 dark:hover:bg-slate-800">
                                        <div class="min-w-0">
                                            <div class="truncate font-medium">{{ getSourceCommandButtonLabel() }}</div>
                                            <div class="truncate text-xs text-slate-500 dark:text-slate-300">
                                                <span v-if="editingCommand.trigger.type === 'command_result_event'">
                                                    {{ editingCommand.trigger.listen_all_commands ? 'Todos os resultados do comando' : ((selectedSourceCommandOptions || []).length + ' Artigo selecionado') }}
                                                </span>
                                                <span v-else>{{ selectedSourceCommandOption?.groupName || 'comandos desagrupados' }}</span>
                                            </div>
                                        </div>
                                        <span class="ml-3 text-xs text-slate-400">{{ sourceCommandPickerOpen ? 'fechar' : 'Expandir' }}</span>
                                    </button>

                                    <div v-if="sourceCommandPickerOpen"
                                         class="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white/98 shadow-2xl shadow-slate-900/10 backdrop-blur dark:border-slate-700 dark:bg-slate-900/98">
                                        <div class="border-b border-slate-200/80 p-3 dark:border-slate-700">
                                            <div class="flex items-center gap-2">
                                                <input v-model.trim="sourceCommandSearch"
                                                       type="text"
                                                       placeholder="Nome do comando de pesquisa / grupo de comando / ID"
                                                       class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-sky-300 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                                                <button v-if="sourceCommandSearch"
                                                        type="button"
                                                        @click="sourceCommandSearch = ''"
                                                        class="rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                                                    Claro                                                 </button>
                                            </div>
                                             <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                                 Navegue primeiro pelo grupo de comandos, expanda o grupo e selecione comandos específicos.                                              </p>
                                             <div v-if="editingCommand.trigger.type === 'command_result_event'"
                                                  class="mt-3 flex items-center justify-between rounded-xl border border-emerald-200/80 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-200">
                                                 <div>Você pode selecionar vários comandos ou monitorar diretamente os resultados de todos os comandos.</div>
                                                 <button type="button"
                                                         @click="toggleListenAllCommands"
                                                         class="rounded-lg border border-emerald-300 px-2 py-1 font-semibold hover:bg-emerald-100 dark:border-emerald-700 dark:hover:bg-emerald-900/40">
                                                     {{ editingCommand.trigger.listen_all_commands ? 'Mudar para seleção manual' : 'Ouça todos os comandos' }}
                                                 </button>
                                             </div>
                                         </div>

                                        <div class="max-h-80 overflow-y-auto p-2">
                                            <div v-if="filteredSourceCommandSections.length === 0"
                                                 class="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                                Nenhum comando de origem correspondente                                             </div>

                                            <div v-for="section in filteredSourceCommandSections" :key="section.key" class="mb-2 rounded-xl border border-slate-200/80 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-800/70">
                                                <button type="button"
                                                        @click="toggleSourceCommandSection(section)"
                                                        class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left">
                                                    <div class="min-w-0">
                                                        <div class="truncate text-sm font-semibold text-slate-700 dark:text-slate-100">{{ section.name }}</div>
                                                        <div class="text-xs text-slate-500 dark:text-slate-400">{{ section.commands.length }} comando</div>
                                                    </div>
                                                    <span class="rounded-full bg-slate-900/5 px-2 py-1 text-[11px] text-slate-500 dark:bg-white/5 dark:text-slate-300">
                                                        {{ isSourceCommandSectionExpanded(section) ? 'fechar' : 'Expandir' }}
                                                    </span>
                                                </button>

                                                <div v-show="isSourceCommandSectionExpanded(section)" class="border-t border-slate-200/70 p-2 dark:border-slate-700">
                                                    <button v-for="opt in section.commands"
                                                            :key="opt.value"
                                                            type="button"
                                                            @click="selectSourceCommand(opt.value)"
                                                            :class="[
                                                                'mb-1 flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition',
                                                                isSourceCommandSelected(opt.value)
                                                                    ? 'bg-sky-100 text-sky-800 ring-1 ring-sky-300 dark:bg-sky-900/40 dark:text-sky-200 dark:ring-sky-700'
                                                                    : 'bg-white text-slate-700 hover:bg-sky-50 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
                                                            ]">
                                                        <div class="min-w-0">
                                                            <div class="truncate text-sm font-medium">{{ opt.label }}</div>
                                                            <div class="truncate text-[11px] text-slate-500 dark:text-slate-400">{{ opt.value }}</div>
                                                        </div>
                                                        <span v-if="!opt.enabled"
                                                              class="rounded-full bg-slate-200 px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                                                            Desabilitado                                                         </span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <input v-else-if="editingCommand.trigger.type === 'network_request_error'"
                                       v-model.trim="editingCommand.trigger.url_pattern"
                                       type="text"
                                       :placeholder="editingCommand.trigger.match_mode === 'regex'
                                           ? 'como: .*/queue/join.* ou .*conversation.*'
                                           : 'como: /queue/join ou /conversation'"
                                       class="w-full px-3 py-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono">
                                <input v-else-if="editingCommand.trigger.type === 'page_check'"
                                       v-model="editingCommand.trigger.value"
                                       type="text"
                                       placeholder="Cloudflare"
                                       class="w-full px-3 py-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                <input v-else v-model.number="editingCommand.trigger.value"
                                       type="number"
                                       placeholder="10"
                                       class="w-full px-3 py-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                            </div>
                        </div>

                        <div v-if="editingCommand.trigger.type === 'command_result_match'"
                             class="mt-3 rounded-xl border border-emerald-200/70 bg-emerald-50/70 p-3 dark:border-emerald-800/60 dark:bg-emerald-900/20">
                            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Etapas da meta</label>
                                    <select v-model="editingCommand.trigger.action_ref"
                                            class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                        <option value="">O valor de retorno final do comando</option>
                                        <option v-for="opt in resultSourceActionOptions" :key="opt.value" :value="opt.value">
                                            {{ opt.label }}
                                        </option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Regras de correspondência</label>
                                    <select v-model="editingCommand.trigger.match_rule"
                                            class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                        <option value="equals">igual</option>
                                        <option value="contains">Incluir</option>
                                        <option value="not_equals">não é igual a</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">valor esperado</label>
                                    <input v-model="editingCommand.trigger.expected_value"
                                           type="text"
                                           placeholder="como: CSS_FAILED / SUCCESS"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                </div>
                            </div>
                        </div>

                        <div v-if="editingCommand.trigger.type === 'network_request_error'"
                             class="mt-3 rounded-xl border border-rose-200/70 bg-rose-50/70 p-3 dark:border-rose-800/60 dark:bg-rose-900/20">
                            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tipo de regra</label>
                                    <select v-model="editingCommand.trigger.match_mode"
                                            class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                        <option value="keyword">palavras-chave</option>
                                        <option value="regex">expressão regular</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">código de status</label>
                                    <input v-model="editingCommand.trigger.status_codes"
                                           type="text"
                                           placeholder="403,429,500"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono">
                                </div>
                                <div class="flex items-center pt-5">
                                    <label class="flex items-center gap-2 cursor-pointer text-sm dark:text-gray-300">
                                        <input type="checkbox" v-model="editingCommand.trigger.abort_on_match" class="rounded">
                                        Interromper a espera imediatamente após o acerto                                    </label>
                                </div>
                            </div>
                            <p class="mt-2 text-xs text-rose-700 dark:text-rose-300">
                                {{ editingCommand.trigger.match_mode === 'regex'
                                    ? 'O conteúdo normal está acima“expressão regular”Preencha a caixa de entrada. Por exemplo:.*/queue/join.*'
                                    : 'O modo de palavra-chave também é preenchido na caixa de entrada acima, suportado URL Correspondência de substring.' }}
                            </p>
                        </div>

                        <div v-if="editingCommand.trigger.type === 'command_result_event'"
                             class="mt-3 rounded-xl border border-emerald-200/70 bg-emerald-50/70 p-3 dark:border-emerald-800/60 dark:bg-emerald-900/20">
                            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <label class="flex items-center gap-2 text-sm dark:text-gray-300">
                                    <input type="checkbox" v-model="editingCommand.trigger.listen_all_commands" class="rounded">
                                    Monitore todos os comandos e retorne resultados                                 </label>
                                <label class="flex items-center gap-2 text-sm dark:text-gray-300">
                                    <input type="checkbox" v-model="editingCommand.trigger.informative_only" class="rounded">
                                    Notificar apenas resultados informativos                                 </label>
                            </div>
                            <p class="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                                Escuta apenas o valor final de retorno do comando e não o aciona individualmente para cada etapa. Variáveis ​​disponíveis:<span v-pre>{{source_command_name}}</span>、<span v-pre>{{command_result_summary}}</span>、<span v-pre>{{command_result}}</span>
                            </p>
                        </div>

                        <div class="mt-3 rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-700/60 dark:bg-slate-900/40">
                            <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
                                <label class="flex items-center gap-2 text-sm dark:text-gray-300 pt-5 md:pt-6">
                                    <input type="checkbox" v-model="editingCommand.trigger.periodic_enabled" class="rounded">
                                    Habilite esta detecção de ciclo de comando                                 </label>
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">prioridade de comando (inteiro)</label>
                                    <input v-model.number="editingCommand.trigger.priority"
                                           type="number"
                                           step="1"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                </div>
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Intervalo de detecção (segundos)</label>
                                    <input v-model.number="editingCommand.trigger.periodic_interval_sec"
                                           type="number"
                                           min="1"
                                           step="0.5"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                </div>
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tremulação aleatória (segundos)</label>
                                    <input v-model.number="editingCommand.trigger.periodic_jitter_sec"
                                           type="number"
                                           min="0"
                                           step="0.2"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                </div>
                            </div>
                            <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                Afeta apenas“Verificação periódica de guias gratuitas”；A verificação imediata do acionador após a conclusão da conversa ainda é executada.                             </p>
                            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                A prioridade suporta qualquer número inteiro, quanto maior o valor, maior. A prioridade base da solicitação padrão é 2（Variáveis ​​de ambiente disponíveis <code>CMD_REQUEST_PRIORITY_BASELINE</code> ajustado), então algo como <code>-99</code>、<code>0</code>、<code>2</code>、<code>99</code> Tudo ficará bem.                             </p>
                        </div>

                        <div class="mt-3 rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-700/60 dark:bg-slate-900/40">
                            <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <div v-if="editingCommand.trigger.type === 'page_check'">
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Modo de gatilho de hit de página</label>
                                    <select v-model="editingCommand.trigger.fire_mode"
                                            class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                        <option value="edge">borda acionada</option>
                                        <option value="level">Gatilho contínuo</option>
                                    </select>
                                </div>
                                <div v-if="editingCommand.trigger.type === 'page_check'">
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tempo de resfriamento (segundos)</label>
                                    <input v-model.number="editingCommand.trigger.cooldown_sec"
                                           type="number"
                                           min="0"
                                           step="0.5"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                </div>
                                <div v-if="editingCommand.trigger.type === 'page_check'">
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Hits estáveis ​​da página (segundos)</label>
                                    <input v-model.number="editingCommand.trigger.stable_for_sec"
                                           type="number"
                                           min="0"
                                           step="0.5"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                </div>
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Estratégia de interrupção do fluxo de trabalho</label>
                                    <select v-model="editingCommand.trigger.interrupt_policy"
                                            class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                        <option value="auto">automático</option>
                                        <option value="resume">Continuar após a recuperação</option>
                                        <option value="abort">aborto direto</option>
                                    </select>
                                </div>
                                <label class="flex items-center gap-2 text-sm dark:text-gray-300 pt-5 md:pt-6">
                                    <input type="checkbox" v-model="editingCommand.trigger.allow_during_workflow" class="rounded">
                                    Permitir corte de fila em fluxos de trabalho                                 </label>
                                <label v-if="editingCommand.trigger.type === 'page_check'" class="flex items-center gap-2 text-sm dark:text-gray-300 pt-5 md:pt-6">
                                    <input type="checkbox" v-model="editingCommand.trigger.check_while_busy_workflow" class="rounded">
                                    Participe da inspeção de páginas mesmo quando o fluxo de trabalho estiver ocupado                                 </label>
                            </div>
                            <div class="mt-3">
                                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Solicitação de interrupção do fluxo de trabalho (opcional)</label>
                                <input v-model.trim="editingCommand.trigger.interrupt_message"
                                       type="text"
                                       placeholder="Quando este comando é acionado, o fluxo de trabalho subsequente foi interrompido, tente novamente."
                                       class="w-full px-3 py-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                            </div>
                        </div>

                        <div class="mt-3">
                            <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Escopo</label>
                            <div class="flex items-center gap-4">
                                <label class="flex items-center gap-1.5 text-sm dark:text-gray-300">
                                    <input type="radio" v-model="editingCommand.trigger.scope" value="all" @change="handleTriggerScopeChange"> Todas as guias                                 </label>
                                <label class="flex items-center gap-1.5 text-sm dark:text-gray-300">
                                    <input type="radio" v-model="editingCommand.trigger.scope" value="domain" @change="handleTriggerScopeChange"> Especifique o nome de domínio                                 </label>
                                <label class="flex items-center gap-1.5 text-sm dark:text-gray-300">
                                    <input type="radio" v-model="editingCommand.trigger.scope" value="tab" @change="handleTriggerScopeChange"> Especifique a página da guia                                </label>
                            </div>
                        </div>

                        <div v-if="editingCommand.trigger.scope === 'domain'" class="mt-2">
                            <input v-model.trim="editingCommand.trigger.domain"
                                   @change="handleTriggerTargetChange"
                                   list="command-domain-options"
                                   type="text" placeholder="Por exemplo: chatgpt.com"
                                   class="w-full px-3 py-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                            <datalist id="command-domain-options">
                                <option v-for="domain in availableDomains" :key="domain" :value="domain"></option>
                            </datalist>
                        </div>
                        <div v-if="editingCommand.trigger.scope === 'tab'" class="mt-2">
                            <select v-if="availableTabs.length > 0"
                                    v-model.number="editingCommand.trigger.tab_index"
                                    @change="handleTriggerTargetChange"
                                    class="w-full px-3 py-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                <option :value="null" disabled>Selecionar guia</option>
                                <option v-for="tab in availableTabs" :key="tab.persistent_index" :value="tab.persistent_index">
                                    {{ getTabLabel(tab) }}
                                </option>
                            </select>
                            <input v-else
                                   v-model.number="editingCommand.trigger.tab_index"
                                   @change="handleTriggerTargetChange"
                                   type="number" min="1" placeholder="Número da guia"
                                   class="w-full px-3 py-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                        </div>
                    </div>

                    <!-- Modo simples: lista de ações -->
                    <div v-if="editingCommand.mode === 'simple'" class="mb-6">
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="text-sm font-semibold dark:text-gray-300">🔧 lista de ações</h4>
                            <button @click="addAction" class="text-xs text-blue-500 hover:text-blue-700">+ Adicionar ação</button>
                        </div>

                        <label class="mb-3 flex items-center gap-2 text-sm dark:text-gray-300">
                            <input type="checkbox" v-model="editingCommand.stop_on_error" class="rounded">
                            Pare imediatamente as etapas subsequentes após uma ação falhar                         </label>

                        <div v-if="editingCommand.actions.length === 0" class="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                            Nenhuma ação ainda, clique acima para adicionar                         </div>

                        <div v-for="(action, i) in editingCommand.actions" :key="i"
                             class="flex flex-wrap items-start gap-2 mb-2 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                            <span class="text-xs text-gray-400 w-5">{{ i + 1 }}</span>

                                <select v-model="action.type"
                                     @change="handleActionTypeChange(action)"
                                     class="flex-1 min-w-[180px] px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                    <optgroup v-for="group in actionTypeGroups" :key="group.label" :label="group.label">
                                        <option v-for="opt in group.options" :key="opt.value" :value="opt.value">
                                            {{ opt.label }}
                                        </option>
                                    </optgroup>
                                </select>

                            <!-- parâmetros de ação -->
                            <input v-if="action.type === 'wait'" v-model.number="action.seconds" type="number" min="0" step="0.5" placeholder="Segundo"
                                   class="w-20 px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                            <input v-if="action.type === 'run_js'" v-model="action.code" type="text" placeholder="JavaScript código"
                                   class="flex-1 px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono">
                            <input v-if="action.type === 'click_element'" v-model.trim="action.selector" type="text" placeholder="CSS / XPath seletor"
                                   class="flex-1 px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono">
                            <div v-if="action.type === 'click_coordinates'" class="flex flex-wrap items-center gap-2">
                                <input v-model.number="action.x" type="number" step="1" placeholder="X"
                                       class="w-24 px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                <input v-model.number="action.y" type="number" step="1" placeholder="Y"
                                       class="w-24 px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                            </div>
                            <div v-if="['execute_preset', 'execute_workflow'].includes(action.type)" class="flex-1 min-w-[220px]">
                                <select v-model="action.preset_name"
                                        class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                    <option :value="getFollowDefaultPresetValue()">
                                        {{ getFollowDefaultPresetLabel() }}
                                    </option>
                                    <option v-for="preset in availablePresets" :key="preset" :value="preset">
                                        {{ preset }}
                                    </option>
                                </select>
                                <input v-if="action.type === 'execute_workflow'"
                                       v-model="action.prompt"
                                       type="text"
                                       placeholder="Mensagem de teste opcional"
                                       class="w-full mt-2 px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    {{ getPresetHint() }}
                                </p>
                            </div>
                            <div v-if="action.type === 'execute_command_group'" class="flex-1 min-w-[220px] space-y-2">
                                <select v-model="action.group_name"
                                        class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                    <option value="" disabled>Selecione um grupo de comando</option>
                                    <option v-for="group in commandGroups" :key="group.name" :value="group.name">
                                        {{ group.name }}（{{ group.enabledCount }}/{{ group.count }}）
                                    </option>
                                </select>
                                <label class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                    <input type="checkbox" v-model="action.include_disabled" class="rounded">
                                    Contém comandos desabilitados                                 </label>
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Política de ocupação</label>
                                    <select v-model="action.acquire_policy"
                                            class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                        <option value="inherit_session">Herdar a sessão atual</option>
                                        <option value="try_acquire">Tente reocupar</option>
                                        <option value="require_acquire">deve ser reocupado</option>
                                    </select>
                                </div>
                            </div>
                            <input v-if="action.type === 'navigate'" v-model="action.url" type="text" placeholder="URL"
                                   class="flex-1 px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                            <span v-if="action.type === 'send_webhook'" class="text-xs text-gray-500 dark:text-gray-400 flex-1 font-mono">
                                {{ (action.method || 'POST').toUpperCase() }} · {{ action.url || 'Não configurado URL' }}
                            </span>
                            <span v-if="action.type === 'send_napcat'" class="text-xs text-gray-500 dark:text-gray-400 flex-1 font-mono">
                                NapCat · {{ action.target_type === 'group' ? ('grupo ' + (action.group_id || 'Não preenchido')) : ('QQ ' + (action.user_id || 'Não preenchido')) }}
                            </span>
                            <span v-if="action.type === 'abort_task'" class="text-xs text-gray-500 dark:text-gray-400 flex-1">
                                Após o acionamento, cancele a solicitação atual e interrompa as ações subsequentes.                             </span>
                            <span v-if="action.type === 'release_tab_lock'" class="text-xs text-gray-500 dark:text-gray-400 flex-1">
                                Liberar a página da guia atual (pode forçar a liberação e limpar a página)                            </span>

                            <!-- comutação de proxy - Breve exibição -->
                            <span v-if="action.type === 'switch_proxy'" class="text-xs text-gray-500 dark:text-gray-400 flex-1">
                                {{ action.mode === 'random' ? 'aleatório' : action.mode === 'round_robin' ? 'votação' : action.node_name || 'designação' }}
                                @ {{ action.selector || 'Proxy' }}
                            </span>

                            <!-- organizar & excluir -->
                            <button @click="moveAction(i, -1)" :disabled="i === 0" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm">↑</button>
                            <button @click="moveAction(i, 1)" :disabled="i === editingCommand.actions.length - 1" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm">↓</button>
                            <button @click="removeAction(i)" class="text-red-400 hover:text-red-600 text-sm">✕</button>
                        </div>

                        <!-- Configuração detalhada da comutação de agentes (quando um switch_proxy Exibido durante a ação) -->
                        <div v-for="(action, i) in editingCommand.actions.filter(a => a.type === 'switch_proxy')"
                             :key="'proxy-' + i"
                             class="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                            <h5 class="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-3">🔀 Configuração de comutação de agente</h5>

                            <div class="grid grid-cols-2 gap-3">
                                <!-- Clash API endereço -->
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Clash API endereço</label>
                                    <input v-model="action.clash_api" type="text"
                                           :placeholder="proxyDefaults.clash_api"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono">
                                </div>

                                <!-- Nome do grupo de agentes -->
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nome do grupo de agentes</label>
                                    <input v-model="action.selector" type="text"
                                           :placeholder="proxyDefaults.selector"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                </div>

                                <!-- Modo de mudança -->
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Modo de mudança</label>
                                    <select v-model="action.mode"
                                            class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                        <option value="random">aleatório</option>
                                        <option value="round_robin">votação</option>
                                        <option value="specific">Especifique o nó</option>
                                    </select>
                                </div>

                                <!-- Especifique o nome do nó -->
                                <div v-if="action.mode === 'specific'">
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nome do nó</label>
                                    <input v-model="action.node_name" type="text" placeholder="Insira o nome do nó"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                </div>

                                <!-- Clash Secret -->
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Clash Secret（opcional)</label>
                                    <input v-model="action.clash_secret" type="password" placeholder="Deixe em branco se não estiver definido"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                </div>

                                <!-- atualizar página -->
                                <div class="flex items-center">
                                    <label class="flex items-center gap-2 cursor-pointer text-sm dark:text-gray-300">
                                        <input type="checkbox" v-model="action.refresh_after" class="rounded">
                                        Atualize a página após mudar                                     </label>
                                </div>
                            </div>

                            <!-- Excluir palavras-chave -->
                            <div class="mt-3">
                                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Excluir palavras-chave de nó (separadas por vírgula)</label>
                                <input v-model="action.exclude_keywords" type="text"
                                       :placeholder="proxyDefaults.exclude_keywords"
                                       class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                            </div>

                            <p class="mt-2 text-xs text-blue-600 dark:text-blue-400">
                                💡 Por favor confirme Clash ativado e ligado External Controller（geralmente em 9090 porta)                            </p>
                        </div>

                        <div v-for="(action, i) in editingCommand.actions.filter(a => a.type === 'send_webhook')"
                             :key="'webhook-' + i"
                             class="mt-4 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                            <h5 class="text-sm font-semibold text-emerald-800 dark:text-emerald-300 mb-3">📣 Webhook Configuração</h5>

                            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Método de solicitação</label>
                                    <select v-model="action.method"
                                            class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                        <option value="POST">POST</option>
                                        <option value="GET">GET</option>
                                    </select>
                                </div>
                                <div class="md:col-span-2">
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">perguntar URL</label>
                                    <input v-model.trim="action.url" type="text"
                                           placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono">
                                </div>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Payload（Variáveis ​​de suporte)</label>
                                    <textarea v-model="action.payload"
                                              rows="3"
                                              class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono resize-y"
                                              placeholder='{"msg":"página da guia#{{tab_index}} existir {{domain}} falhas consecutivas"}'></textarea>
                                </div>
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Headers（JSON，opcional)</label>
                                    <textarea v-model="action.headers"
                                              rows="3"
                                              class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono resize-y"
                                              placeholder='{"Content-Type":"application/json"}'></textarea>
                                </div>
                            </div>

                            <div class="mt-3 flex flex-wrap items-center gap-4">
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tempo limite (segundos)</label>
                                    <input v-model.number="action.timeout" type="number" min="1" step="1"
                                           class="w-24 px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                </div>
                                <label class="flex items-center gap-2 cursor-pointer text-sm dark:text-gray-300 pt-5">
                                    <input type="checkbox" v-model="action.raise_for_status" class="rounded">
                                    HTTP Não 2xx considerado como fracasso                                 </label>
                            </div>

                            <p class="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                                Variáveis ​​disponíveis:                                <span v-pre>{{tab_index}}</span>、                                <span v-pre>{{domain}}</span>、                                <span v-pre>{{network_status}}</span>、                                <span v-pre>{{network_url}}</span>、                                <span v-pre>{{timestamp}}</span>
                            </p>
                        </div>

                        <div v-for="(action, i) in editingCommand.actions.filter(a => a.type === 'send_napcat')"
                             :key="'napcat-' + i"
                             class="mt-4 p-4 bg-cyan-50 dark:bg-cyan-900/20 rounded-lg border border-cyan-200 dark:border-cyan-800">
                            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <h5 class="text-sm font-semibold text-cyan-800 dark:text-cyan-300">🐧 NapCat QQ notificar</h5>
                                <div class="flex gap-2">
                                    <button @click="useNapcatPreset(action, 'private')"
                                            type="button"
                                            class="rounded-lg border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-100 dark:border-cyan-700 dark:text-cyan-300 dark:hover:bg-cyan-900/40">
                                        Modelo de bate-papo privado                                     </button>
                                    <button @click="useNapcatPreset(action, 'group')"
                                            type="button"
                                            class="rounded-lg border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-100 dark:border-cyan-700 dark:text-cyan-300 dark:hover:bg-cyan-900/40">
                                        Modelo de bate-papo em grupo                                     </button>
                                </div>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div class="md:col-span-2">
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">NapCat HTTP endereço</label>
                                    <input v-model.trim="action.base_url" type="text"
                                           placeholder="http://127.0.0.1:3000"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono">
                                </div>
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Enviar alvo</label>
                                    <select v-model="action.target_type"
                                            class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                        <option value="private">bate-papo privado</option>
                                        <option value="group">bate-papo em grupo</option>
                                    </select>
                                </div>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                <div v-if="action.target_type !== 'group'">
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">QQ Número</label>
                                    <input v-model.trim="action.user_id" type="text"
                                           placeholder="para receber notificações QQ Número"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono">
                                </div>
                                <div v-else>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Número do grupo</label>
                                    <input v-model.trim="action.group_id" type="text"
                                           placeholder="Número do grupo para receber notificações"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono">
                                </div>
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Access Token（opcional)</label>
                                    <input v-model.trim="action.access_token" type="text"
                                           placeholder="Deixe em branco para indicar que não há cabeçalho de autenticação."
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono">
                                </div>
                            </div>

                            <div class="mt-3">
                                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Conteúdo da mensagem (suporta variáveis)</label>
                                <textarea v-model="action.message"
                                          rows="4"
                                          class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono resize-y"
                                          placeholder="Notificação de comando:{{source_command_name}}&#10;{{command_result_summary}}"></textarea>
                            </div>

                            <div class="mt-3 flex flex-wrap items-center gap-4">
                                <div>
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tempo limite (segundos)</label>
                                    <input v-model.number="action.timeout" type="number" min="1" step="1"
                                           class="w-24 px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm">
                                </div>
                                <label class="flex items-center gap-2 cursor-pointer text-sm dark:text-gray-300 pt-5">
                                    <input type="checkbox" v-model="action.raise_for_status" class="rounded">
                                    HTTP Não 2xx considerado como fracasso                                 </label>
                            </div>

                            <p class="mt-2 text-xs text-cyan-700 dark:text-cyan-300">
                                Variáveis ​​comumente usadas:<span v-pre>{{source_command_name}}</span>、<span v-pre>{{command_result_summary}}</span>、<span v-pre>{{command_result}}</span>、<span v-pre>{{domain}}</span>、<span v-pre>{{network_url}}</span>
                            </p>
                        </div>

                        <div v-for="(action, i) in editingCommand.actions.filter(a => a.type === 'release_tab_lock')"
                             :key="'unlock-' + i"
                             class="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                            <h5 class="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-3">🔓 Configuração de desbloqueio</h5>

                            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div class="md:col-span-2">
                                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">etiqueta de motivo</label>
                                    <input v-model.trim="action.reason" type="text"
                                           placeholder="release_tab_lock_action"
                                           class="w-full px-2 py-1.5 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-sm font-mono">
                                </div>
                                <div class="flex items-center pt-5">
                                    <label class="flex items-center gap-2 cursor-pointer text-sm dark:text-gray-300">
                                        <input type="checkbox" v-model="action.clear_page" class="rounded">
                                        Redefine para página em branco após o lançamento                                    </label>
                                </div>
                            </div>

                            <div class="mt-3">
                                <label class="flex items-center gap-2 cursor-pointer text-sm dark:text-gray-300">
                                    <input type="checkbox" v-model="action.stop_actions" class="rounded">
                                    Interromper ações subsequentes após a execução                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- Modo Avançado: Editor de Script -->
                    <div v-if="editingCommand.mode === 'advanced'" class="mb-6">
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="text-sm font-semibold dark:text-gray-300">📝 Roteiro</h4>
                            <select v-model="editingCommand.script_lang"
                                    class="px-2 py-1 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white text-xs">
                                <option value="javascript">JavaScript</option>
                                <option value="python">Python</option>
                            </select>
                        </div>

                        <div class="mb-2 p-3 bg-gray-50 dark:bg-gray-900 rounded text-xs text-gray-500 dark:text-gray-400">
                            <div v-if="editingCommand.script_lang === 'javascript'">
                                💡 O script será executado na página do navegador (equivalente a DevTools Console）
                            </div>
                            <div v-else>
                                💡 Variáveis ​​disponíveis:<code>tab</code>（página da guia),<code>session</code>（conversa),                                 <code>browser</code>、<code>config_engine</code>、<code>logger</code>、
                                <code>time</code>、<code>json</code>
                            </div>
                        </div>

                        <textarea v-model="editingCommand.script"
                                  :style="{ height: scriptEditorHeight }"
                                  :placeholder="scriptPlaceholder"
                                  class="w-full px-3 py-2 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 dark:text-green-400 text-sm font-mono resize-y focus:ring-2 focus:ring-purple-400"
                                  spellcheck="false">
                        </textarea>
                    </div>

                    <!-- botão inferior -->
                    <div class="flex justify-end gap-3 pt-4 border-t dark:border-gray-700">
                        <button @click="showEditor = false"
                                class="px-4 py-2 border dark:border-gray-600 rounded-lg text-sm dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                            Cancelar                         </button>
                        <button @click="saveCommand"
                                class="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">
                            {{ isNew ? 'criar' : 'manter' }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
`;
