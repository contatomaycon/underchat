// ==================== CommandsTab Methods ====================
window.CommandsTabMethods = {
        async apiRequest(url, options) {
            const token = localStorage.getItem('api_token');
            const headers = { 'Content-Type': 'application/json', ...(options || {}).headers };
            if (token) headers['Authorization'] = 'Bearer ' + token;
            const response = await fetch(url, { ...options, headers });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                const detail = err.detail;
                let message = 'HTTP ' + response.status;
                if (typeof detail === 'string' && detail) {
                    message = detail;
                } else if (detail && typeof detail === 'object') {
                    try {
                        message = JSON.stringify(detail, null, 2);
                    } catch (_) {
                        message = String(detail);
                    }
                }
                throw new Error(message);
            }
            return response.json();
        },

        async fetchCommands() {
            this.loading = true;
            try {
                const data = await this.apiRequest('/api/commands');
                this.commands = (data.commands || []).map(cmd => this.normalizeCommand(cmd));
                const validIds = new Set(this.commands.map(cmd => cmd.id));
                this.selectedCommandIds = (this.selectedCommandIds || []).filter(id => validIds.has(id));
                this.syncGroupCollapseState();
                this.syncSourceCommandPickerState();
                const hasExistingSelection = (this.commandGroups || []).some(group => group.name === this.selectedExistingGroupName);
                if (!hasExistingSelection) {
                    this.selectedExistingGroupName = this.commandGroups[0]?.name || '';
                }
                this.clearGroupDragState();
                this.ensureValidPage();
            } catch (e) {
                this.$emit('notify', { type: 'error', message: 'Falha no comando de carregamento: ' + e.message });
            } finally {
                this.loading = false;
            }
        },

        normalizeAction(action, index = 0) {
            const next = { ...(action || {}) };
            if (!next.action_id) {
                next.action_id = 'step_' + (index + 1);
            }
            if (next.type === 'switch_preset') {
                next.type = 'execute_preset';
            }
            if (next.type === 'execute_workflow' && next.prompt === undefined) {
                next.prompt = '';
            }
            if (['execute_preset', 'execute_workflow'].includes(next.type)) {
                next.preset_name = this.normalizePresetActionValue(next.preset_name);
            }
            this.initClickAction(next);
            this.initProxyAction(next);
            this.initWebhookAction(next);
            this.initNapcatAction(next);
            this.initCommandGroupAction(next);
            this.initReleaseLockAction(next);
            return next;
        },

        getFollowDefaultPresetValue() {
            return '__DEFAULT__';
        },

        normalizePresetActionValue(value) {
            const normalized = String(value || '').trim();
            return normalized || this.getFollowDefaultPresetValue();
        },

        getFollowDefaultPresetLabel() {
            return 'Siga os padrões do site';
        },

        normalizeCommand(command) {
            const normalized = JSON.parse(JSON.stringify(command || {}));
            normalized.trigger = normalized.trigger || {
                type: 'request_count',
                value: 10,
                command_id: '',
                command_ids: [],
                listen_all_commands: false,
                informative_only: true,
                action_ref: '',
                match_rule: 'equals',
                expected_value: '',
                match_mode: 'keyword',
                status_codes: '403,429,500,502,503,504',
                abort_on_match: true,
                scope: 'all',
                domain: '',
                tab_index: null,
                priority: 2,
                fire_mode: 'edge',
                cooldown_sec: 0,
                stable_for_sec: 0,
                check_while_busy_workflow: true,
                allow_during_workflow: false,
                interrupt_policy: 'auto',
                interrupt_message: '',
                periodic_enabled: true,
                periodic_interval_sec: 8,
                periodic_jitter_sec: 2
            };
            normalized.trigger = this.ensureTriggerDefaults(normalized.trigger);
            if (normalized.stop_on_error === undefined) {
                normalized.stop_on_error = false;
            }
            if (normalized.trigger.command_id === undefined) {
                normalized.trigger.command_id = '';
            }
            if (normalized.group_name === undefined || normalized.group_name === null) {
                normalized.group_name = '';
            } else {
                normalized.group_name = String(normalized.group_name).trim();
            }
            normalized.actions = (normalized.actions || []).map((action, index) => this.normalizeAction(action, index));
            return normalized;
        },

        ensureTriggerDefaults(trigger) {
            const next = { ...(trigger || {}) };
            if (next.command_id === undefined) next.command_id = '';
            if (!Array.isArray(next.command_ids)) {
                if (typeof next.command_ids === 'string' && next.command_ids.trim()) {
                    next.command_ids = next.command_ids.split(',').map(item => item.trim()).filter(Boolean);
                } else {
                    next.command_ids = [];
                }
            }
            if (next.listen_all_commands === undefined) next.listen_all_commands = false;
            if (next.informative_only === undefined) next.informative_only = true;
            if (next.action_ref === undefined) next.action_ref = '';
            if (!next.match_rule) next.match_rule = 'equals';
            if (next.expected_value === undefined || next.expected_value === null) next.expected_value = '';
            if (!next.match_mode) next.match_mode = 'keyword';
            if (!next.status_codes) next.status_codes = '403,429,500,502,503,504';
            if (next.abort_on_match === undefined) next.abort_on_match = true;
            if (!next.fire_mode) next.fire_mode = 'edge';
            const cooldown = Number(next.cooldown_sec);
            next.cooldown_sec = Number.isFinite(cooldown) && cooldown >= 0 ? cooldown : 0;
            const stableFor = Number(next.stable_for_sec);
            next.stable_for_sec = Number.isFinite(stableFor) && stableFor >= 0 ? stableFor : 0;
            if (next.check_while_busy_workflow === undefined) next.check_while_busy_workflow = true;
            if (next.allow_during_workflow === undefined) next.allow_during_workflow = false;
            if (!next.interrupt_policy) next.interrupt_policy = 'auto';
            if (next.interrupt_message === undefined || next.interrupt_message === null) next.interrupt_message = '';
            const priority = Number(next.priority);
            next.priority = Number.isInteger(priority) ? priority : 2;
            if (!next.url_pattern && next.type === 'network_request_error') {
                next.url_pattern = '';
            }
            if (next.periodic_enabled === undefined) next.periodic_enabled = true;
            const periodicInterval = Number(next.periodic_interval_sec);
            next.periodic_interval_sec = Number.isFinite(periodicInterval) && periodicInterval >= 1
                ? periodicInterval
                : 8;
            const periodicJitter = Number(next.periodic_jitter_sec);
            next.periodic_jitter_sec = Number.isFinite(periodicJitter) && periodicJitter >= 0
                ? periodicJitter
                : 2;
            return next;
        },

        async fetchMeta() {
            try {
                this.meta = await this.apiRequest('/api/commands/meta');
            } catch (e) {
                console.error('Falha ao carregar metainformações:', e);
            }
        },

        async fetchBindingMeta() {
            await Promise.all([
                this.fetchAvailableDomains(),
                this.fetchAvailableTabs()
            ]);
        },

        async fetchAvailableDomains() {
            try {
                const data = await this.apiRequest('/api/config');
                this.availableDomains = Object.keys(data || {}).sort();
            } catch (e) {
                console.error('Falha ao carregar a lista de nomes de domínio:', e);
                this.availableDomains = [];
            }
        },

        async fetchAvailableTabs() {
            try {
                const data = await this.apiRequest('/api/tab-pool/tabs');
                this.availableTabs = data.tabs || [];
            } catch (e) {
                console.error('Falha ao carregar a lista de guias:', e);
                this.availableTabs = [];
            }
        },

        getBoundDomain(command = this.editingCommand) {
            const trigger = command?.trigger || {};
            if (trigger.scope === 'domain') {
                return (trigger.domain || '').trim();
            }
            if (trigger.scope === 'tab') {
                const targetTab = this.availableTabs.find(tab => tab.persistent_index === trigger.tab_index);
                return (targetTab?.current_domain || '').trim();
            }
            return '';
        },

        getTabLabel(tab) {
            if (!tab) return '';
            const domain = tab.current_domain || 'Nome de domínio não reconhecido';
            return '#' + tab.persistent_index + ' · ' + domain;
        },

        getPresetHint() {
            if (!this.editingCommand) return 'Primeiro selecione o nome de domínio ou guia vinculado e, em seguida, selecione a predefinição a ser executada.';
            const scope = this.editingCommand.trigger?.scope;
            if (scope === 'all') {
                return 'Alternar predefinição/Os fluxos de trabalho de execução são recomendados apenas para“Especifique o nome de domínio”ou“Especifique a página da guia”，Você também pode manter diretamente“Siga os padrões do site”。';
            }
            if (this.presetLoading) {
                return 'Carregando lista predefinida...';
            }
            if (this.resolvedPresetDomain) {
                return 'Nome de domínio de destino atual: ' + this.resolvedPresetDomain + '，também pode ser mantido“Siga os padrões do site”。';
            }
            if (scope === 'tab') {
                return 'A guia selecionada atualmente não possui um nome de domínio reconhecido. As predefinições não podem ser listadas no momento, mas ainda podem ser mantidas.“Siga os padrões do site”。';
            }
            return 'Insira o nome de domínio configurado e selecione Padrão ou mantenha“Siga os padrões do site”。';
        },

        getPresetSelectPlaceholder() {
            if (!this.editingCommand) return 'Configure primeiro o intervalo de disparo';
            if (this.presetLoading) return 'Carregando lista predefinida...';
            if (!this.resolvedPresetDomain) {
                return this.editingCommand.trigger?.scope === 'all'
                    ? 'Mude primeiro para o nome de domínio ou página de guia especificado'
                    : 'Selecione primeiro um nome de domínio válido';
            }
            if (this.availablePresets.length === 0) {
                return 'Não há predefinição disponível para o nome de domínio atual';
            }
            return 'Selecione um padrão';
        },

        getCommandTriggerPlaceholder() {
            if (this.sourceCommandOptions.length === 0) {
                return 'Sem comandos opcionais';
            }
            if (this.editingCommand?.trigger?.type === 'command_result_event') {
                return 'Selecione o comando para monitorar';
            }
            return 'Selecione o comando de origem';
        },

        getSourceCommandButtonLabel() {
            if (this.editingCommand?.trigger?.type === 'command_result_event') {
                const trigger = this.editingCommand.trigger || {};
                if (trigger.listen_all_commands) {
                    return 'Ouça todos os comandos';
                }
                const selected = this.selectedSourceCommandOptions || [];
                if (selected.length === 1) return selected[0].label;
                if (selected.length > 1) return 'Selecionado ' + selected.length + ' comando';
            }
            const selected = this.selectedSourceCommandOption;
            if (selected) {
                return selected.label;
            }
            return this.getCommandTriggerPlaceholder();
        },

        syncSourceCommandPickerState() {
            const next = {};
            for (const section of (this.filteredSourceCommandSections || [])) {
                if (section.isUngrouped) continue;
                if (Object.prototype.hasOwnProperty.call(this.sourcePickerExpandedGroups, section.name)) {
                    next[section.name] = !!this.sourcePickerExpandedGroups[section.name];
                } else {
                    next[section.name] = false;
                }
            }
            this.sourcePickerExpandedGroups = next;
        },

        resetSourceCommandPicker() {
            this.sourceCommandPickerOpen = false;
            this.sourceCommandSearch = '';
            this.sourcePickerShowUngrouped = false;
            this.syncSourceCommandPickerState();
        },

        toggleSourceCommandPicker() {
            if (this.sourceCommandOptions.length === 0) return;
            this.sourceCommandPickerOpen = !this.sourceCommandPickerOpen;
            if (this.sourceCommandPickerOpen) {
                this.syncSourceCommandPickerState();
            }
        },

        isSourceCommandSectionExpanded(section) {
            if (!section) return false;
            if (String(this.sourceCommandSearch || '').trim()) {
                return true;
            }
            if (section.isUngrouped) {
                return !!this.sourcePickerShowUngrouped;
            }
            return !!this.sourcePickerExpandedGroups[section.name];
        },

        toggleSourceCommandSection(section) {
            if (!section) return;
            if (section.isUngrouped) {
                this.sourcePickerShowUngrouped = !this.sourcePickerShowUngrouped;
                return;
            }
            this.sourcePickerExpandedGroups = {
                ...this.sourcePickerExpandedGroups,
                [section.name]: !this.isSourceCommandSectionExpanded(section)
            };
        },

        selectSourceCommand(commandId) {
            if (!this.editingCommand?.trigger) return;
            if (this.editingCommand.trigger.type === 'command_result_event') {
                const selected = new Set(this.editingCommand.trigger.command_ids || []);
                if (selected.has(commandId)) selected.delete(commandId);
                else selected.add(commandId);
                this.editingCommand.trigger.command_ids = Array.from(selected);
                this.editingCommand.trigger.listen_all_commands = false;
                return;
            }
            this.editingCommand.trigger.command_id = commandId;
            if (this.editingCommand.trigger.type === 'command_result_match') {
                this.handleResultSourceChange();
            }
            this.sourceCommandPickerOpen = false;
        },

        toggleListenAllCommands() {
            if (!this.editingCommand?.trigger) return;
            const next = !this.editingCommand.trigger.listen_all_commands;
            this.editingCommand.trigger.listen_all_commands = next;
            if (next) {
                this.editingCommand.trigger.command_ids = [];
            }
        },

        isSourceCommandSelected(commandId) {
            if (this.editingCommand?.trigger?.type === 'command_result_event') {
                return (this.editingCommand.trigger.command_ids || []).includes(commandId);
            }
            return this.editingCommand?.trigger?.command_id === commandId;
        },

        getTriggerTargetLabel(trigger) {
            const type = trigger?.type;
            if (type === 'page_check') return 'verifique o texto';
            if (type === 'command_result_match') return 'Ouça os comandos';
            if (type === 'command_result_event') return 'Ouça os comandos';
            if (type === 'network_request_error') {
                return trigger?.match_mode === 'regex' ? 'expressão regular' : 'monitor URL regra';
            }
            if (type === 'command_triggered') return 'comando de origem';
            return 'limite';
        },

        getCommandName(commandId) {
            if (!commandId) return '';
            const match = (this.commands || []).find(cmd => cmd.id === commandId);
            return match?.name || commandId;
        },

        getCommandActionOptions(commandId) {
            const command = (this.commands || []).find(cmd => cmd.id === commandId);
            if (!command) return [];
            const actions = command.actions || [];
            return actions.map((action, idx) => {
                const ref = action.action_id || ('step_' + (idx + 1));
                return {
                    value: ref,
                    label: '#' + (idx + 1) + ' · ' + this.getActionLabel(action.type)
                };
            });
        },

        getActionRefLabel(commandId, actionRef) {
            if (!actionRef) return 'O valor de retorno final do comando';
            const match = this.getCommandActionOptions(commandId).find(opt => opt.value === actionRef);
            return match?.label || actionRef;
        },

        getMatchRuleLabel(rule) {
            const map = { equals: 'igual', contains: 'Incluir', not_equals: 'não é igual a' };
            return map[rule] || rule;
        },

        getTriggerValueDisplay(trigger) {
            if (!trigger) return '';
            if (trigger.type === 'command_triggered') {
                return this.getCommandName(trigger.command_id);
            }
            if (trigger.type === 'command_result_match') {
                const sourceName = this.getCommandName(trigger.command_id);
                const actionLabel = this.getActionRefLabel(trigger.command_id, trigger.action_ref);
                const ruleLabel = this.getMatchRuleLabel(trigger.match_rule || 'equals');
                const expected = String(trigger.expected_value || '');
                return sourceName + ' / ' + actionLabel + ' ' + ruleLabel + ' ' + expected;
            }
            if (trigger.type === 'command_result_event') {
                if (trigger.listen_all_commands) return 'Todos os comandos';
                const ids = Array.isArray(trigger.command_ids) ? trigger.command_ids : [];
                const labels = ids.map(id => this.getCommandName(id)).filter(Boolean);
                return labels.length > 0 ? labels.join('、') : 'Nenhum comando selecionado';
            }
            if (trigger.type === 'network_request_error') {
                const pattern = trigger.url_pattern || trigger.value || '';
                const codes = trigger.status_codes || '';
                return (pattern || '*') + ' [' + codes + ']';
            }
            return trigger.value;
        },

        async loadPresetOptions() {
            const domain = this.resolvedPresetDomain;
            this.availablePresets = [];

            if (!domain || !this.editingCommand) return;
            if (!this.editingCommand.actions?.some(action => ['execute_preset', 'execute_workflow'].includes(action.type))) return;

            this.presetLoading = true;
            try {
                const data = await this.apiRequest('/api/presets/' + encodeURIComponent(domain));
                this.availablePresets = data.presets || [];

                for (const action of this.editingCommand.actions) {
                    if (!['execute_preset', 'execute_workflow'].includes(action.type)) continue;
                    action.preset_name = this.normalizePresetActionValue(action.preset_name);
                    if (
                        action.preset_name !== this.getFollowDefaultPresetValue()
                        && !this.availablePresets.includes(action.preset_name)
                    ) {
                        action.preset_name = this.getFollowDefaultPresetValue();
                    }
                }
            } catch (e) {
                console.error('Falha ao carregar a lista predefinida:', e);
                this.availablePresets = [];
                for (const action of this.editingCommand.actions || []) {
                    if (['execute_preset', 'execute_workflow'].includes(action.type)) {
                        action.preset_name = this.getFollowDefaultPresetValue();
                    }
                }
            } finally {
                this.presetLoading = false;
            }
        },

        async handleTriggerScopeChange() {
            if (!this.editingCommand) return;

            if (this.editingCommand.trigger.scope !== 'domain') {
                this.editingCommand.trigger.domain = '';
            }
            if (this.editingCommand.trigger.scope !== 'tab') {
                this.editingCommand.trigger.tab_index = null;
            }

            await this.loadPresetOptions();
        },

        async handleTriggerTargetChange() {
            await this.loadPresetOptions();
        },

        getNumericTriggerDefault(triggerType) {
            const defaults = {
                request_count: 10,
                error_count: 3,
                idle_timeout: 300
            };
            return defaults[triggerType] ?? 10;
        },

        handleTriggerTypeChange() {
            if (!this.editingCommand?.trigger) return;

            const trigger = this.editingCommand.trigger;
            const currentValue = trigger.value;
            this.resetSourceCommandPicker();

            if (trigger.type === 'command_triggered') {
                trigger.value = '';
                if (!this.sourceCommandOptions.some(opt => opt.value === trigger.command_id)) {
                    trigger.command_id = this.sourceCommandOptions[0]?.value || '';
                }
                trigger.action_ref = '';
                trigger.expected_value = '';
                return;
            }

            if (trigger.type === 'command_result_match') {
                trigger.value = '';
                if (!this.sourceCommandOptions.some(opt => opt.value === trigger.command_id)) {
                    trigger.command_id = this.sourceCommandOptions[0]?.value || '';
                }
                if (!trigger.match_rule) trigger.match_rule = 'equals';
                if (trigger.expected_value === undefined || trigger.expected_value === null) {
                    trigger.expected_value = '';
                }
                if (trigger.action_ref === undefined) trigger.action_ref = '';
                this.handleResultSourceChange();
                return;
            }

            if (trigger.type === 'command_result_event') {
                trigger.value = '';
                trigger.command_id = '';
                trigger.action_ref = '';
                trigger.expected_value = '';
                trigger.command_ids = Array.isArray(trigger.command_ids) ? trigger.command_ids : [];
                if (trigger.listen_all_commands === undefined) trigger.listen_all_commands = false;
                if (trigger.informative_only === undefined) trigger.informative_only = true;
                return;
            }

            if (trigger.type === 'network_request_error') {
                trigger.value = '';
                trigger.command_id = '';
                if (!trigger.match_mode) trigger.match_mode = 'keyword';
                if (!trigger.status_codes) trigger.status_codes = '403,429,500,502,503,504';
                if (trigger.abort_on_match === undefined) trigger.abort_on_match = true;
                if (trigger.url_pattern === undefined || trigger.url_pattern === null) {
                    trigger.url_pattern = '';
                }
                return;
            }

            if (trigger.type === 'page_check') {
                trigger.command_id = '';
                if (currentValue === 10 || currentValue === '10' || typeof currentValue === 'number') {
                    trigger.value = '';
                }
                return;
            }

            trigger.command_id = '';

            if (['request_count', 'error_count', 'idle_timeout'].includes(trigger.type)) {
                const fallback = this.getNumericTriggerDefault(trigger.type);
                const numericValue = Number(currentValue);
                trigger.value = Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
                return;
            }

            if (currentValue === '' || currentValue === null || currentValue === undefined) {
                trigger.value = 10;
            }
        },

        handleResultSourceChange() {
            if (!this.editingCommand?.trigger) return;
            const trigger = this.editingCommand.trigger;
            const options = this.getCommandActionOptions(trigger.command_id);
            if (trigger.action_ref && !options.some(opt => opt.value === trigger.action_ref)) {
                trigger.action_ref = '';
            }
        },

        openNewCommand() {
            this.editingCommand = this.normalizeCommand({
                name: 'novo comando',
                enabled: true,
                mode: 'simple',
                trigger: {
                    type: 'request_count',
                    value: 10,
                    command_id: '',
                    command_ids: [],
                    listen_all_commands: false,
                    informative_only: true,
                    action_ref: '',
                    match_rule: 'equals',
                    expected_value: '',
                    match_mode: 'keyword',
                    status_codes: '403,429,500,502,503,504',
                    abort_on_match: true,
                    scope: 'all',
                    domain: '',
                    tab_index: null,
                    fire_mode: 'edge',
                    cooldown_sec: 0,
                    allow_during_workflow: false,
                    interrupt_policy: 'auto',
                    interrupt_message: '',
                    periodic_enabled: true,
                    periodic_interval_sec: 8,
                    periodic_jitter_sec: 2
                },
                stop_on_error: false,
                actions: [{ type: 'clear_cookies' }, { type: 'refresh_page' }],
                group_name: '',
                script: '',
                script_lang: 'javascript'
            });
            this.isNew = true;
            this.showEditor = true;
            this.resetSourceCommandPicker();
            this.fetchBindingMeta();
        },

        openEditCommand(cmd) {
            this.editingCommand = this.normalizeCommand(cmd);
            if (['command_result_match', 'command_result_event'].includes(this.editingCommand?.trigger?.type)) {
                this.handleResultSourceChange();
            }
            this.isNew = false;
            this.showEditor = true;
            this.resetSourceCommandPicker();
            this.fetchBindingMeta().then(() => this.loadPresetOptions());
        },

        addAction() {
            if (!this.editingCommand) return;
            const nextIndex = this.editingCommand.actions.length;
            this.editingCommand.actions.push(this.normalizeAction({ type: 'wait', seconds: 1 }, nextIndex));
        },

        async handleActionTypeChange(action) {
            this.initClickAction(action);
            this.initProxyAction(action);
            this.initWebhookAction(action);
            this.initNapcatAction(action);
            this.initCommandGroupAction(action);
            this.initReleaseLockAction(action);
            if (action.type === 'execute_workflow' && action.prompt === undefined) {
                action.prompt = '';
            }
            if (['execute_preset', 'execute_workflow'].includes(action.type)) {
                await this.loadPresetOptions();
                action.preset_name = this.normalizePresetActionValue(action.preset_name);
            }
        },

        initClickAction(action) {
            if (action.type === 'click_element') {
                action.selector = String(action.selector || '').trim();
            }
            if (action.type === 'click_coordinates') {
                const x = Number(action.x);
                const y = Number(action.y);
                action.x = Number.isFinite(x) ? x : '';
                action.y = Number.isFinite(y) ? y : '';
            }
        },

        initProxyAction(action) {
            if (action.type === 'switch_proxy') {
                action.clash_api = action.clash_api || this.proxyDefaults.clash_api;
                action.clash_secret = action.clash_secret || '';
                action.selector = action.selector || this.proxyDefaults.selector;
                action.mode = action.mode || 'random';
                action.node_name = action.node_name || '';
                action.exclude_keywords = action.exclude_keywords || this.proxyDefaults.exclude_keywords;
                if (action.refresh_after === undefined) {
                    action.refresh_after = true;
                }
            }
        },

        initWebhookAction(action) {
            if (action.type === 'send_webhook') {
                action.method = action.method || this.webhookDefaults.method;
                action.url = action.url || this.webhookDefaults.url;
                if (action.payload === undefined) {
                    action.payload = this.webhookDefaults.payload;
                }
                if (action.headers === undefined) {
                    action.headers = this.webhookDefaults.headers;
                }
                if (action.timeout === undefined) {
                    action.timeout = this.webhookDefaults.timeout;
                }
                if (action.raise_for_status === undefined) {
                    action.raise_for_status = this.webhookDefaults.raise_for_status;
                }
            }
        },

        initNapcatAction(action) {
            if (action.type !== 'send_napcat') return;
            action.base_url = action.base_url || this.napcatDefaults.base_url;
            action.target_type = action.target_type || this.napcatDefaults.target_type;
            action.user_id = action.user_id || this.napcatDefaults.user_id;
            action.group_id = action.group_id || this.napcatDefaults.group_id;
            if (action.message === undefined) action.message = this.napcatDefaults.message;
            if (action.access_token === undefined) action.access_token = this.napcatDefaults.access_token;
            if (action.timeout === undefined) action.timeout = this.napcatDefaults.timeout;
            if (action.raise_for_status === undefined) action.raise_for_status = this.napcatDefaults.raise_for_status;
        },

        useNapcatPreset(action, targetType) {
            if (!action) return;
            action.type = 'send_napcat';
            this.initNapcatAction(action);
            action.target_type = targetType === 'group' ? 'group' : 'private';
        },

        initCommandGroupAction(action) {
            if (action.type !== 'execute_command_group') return;
            if (action.include_disabled === undefined) {
                action.include_disabled = false;
            }
            if (!action.acquire_policy) {
                action.acquire_policy = 'inherit_session';
            }
            const current = String(action.group_name || '').trim();
            if (current) {
                action.group_name = current;
                return;
            }
            action.group_name = this.commandGroupOptions[0]?.value || '';
        },

        initReleaseLockAction(action) {
            if (action.type === 'release_tab_lock') {
                if (action.reason === undefined || action.reason === null || action.reason === '') {
                    action.reason = this.releaseLockDefaults.reason;
                }
                if (action.clear_page === undefined) {
                    action.clear_page = this.releaseLockDefaults.clear_page;
                }
                if (action.stop_actions === undefined) {
                    action.stop_actions = this.releaseLockDefaults.stop_actions;
                }
            }
        },

        removeAction(index) {
            if (!this.editingCommand) return;
            this.editingCommand.actions.splice(index, 1);
        },

        moveAction(index, direction) {
            if (!this.editingCommand) return;
            const arr = this.editingCommand.actions;
            const newIndex = index + direction;
            if (newIndex < 0 || newIndex >= arr.length) return;
            const temp = arr[index];
            arr[index] = arr[newIndex];
            arr[newIndex] = temp;
        },

        async saveCommand() {
            if (!this.editingCommand) return;
            const trigger = this.editingCommand.trigger || {};
            if (['request_count', 'error_count', 'idle_timeout'].includes(trigger.type)) {
                const numericValue = Number(trigger.value);
                if (!Number.isFinite(numericValue) || numericValue <= 0) {
                    this.$emit('notify', { type: 'error', message: 'contar/O limite de tempo limite deve ser maior que 0 número.' });
                    return;
                }
                trigger.value = numericValue;
            }
            if (trigger.type === 'command_triggered') {
                const sourceId = String(trigger.command_id || '').trim();
                if (!sourceId) {
                    this.$emit('notify', { type: 'error', message: 'por favor primeiro“Executar após o comando ser acionado”Selecione o comando de origem.' });
                    return;
                }
                if (this.editingCommand.id && sourceId === this.editingCommand.id) {
                    this.$emit('notify', { type: 'error', message: 'O comando de origem não pode selecionar o comando atual sozinho.' });
                    return;
                }
            }
            if (trigger.type === 'command_result_match') {
                const sourceId = String(trigger.command_id || '').trim();
                if (!sourceId) {
                    this.$emit('notify', { type: 'error', message: 'Selecione primeiro“Ouça os comandos”。' });
                    return;
                }
                if (this.editingCommand.id && sourceId === this.editingCommand.id) {
                    this.$emit('notify', { type: 'error', message: 'O comando de escuta não pode ser o próprio comando atual.' });
                    return;
                }
                const expected = String(trigger.expected_value || '').trim();
                if (!expected) {
                    this.$emit('notify', { type: 'error', message: 'Por favor preencha“valor esperado”。' });
                    return;
                }
            }
            if (trigger.type === 'command_result_event') {
                const ids = Array.isArray(trigger.command_ids)
                    ? trigger.command_ids.map(id => String(id || '').trim()).filter(Boolean)
                    : [];
                trigger.command_ids = ids;
                if (!trigger.listen_all_commands && ids.length === 0) {
                    this.$emit('notify', { type: 'error', message: 'Selecione pelo menos um comando de escuta ou mude para“Todos os comandos”。' });
                    return;
                }
                if (this.editingCommand.id && ids.includes(this.editingCommand.id)) {
                    this.$emit('notify', { type: 'error', message: 'O comando de escuta não pode incluir o próprio comando atual.' });
                    return;
                }
            }
            if (trigger.type === 'network_request_error') {
                const urlPattern = String(trigger.url_pattern || trigger.value || '').trim();
                if (!urlPattern) {
                    this.$emit('notify', { type: 'error', message: 'A interceptação de anomalias de rede precisa ser preenchida URL Regras de escuta.' });
                    return;
                }
                const statusCodes = String(trigger.status_codes || '').trim();
                if (!statusCodes) {
                    this.$emit('notify', { type: 'error', message: 'Preencha o código de status a ser interceptado (como 403,429,500）。' });
                    return;
                }
            }
            const periodicInterval = Number(trigger.periodic_interval_sec);
            if (!Number.isFinite(periodicInterval) || periodicInterval < 1) {
                this.$emit('notify', { type: 'error', message: 'O intervalo de detecção do período deve ser maior ou igual a 1 Número de segundos.' });
                return;
            }
            const periodicJitter = Number(trigger.periodic_jitter_sec);
            if (!Number.isFinite(periodicJitter) || periodicJitter < 0) {
                this.$emit('notify', { type: 'error', message: 'O jitter de detecção de período deve ser maior ou igual a 0 número.' });
                return;
            }
            const stableFor = Number(trigger.stable_for_sec);
            if (!Number.isFinite(stableFor) || stableFor < 0) {
                this.$emit('notify', { type: 'error', message: 'A duração do hit estável da página precisa ser maior ou igual a 0 número.' });
                return;
            }
            const priority = Number(trigger.priority);
            if (!Number.isInteger(priority)) {
                this.$emit('notify', { type: 'error', message: 'A prioridade do comando deve ser um número inteiro.' });
                return;
            }
            trigger.periodic_interval_sec = periodicInterval;
            trigger.periodic_jitter_sec = periodicJitter;
            trigger.stable_for_sec = stableFor;
            trigger.periodic_enabled = !!trigger.periodic_enabled;
            trigger.check_while_busy_workflow = !!trigger.check_while_busy_workflow;
            trigger.priority = priority;
            const presetActions = (this.editingCommand.actions || []).filter(action => ['execute_preset', 'execute_workflow'].includes(action.type));
            for (const action of presetActions) {
                action.preset_name = this.normalizePresetActionValue(action.preset_name);
            }
            const missingPreset = presetActions.some(action => !String(action.preset_name || '').trim());
            if (missingPreset) {
                this.$emit('notify', { type: 'error', message: '“Alternar predefinição/Executar fluxo de trabalho”A ação deve selecionar uma predefinição da lista de predefinições.' });
                return;
            }
            const webhookActions = (this.editingCommand.actions || []).filter(action => action.type === 'send_webhook');
            const invalidWebhook = webhookActions.find(action => !String(action.url || '').trim());
            if (invalidWebhook) {
                this.$emit('notify', { type: 'error', message: 'Webhook A ação deve preencher a solicitação URL。' });
                return;
            }
            const napcatActions = (this.editingCommand.actions || []).filter(action => action.type === 'send_napcat');
            const invalidNapcat = napcatActions.find(action => {
                const targetType = action.target_type === 'group' ? 'group' : 'private';
                const targetId = String(targetType === 'group' ? action.group_id : action.user_id || '').trim();
                return !String(action.base_url || '').trim() || !targetId || !String(action.message || '').trim();
            });
            if (invalidNapcat) {
                this.$emit('notify', { type: 'error', message: 'NapCat A ação deve preencher o endereço da interface e o destino QQ/Número do grupo e conteúdo da mensagem.' });
                return;
            }
            const groupActions = (this.editingCommand.actions || []).filter(action => action.type === 'execute_command_group');
            const invalidGroupAction = groupActions.find(action => !String(action.group_name || '').trim());
            if (invalidGroupAction) {
                this.$emit('notify', { type: 'error', message: '“Executar grupo de comando”A ação deve selecionar um grupo de comandos.' });
                return;
            }
            const clickElementAction = (this.editingCommand.actions || []).find(action =>
                action.type === 'click_element' && !String(action.selector || '').trim()
            );
            if (clickElementAction) {
                this.$emit('notify', { type: 'error', message: '“elemento de clique”A ação deve preencher o seletor de elementos.' });
                return;
            }
            const clickCoordinateAction = (this.editingCommand.actions || []).find(action => {
                if (action.type !== 'click_coordinates') return false;
                return !Number.isFinite(Number(action.x)) || !Number.isFinite(Number(action.y));
            });
            if (clickCoordinateAction) {
                this.$emit('notify', { type: 'error', message: '“Clique nas coordenadas”A ação deve ser preenchida com um documento válido X / Y coordenada.' });
                return;
            }
            if (trigger.type === 'network_request_error') {
                trigger.value = trigger.url_pattern || '';
            } else if (trigger.type === 'command_result_match') {
                trigger.value = '';
            } else if (trigger.type === 'command_result_event') {
                trigger.value = '';
            }
            this.editingCommand.group_name = String(this.editingCommand.group_name || '').trim();
            this.editingCommand.actions = (this.editingCommand.actions || [])
                .map((action, index) => this.normalizeAction(action, index));
            try {
                if (this.isNew) {
                    await this.apiRequest('/api/commands', {
                        method: 'POST',
                        body: JSON.stringify(this.editingCommand)
                    });
                    this.$emit('notify', { type: 'success', message: 'Comando criado' });
                } else {
                    await this.apiRequest('/api/commands/' + this.editingCommand.id, {
                        method: 'PUT',
                        body: JSON.stringify(this.editingCommand)
                    });
                    this.$emit('notify', { type: 'success', message: 'O comando foi atualizado' });
                }
                this.showEditor = false;
                await this.fetchCommands();
            } catch (e) {
                this.$emit('notify', { type: 'error', message: 'Falha ao salvar: ' + e.message });
            }
        },

        async deleteCommand(cmd) {
            if (!confirm('Confirme o comando de exclusão "' + cmd.name + '」?')) return;
            try {
                await this.apiRequest('/api/commands/' + cmd.id, { method: 'DELETE' });
                this.$emit('notify', { type: 'success', message: 'comando excluído' });
                await this.fetchCommands();
            } catch (e) {
                this.$emit('notify', { type: 'error', message: 'Falha na exclusão: ' + e.message });
            }
        },

        async toggleCommand(cmd) {
            try {
                await this.apiRequest('/api/commands/' + cmd.id, {
                    method: 'PUT',
                    body: JSON.stringify({ enabled: !cmd.enabled })
                });
                await this.fetchCommands();
            } catch (e) {
                this.$emit('notify', { type: 'error', message: 'Falha na troca: ' + e.message });
            }
        },

        async testCommand(cmd) {
            try {
                const result = await this.apiRequest('/api/commands/' + cmd.id + '/test', { method: 'POST' });
                this.$emit('notify', { type: 'success', message: result.message || 'comando executado' });
            } catch (e) {
                this.$emit('notify', { type: 'error', message: 'Falha na execução: ' + e.message });
            }
        },

        syncGroupCollapseState() {
            const next = {};
            for (const group of (this.commandGroups || [])) {
                if (Object.prototype.hasOwnProperty.call(this.collapsedGroups, group.name)) {
                    next[group.name] = !!this.collapsedGroups[group.name];
                } else {
                    next[group.name] = true;
                }
            }
            this.collapsedGroups = next;
        },

        isGroupCollapsed(groupName) {
            const key = String(groupName || '').trim();
            if (!key) return false;
            if (!Object.prototype.hasOwnProperty.call(this.collapsedGroups, key)) {
                return true;
            }
            return !!this.collapsedGroups[key];
        },

        toggleGroupCollapse(groupName) {
            const key = String(groupName || '').trim();
            if (!key) return;
            this.collapsedGroups = {
                ...this.collapsedGroups,
                [key]: !this.isGroupCollapsed(key)
            };
            this.closeBulkActionMenu();
            this.closeGroupActionMenu();
        },

        isBulkActionMenuOpen() {
            return !!this.bulkActionMenuOpen;
        },

        toggleBulkActionMenu() {
            const next = !this.bulkActionMenuOpen;
            this.bulkActionMenuOpen = next;
            if (next) {
                this.closeGroupActionMenu();
            }
        },

        closeBulkActionMenu() {
            this.bulkActionMenuOpen = false;
        },

        isGroupActionMenuOpen(groupName) {
            return String(this.groupActionMenuOpen || '').trim() === String(groupName || '').trim();
        },

        toggleGroupActionMenu(groupName) {
            const key = String(groupName || '').trim();
            if (!key) return;
            this.closeBulkActionMenu();
            this.groupActionMenuOpen = this.isGroupActionMenuOpen(key) ? '' : key;
        },

        closeGroupActionMenu() {
            this.groupActionMenuOpen = '';
        },

        isCommandSelected(commandId) {
            return (this.selectedCommandIds || []).includes(commandId);
        },

        getSelectedCount(items) {
            const ids = Array.isArray(items)
                ? items.map(item => typeof item === 'object' ? item?.id : item).filter(Boolean)
                : [];
            if (ids.length === 0) return 0;
            const selectedSet = new Set(this.selectedCommandIds || []);
            return ids.filter(id => selectedSet.has(id)).length;
        },

        isGroupFullySelected(commands) {
            const ids = Array.isArray(commands)
                ? commands.map(cmd => cmd?.id).filter(Boolean)
                : [];
            if (ids.length === 0) return false;
            const selectedSet = new Set(this.selectedCommandIds || []);
            return ids.every(id => selectedSet.has(id));
        },

        getGroupSelectionActionLabel(commands) {
            return this.isGroupFullySelected(commands) ? 'Desmarque todo o grupo' : 'Selecione todo o grupo';
        },

        toggleGroupSelection(commands) {
            const ids = Array.isArray(commands)
                ? commands.map(cmd => cmd?.id).filter(Boolean)
                : [];
            if (ids.length === 0) return;
            const selectedSet = new Set(this.selectedCommandIds || []);
            const allSelected = ids.every(id => selectedSet.has(id));
            if (allSelected) {
                ids.forEach(id => selectedSet.delete(id));
            } else {
                ids.forEach(id => selectedSet.add(id));
            }
            this.selectedCommandIds = Array.from(selectedSet);
            this.showGroupTools = true;
            this.closeGroupActionMenu();
        },

        toggleCommandSelection(commandId) {
            const selectedSet = new Set(this.selectedCommandIds || []);
            if (selectedSet.has(commandId)) {
                selectedSet.delete(commandId);
            } else {
                selectedSet.add(commandId);
            }
            this.selectedCommandIds = Array.from(selectedSet);
            this.showGroupTools = true;
        },

        toggleCurrentPageSelection() {
            const pageIds = this.visiblePageCommandIds || [];
            if (pageIds.length === 0) return;
            const selectedSet = new Set(this.selectedCommandIds || []);
            const allSelected = pageIds.every(id => selectedSet.has(id));
            if (allSelected) {
                pageIds.forEach(id => selectedSet.delete(id));
            } else {
                pageIds.forEach(id => selectedSet.add(id));
            }
            this.selectedCommandIds = Array.from(selectedSet);
            this.showGroupTools = true;
        },

        clearSelection() {
            this.selectedCommandIds = [];
        },

        getNextDefaultGroupName() {
            const existing = new Set(this.commandGroups.map(group => group.name));
            let idx = 1;
            while (existing.has('grupo de comando' + idx)) {
                idx += 1;
            }
            return 'grupo de comando' + idx;
        },

        clearGroupDragState() {
            this.draggingCommandId = '';
            this.dragOverGroupName = '';
        },

        beginGroupDrag(commandId, event) {
            if (this.groupWorking) return;
            this.draggingCommandId = String(commandId || '').trim();
            this.dragOverGroupName = '';
            if (this.draggingCommandId) {
                this.showGroupTools = true;
            }
            if (event?.dataTransfer && this.draggingCommandId) {
                event.dataTransfer.setData('text/plain', this.draggingCommandId);
                event.dataTransfer.effectAllowed = 'move';
            }
        },

        isGroupDropTarget(groupName) {
            const name = String(groupName || '').trim();
            return !!name && name === String(this.dragOverGroupName || '').trim();
        },

        onGroupDragOver(groupName, event) {
            if (this.groupWorking) return;
            if (!String(this.draggingCommandId || '').trim()) return;
            const name = String(groupName || '').trim();
            if (!name) return;
            this.dragOverGroupName = name;
            if (event?.dataTransfer) {
                event.dataTransfer.dropEffect = 'move';
            }
        },

        onGroupDragLeave(groupName) {
            const name = String(groupName || '').trim();
            if (!name) return;
            if (this.dragOverGroupName === name) {
                this.dragOverGroupName = '';
            }
        },

        async assignCommandsToGroup(commandIds, groupName, successPrefix = 'Agrupamento de comandos atualizado') {
            const ids = Array.isArray(commandIds)
                ? commandIds.map(id => String(id || '').trim()).filter(Boolean)
                : [];
            const normalizedGroup = String(groupName || '').trim();
            if (ids.length === 0) {
                this.$emit('notify', { type: 'error', message: 'Não há comandos para atualizar.' });
                return 0;
            }

            this.groupWorking = true;
            try {
                const result = await this.apiRequest('/api/command-groups', {
                    method: 'PUT',
                    body: JSON.stringify({
                        command_ids: ids,
                        group_name: normalizedGroup
                    })
                });
                const updated = Number(result.updated || 0);
                this.$emit('notify', {
                    type: updated > 0 ? 'success' : 'error',
                    message: successPrefix + '（' + updated + ' tira)'
                });
                if (normalizedGroup) {
                    this.pendingGroupName = normalizedGroup;
                    this.selectedExistingGroupName = normalizedGroup;
                }
                await this.fetchCommands();
                return updated;
            } catch (e) {
                this.$emit('notify', { type: 'error', message: 'Falha na atualização do grupo: ' + e.message });
                return 0;
            } finally {
                this.groupWorking = false;
                this.clearGroupDragState();
            }
        },

        async onGroupDrop(groupName) {
            const targetGroup = String(groupName || '').trim();
            const commandId = String(this.draggingCommandId || '').trim();
            this.clearGroupDragState();
            if (!targetGroup || !commandId || this.groupWorking) return;
            const command = (this.commands || []).find(item => item.id === commandId);
            if (!command) return;

            const currentGroup = String(command.group_name || '').trim();
            if (currentGroup === targetGroup) {
                this.$emit('notify', { type: 'success', message: 'O comando já está no grupo de comandos:' + targetGroup });
                return;
            }

            await this.assignCommandsToGroup(
                [commandId],
                targetGroup,
                'Arrastado para ingressar no grupo de comandos:' + targetGroup
            );
        },

        async assignSelectedToGroup() {
            if (!this.hasSelection) {
                this.$emit('notify', { type: 'error', message: 'Por favor, verifique o comando primeiro.' });
                return;
            }
            const groupName = String(this.pendingGroupName || '').trim() || this.getNextDefaultGroupName();
            await this.assignCommandsToGroup(
                this.selectedCommandIds,
                groupName,
                'Já incluído no grupo de comando:' + groupName
            );
        },

        async assignSelectedToExistingGroup() {
            if (!this.hasSelection) {
                this.$emit('notify', { type: 'error', message: 'Por favor, verifique o comando primeiro.' });
                return;
            }
            const groupName = String(this.selectedExistingGroupName || '').trim();
            if (!groupName) {
                this.$emit('notify', { type: 'error', message: 'Selecione primeiro um grupo de comandos existente.' });
                return;
            }
            await this.assignCommandsToGroup(
                this.selectedCommandIds,
                groupName,
                'Já ingressou no grupo de comando existente:' + groupName
            );
        },

        async renameSelectedGroup() {
            const sourceName = String(this.selectedExistingGroupName || '').trim();
            const targetName = String(this.pendingGroupName || '').trim();
            if (!sourceName) {
                this.$emit('notify', { type: 'error', message: 'Selecione o grupo de comandos para renomear primeiro.' });
                return;
            }
            if (!targetName) {
                this.$emit('notify', { type: 'error', message: 'Insira um novo nome de grupo de comandos.' });
                return;
            }
            if (sourceName === targetName) {
                this.$emit('notify', { type: 'warning', message: 'Os grupos de comandos antigos e novos têm o mesmo nome e não precisam ser renomeados.' });
                return;
            }
            if ((this.commandGroups || []).some(group => group.name === targetName)) {
                this.$emit('notify', { type: 'error', message: 'O nome do grupo de comandos de destino já existe.' });
                return;
            }

            const sourceGroup = (this.commandGroups || []).find(group => group.name === sourceName);
            const commandIds = Array.isArray(sourceGroup?.commandIds) ? sourceGroup.commandIds : [];
            if (commandIds.length === 0) {
                this.$emit('notify', { type: 'error', message: 'O conteúdo do grupo de comandos a ser renomeado não foi encontrado.' });
                return;
            }

            const updated = await this.assignCommandsToGroup(
                commandIds,
                targetName,
                'O grupo de comando foi renomeado:' + sourceName + ' -> ' + targetName
            );
            if (updated > 0) {
                this.selectedExistingGroupName = targetName;
                this.pendingGroupName = targetName;
            }
        },

        async ungroupSelectedCommands() {
            if (!this.hasSelection) {
                this.$emit('notify', { type: 'error', message: 'Por favor, verifique o comando primeiro.' });
                return;
            }
            await this.assignCommandsToGroup(
                this.selectedCommandIds,
                '',
                'O grupo de comandos selecionados foi descartado'
            );
        },

        async setCommandsEnabled(commandIds, enabled, successPrefix, errorPrefix = 'Falha no status do comando de atualização em lote') {
            const ids = Array.isArray(commandIds)
                ? commandIds.map(id => String(id || '').trim()).filter(Boolean)
                : [];
            if (ids.length === 0) {
                this.$emit('notify', { type: 'error', message: 'Não há comandos para atualizar.' });
                return 0;
            }

            this.groupWorking = true;
            try {
                const result = await this.apiRequest('/api/commands/enabled', {
                    method: 'PUT',
                    body: JSON.stringify({
                        command_ids: ids,
                        enabled: !!enabled
                    })
                });
                const updated = Number(result.updated || 0);
                this.$emit('notify', {
                    type: updated > 0 ? 'success' : 'warning',
                    message: successPrefix + '（' + updated + ' tira)'
                });
                await this.fetchCommands();
                return updated;
            } catch (e) {
                this.$emit('notify', { type: 'error', message: errorPrefix + ': ' + e.message });
                return 0;
            } finally {
                this.groupWorking = false;
            }
        },

        async disableAllCommands() {
            const commandIds = (this.commands || [])
                .map(cmd => cmd?.id)
                .filter(Boolean);
            if (commandIds.length === 0) {
                this.$emit('notify', { type: 'warning', message: 'Atualmente não há comandos para desativar.' });
                return;
            }
            if (!confirm('Tem certeza de que deseja desativar todos os comandos atuais?')) return;
            this.closeBulkActionMenu();
            await this.setCommandsEnabled(
                commandIds,
                false,
                'Todos os comandos desativados',
                'Falha ao desativar todos'
            );
        },

        async enableAllDisabledCommands() {
            const disabledIds = (this.commands || [])
                .filter(cmd => cmd && cmd.enabled === false)
                .map(cmd => cmd.id)
                .filter(Boolean);
            if (disabledIds.length === 0) {
                this.$emit('notify', { type: 'warning', message: 'Atualmente não há comandos desabilitados.' });
                return;
            }
            if (!confirm('Tem certeza de que deseja desbloquear todos os comandos atualmente desativados?')) return;
            this.closeBulkActionMenu();
            await this.setCommandsEnabled(
                disabledIds,
                true,
                'Todas as ordens de proibição foram suspensas',
                'Todos os desbloqueios falharam'
            );
        },

        async setGroupEnabled(groupName, enabled) {
            const name = String(groupName || '').trim();
            if (!name) return 0;
            const actionText = enabled ? 'habilitar' : 'Desativar';
            if (!confirm('Claro' + actionText + 'Grupo de comando "' + name + '」?')) return 0;

            this.groupWorking = true;
            try {
                const result = await this.apiRequest('/api/command-groups/' + encodeURIComponent(name) + '/enabled', {
                    method: 'PUT',
                    body: JSON.stringify({
                        enabled: !!enabled
                    })
                });
                const updated = Number(result.updated || 0);
                this.$emit('notify', {
                    type: updated > 0 ? 'success' : 'warning',
                    message: 'O grupo de comando tem' + actionText + '：' + name + '（' + updated + ' tira)'
                });
                await this.fetchCommands();
                return updated;
            } catch (e) {
                this.$emit('notify', { type: 'error', message: actionText + 'Grupo de comando falhou: ' + e.message });
                return 0;
            } finally {
                this.groupWorking = false;
            }
        },

        async disableGroup(groupName) {
            this.closeGroupActionMenu();
            await this.setGroupEnabled(groupName, false);
        },

        async enableGroup(groupName) {
            this.closeGroupActionMenu();
            await this.setGroupEnabled(groupName, true);
        },

        async disbandGroup(groupName) {
            const name = String(groupName || '').trim();
            if (!name) return;
            this.closeGroupActionMenu();
            if (!confirm('Determinado a dissolver o grupo de comando"' + name + '」?')) return;
            this.groupWorking = true;
            try {
                const result = await this.apiRequest('/api/command-groups/' + encodeURIComponent(name), {
                    method: 'DELETE'
                });
                this.$emit('notify', {
                    type: 'success',
                    message: 'O grupo de comando foi dissolvido:' + name + '（' + (result.updated || 0) + ' tira)'
                });
                await this.fetchCommands();
            } catch (e) {
                this.$emit('notify', { type: 'error', message: 'Falha ao dissolver o grupo de comando: ' + e.message });
            } finally {
                this.groupWorking = false;
            }
        },

        async runGroup(groupName) {
            const name = String(groupName || '').trim();
            if (!name) return;
            this.closeGroupActionMenu();
            this.groupWorking = true;
            try {
                const result = await this.apiRequest('/api/command-groups/' + encodeURIComponent(name) + '/execute', {
                    method: 'POST',
                    body: JSON.stringify({
                        include_disabled: !!this.includeDisabledWhenRunGroup,
                        acquire_policy: this.runGroupAcquirePolicy || 'inherit_session'
                    })
                });
                const executed = result.executed || 0;
                const total = result.total || 0;
                const failures = result.failures || 0;
                this.$emit('notify', {
                    type: result.ok ? 'success' : (result.partial_ok ? 'warning' : 'error'),
                    message: result.ok
                        ? ('O grupo de comandos foi executado:' + name + '（sucesso ' + executed + ' / ' + total + '）')
                        : (result.partial_ok
                            ? ('O grupo de comandos foi parcialmente bem-sucedido:' + name + '（sucesso ' + executed + ' / ' + total + '，falhar ' + failures + '）')
                            : ('Falha na execução do grupo de comandos:' + name + '（sucesso ' + executed + ' / ' + total + '，falhar ' + failures + '）'))
                });
            } catch (e) {
                this.$emit('notify', { type: 'error', message: 'Falha ao executar o grupo de comandos: ' + e.message });
            } finally {
                this.groupWorking = false;
            }
        },

        ensureValidPage() {
            if (this.currentPage > this.totalPages) {
                this.currentPage = this.totalPages;
            }
            if (this.currentPage < 1) {
                this.currentPage = 1;
            }
        },

        applyPageSize() {
            const value = Number(this.pageSize);
            if (!Number.isFinite(value) || value <= 0) {
                this.pageSize = 16;
            } else {
                this.pageSize = Math.min(500, Math.floor(value));
            }
            this.changePage(1);
        },

        changePage(page) {
            const nextPage = Math.min(this.totalPages, Math.max(1, page));
            this.currentPage = nextPage;
        },

        getCommandOrder(commandId) {
            return this.commands.findIndex(cmd => cmd.id === commandId) + 1;
        },

        toggleHelp() {
            this.showHelpTip = !this.showHelpTip;
        },

        async moveCommand(cmd, direction) {
            if (this.reordering) return;
            const index = this.commands.findIndex(item => item.id === cmd.id);
            if (index < 0) return;

            const targetIndex = index + direction;
            if (targetIndex < 0 || targetIndex >= this.commands.length) return;

            const previous = this.commands.slice();
            const next = this.commands.slice();
            const [moved] = next.splice(index, 1);
            next.splice(targetIndex, 0, moved);
            this.commands = next;
            this.reordering = true;

            try {
                await this.apiRequest('/api/commands/reorder', {
                    method: 'PUT',
                    body: JSON.stringify({ command_ids: next.map(item => item.id) })
                });
                this.ensureValidPage();
            } catch (e) {
                this.commands = previous;
                this.$emit('notify', { type: 'error', message: 'Falha na atualização de classificação: ' + e.message });
            } finally {
                this.reordering = false;
            }
        },

        getTriggerLabel(type) {
            return (this.meta.trigger_types || {})[type] || type;
        },

        getActionLabel(type) {
            return (this.meta.action_types || {})[type] || type;
        },

        getScopeLabel(scope) {
            const map = { all: 'Todas as guias', domain: 'Especifique o nome de domínio', tab: 'Especifique a página da guia' };
            return map[scope] || scope;
        },

        formatTime(ts) {
            if (!ts) return 'nunca';
            return new Date(ts * 1000).toLocaleString();
        }
};
