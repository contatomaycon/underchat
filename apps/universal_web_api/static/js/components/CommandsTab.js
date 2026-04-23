// ==================== Componente de gerenciamento de comando ====================
window.CommandsTabComponent = {
    name: 'CommandsTabComponent',
    props: {
        darkMode: { type: Boolean, default: false }
    },
    data() {
        return {
            commands: [],
            loading: false,
            meta: { trigger_types: {}, action_types: {} },
            availableDomains: [],
            availableTabs: [],
            availablePresets: [],
            presetLoading: false,
            showHelpTip: false,
            currentPage: 1,
            pageSize: 16,
            pageSizeOptions: [8, 16, 24, 32, 48, 64],
            reordering: false,
            selectedCommandIds: [],
            pendingGroupName: '',
            selectedExistingGroupName: '',
            groupWorking: false,
            includeDisabledWhenRunGroup: false,
            runGroupAcquirePolicy: 'inherit_session',
            showGroupTools: false,
            collapsedGroups: {},
            bulkActionMenuOpen: false,
            groupActionMenuOpen: '',
            draggingCommandId: '',
            dragOverGroupName: '',
            sourceCommandPickerOpen: false,
            sourceCommandSearch: '',
            sourcePickerExpandedGroups: {},
            sourcePickerShowUngrouped: false,

            // Editar janela pop-up             showEditor: false,
            editingCommand: null,
            isNew: false,

            // Altura do editor de modo avançado             scriptEditorHeight: '300px',

            // Configuração padrão de comutação de agente             proxyDefaults: {
                clash_api: 'http://127.0.0.1:9090',
                clash_secret: '',
                selector: 'Proxy',
                mode: 'random',
                node_name: '',
                exclude_keywords: 'DIRECT,REJECT,GLOBAL,seleção automática,failover',
                refresh_after: true
            },
            webhookDefaults: {
                method: 'POST',
                url: '',
                payload: '{"msg":"página da guia#{{tab_index}} existir {{domain}} Código de status de exceção de hit {{network_status}}"}',
                headers: '{"Content-Type":"application/json"}',
                timeout: 8,
                raise_for_status: false
            },
            napcatDefaults: {
                base_url: 'http://127.0.0.1:3000',
                target_type: 'private',
                user_id: '',
                group_id: '',
                message: 'Notificação de comando:{{source_command_name}}\\n{{command_result_summary}}',
                access_token: '',
                timeout: 8,
                raise_for_status: true
            },
            releaseLockDefaults: {
                reason: 'release_tab_lock_action',
                clear_page: true,
                stop_actions: true
            }
        };
    },
    computed: window.CommandsTabComputed,

    methods: window.CommandsTabMethods,

    mounted() {
        this.fetchMeta();
        this.fetchCommands();
        this.fetchBindingMeta();
    },
    template: window.CommandsTabTemplate
};
