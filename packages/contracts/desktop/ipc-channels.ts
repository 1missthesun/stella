export const IPC_WINDOW_MINIMIZE = "window:minimize" as const;
export const IPC_WINDOW_MAXIMIZE = "window:maximize" as const;
export const IPC_WINDOW_CLOSE = "window:close" as const;
export const IPC_WINDOW_IS_MAXIMIZED = "window:isMaximized" as const;
export const IPC_WINDOW_SHOW = "window:show" as const;
export const IPC_WINDOW_SET_NATIVE_BUTTONS_VISIBLE =
  "window:setNativeButtonsVisible" as const;

export const IPC_DISPLAY_UPDATE = "display:update" as const;
export const IPC_DISPLAY_READ_FILE = "display:readFile" as const;
export const IPC_DISPLAY_MEDIA_SOURCE = "display:mediaSource" as const;
export const IPC_DISPLAY_STAT_PATH = "display:statPath" as const;
export const IPC_DISPLAY_LIST_FOLDER = "display:listFolder" as const;
export const IPC_DISPLAY_SET_SELECTED_DEVICE =
  "display:setSelectedDevice" as const;
export const IPC_DISPLAY_LIST_CANVAS_HTML = "display:listCanvasHtml" as const;
export const IPC_DISPLAY_CANVAS_HTML_CHANGED =
  "display:canvasHtmlChanged" as const;
export const IPC_DISPLAY_OPEN_SHARED_CANVAS =
  "display:openSharedCanvas" as const;
export const IPC_DISPLAY_OPEN_SHARE_LINK = "display:openShareLink" as const;
export const IPC_DISPLAY_CANVAS_FILE_URL = "display:canvasFileUrl" as const;
export const IPC_DISPLAY_CANVAS_HTML_URL = "display:canvasHtmlUrl" as const;
export const IPC_DISPLAY_CANVAS_DRIVE_URL = "display:canvasDriveUrl" as const;
export const IPC_DISPLAY_TRASH_LIST = "displayTrash:list" as const;
export const IPC_DISPLAY_TRASH_FORCE_DELETE =
  "displayTrash:forceDelete" as const;
export const IPC_OFFICE_PREVIEW_LIST = "officePreview:list" as const;
export const IPC_OFFICE_PREVIEW_START = "officePreview:start" as const;
export const IPC_OFFICE_PREVIEW_UPDATE = "officePreview:update" as const;
export const IPC_CHAT_EVIDENCE_CARDS = "chatEvidence:cards" as const;
export const IPC_CHAT_EVIDENCE_DRIVE_CARDS = "chatEvidence:driveCards" as const;

export const IPC_EXECUTION_REMOTE_REQUEST =
  "execution:remoteExecutionRequest" as const;
export const IPC_EXECUTION_ANSWER_REMOTE_REQUEST =
  "execution:answerRemoteExecutionRequest" as const;
export const IPC_EXECUTION_PENDING_REMOTE_REQUEST =
  "execution:pendingRemoteExecutionRequest" as const;
export const IPC_EXECUTION_TARGET_SET = "execution:targetSet" as const;

export const IPC_UI_GET_STATE = "ui:getState" as const;
export const IPC_UI_SET_STATE = "ui:setState" as const;
export const IPC_UI_STATE = "ui:state" as const;

export const IPC_UI_STATE_KV_SNAPSHOT = "uiState:snapshot" as const;
export const IPC_UI_STATE_KV_APPLY = "uiState:apply" as const;
export const IPC_UI_STATE_KV_CLEAR = "uiState:clear" as const;
export const IPC_UI_STATE_KV_CHANGED = "uiState:changed" as const;
export const IPC_APP_SET_READY = "app:setReady" as const;
export const IPC_APP_RELOAD = "app:reload" as const;
export const IPC_APP_RELAUNCH = "app:relaunch" as const;
export const IPC_APP_HARD_RESET = "app:hardResetLocalState" as const;

export const IPC_APP_SOURCE_GET_STATE = "appSource:getState" as const;
export const IPC_APP_SOURCE_STATE = "appSource:state" as const;
export const IPC_APP_SOURCE_APPLY = "appSource:apply" as const;
export const IPC_APP_SOURCE_UNDO = "appSource:undo" as const;
export const IPC_APP_SOURCE_APPLY_REMOTE = "appSource:applyRemote" as const;
export const IPC_APP_SOURCE_APPLY_UPSTREAM = "appSource:applyUpstream" as const;
export const IPC_APP_SOURCE_SKIP = "appSource:skip" as const;

export const IPC_CHAT_CONTEXT_GET = "chatContext:get" as const;
export const IPC_CHAT_CONTEXT_SET = "chatContext:set" as const;
export const IPC_CHAT_CONTEXT_UPDATED = "chatContext:updated" as const;
export const IPC_CHAT_CONTEXT_REMOVE_SCREENSHOT =
  "chatContext:removeScreenshot" as const;
export const IPC_SCREENSHOT_CAPTURE = "screenshot:capture" as const;
export const IPC_REGION_SELECT = "region:select" as const;
export const IPC_REGION_PREPARE_SELECTION = "region:prepareSelection" as const;
export const IPC_REGION_COMMIT_PREPARED = "region:commitPrepared" as const;
export const IPC_REGION_CLICK = "region:click" as const;
export const IPC_REGION_GET_WINDOW_CAPTURE = "region:getWindowCapture" as const;
export const IPC_REGION_CANCEL = "region:cancel" as const;
export const IPC_CAPTURE_REGION_FAILED = "capture:regionCaptureFailed" as const;
export const IPC_CAPTURE_BEGIN_REGION_CAPTURE =
  "capture:beginRegionCapture" as const;

export const IPC_OVERLAY_SET_INTERACTIVE = "overlay:setInteractive" as const;
export const IPC_OVERLAY_START_REGION_CAPTURE =
  "overlay:startRegionCapture" as const;
export const IPC_OVERLAY_END_REGION_CAPTURE =
  "overlay:endRegionCapture" as const;

export const IPC_OVERLAY_WINDOW_HIGHLIGHT = "overlay:windowHighlight" as const;
export const IPC_OVERLAY_HIDE_WINDOW_HIGHLIGHT =
  "overlay:hideWindowHighlight" as const;
export const IPC_OVERLAY_PREVIEW_WINDOW_HIGHLIGHT_AT_POINT =
  "overlay:previewWindowHighlightAtPoint" as const;


export const IPC_THEME_LIST_INSTALLED = "theme:listInstalled" as const;

export const IPC_WEBSITE_GET_BASE_URL = "website:getBaseUrl" as const;

export const IPC_SELF_HOST_GET_STATE = "selfHost:getState" as const;
export const IPC_SELF_HOST_TAKE_PENDING_LINK = "selfHost:takePendingLink" as const;
export const IPC_SELF_HOST_INSPECT_LINK = "selfHost:inspectLink" as const;
export const IPC_SELF_HOST_CONNECT = "selfHost:connect" as const;
export const IPC_SELF_HOST_USE_DEFAULT = "selfHost:useDefault" as const;
export const IPC_SELF_HOST_LIST_SERVERS = "selfHost:listServers" as const;
export const IPC_SELF_HOST_SWITCH_SERVER = "selfHost:switchServer" as const;
export const IPC_SELF_HOST_REMOVE_SERVER = "selfHost:removeServer" as const;
export const IPC_SELF_HOST_START_PAIRING = "selfHost:startPairing" as const;
export const IPC_SELF_HOST_PAIRING_STATUS = "selfHost:pairingStatus" as const;
export const IPC_SELF_HOST_CANCEL_PAIRING = "selfHost:cancelPairing" as const;
export const IPC_SELF_HOST_PAIR_LINK = "selfHost:pairLink" as const;

export const IPC_VOICE_PERSIST_TRANSCRIPT = "voice:persistTranscript" as const;
export const IPC_VOICE_ORCHESTRATOR_CHAT = "voice:orchestratorChat" as const;
export const IPC_VOICE_ORCHESTRATOR_CONFIG =
  "voice:orchestratorConfig" as const;
export const IPC_VOICE_ORCHESTRATOR_ACTIVITY =
  "voice:orchestratorActivity" as const;
export const IPC_VOICE_CREATE_OPENAI_SESSION =
  "voice:createOpenAISession" as const;
export const IPC_VOICE_CREATE_XAI_SESSION = "voice:createXaiSession" as const;
export const IPC_VOICE_GET_RUNTIME_STATE = "voice:getRuntimeState" as const;
export const IPC_VOICE_RUNTIME_STATE = "voice:runtimeState" as const;
export const IPC_VOICE_RTC_SET_SHORTCUT = "voice-rtc:setShortcut" as const;
export const IPC_VOICE_RTC_GET_SHORTCUT = "voice-rtc:getShortcut" as const;
export const IPC_VOICE_RTC_TOGGLE = "voice-rtc:toggle" as const;
export const IPC_VOICE_REPORT_SESSION_ERROR =
  "voice:reportSessionError" as const;
export const IPC_VOICE_SESSION_ERROR = "voice:sessionError" as const;
export const IPC_VOICE_REPORT_SESSION_ERROR_STATE =
  "voice:reportSessionErrorState" as const;
export const IPC_VOICE_GET_SESSION_ERROR_STATE =
  "voice:getSessionErrorState" as const;
export const IPC_VOICE_SESSION_ERROR_STATE = "voice:sessionErrorState" as const;
export const IPC_VOICE_PREFERENCES_CHANGED =
  "voice:preferencesChanged" as const;

export const IPC_DICTATION_TOGGLE = "dictation:toggle" as const;
export const IPC_DICTATION_SET_SHORTCUT = "dictation:setShortcut" as const;
export const IPC_DICTATION_GET_SHORTCUT = "dictation:getShortcut" as const;
export const IPC_DICTATION_GET_SOUND_EFFECTS_ENABLED =
  "dictation:getSoundEffectsEnabled" as const;
export const IPC_DICTATION_SET_SOUND_EFFECTS_ENABLED =
  "dictation:setSoundEffectsEnabled" as const;
export const IPC_DICTATION_HAS_OPENROUTER_KEY =
  "dictation:hasOpenRouterKey" as const;
export const IPC_DICTATION_TRANSCRIBE_WITH_OPENROUTER =
  "dictation:transcribeWithOpenRouter" as const;
export const IPC_DICTATION_CANCEL_OPENROUTER =
  "dictation:cancelOpenRouter" as const;
export const IPC_DICTATION_ACTIVE_CHANGED = "dictation:activeChanged" as const;
export const IPC_DICTATION_PLAY_SOUND = "dictation:playSound" as const;

export const IPC_AGENT_SEND_INPUT = "agent:sendInput" as const;
export const IPC_PI_CHAT_REQUEST = "piChat:request" as const;
export const IPC_PI_CHAT_EVENTS = "piChat:events" as const;
export const IPC_RUNTIME_AVAILABILITY = "runtime:availability" as const;
export const IPC_PREFERENCES_MODELS_UPDATED =
  "preferences:modelsUpdated" as const;

export const IPC_DEVICE_GET_ID = "device:getId" as const;
export const IPC_AUTH_GET_CHALLENGE_TOKEN = "auth:getChallengeToken" as const;
export const IPC_HOST_CONFIGURE_RUNTIME = "host:configurePiRuntime" as const;
export const IPC_AUTH_GET_SESSION = "auth:getSession" as const;
export const IPC_AUTH_SIGN_OUT = "auth:signOut" as const;
export const IPC_AUTH_DELETE_USER = "auth:deleteUser" as const;
export const IPC_AUTH_APPLY_SESSION_TOKEN = "auth:applySessionToken" as const;
export const IPC_AUTH_GET_TOKEN = "auth:getToken" as const;
export const IPC_AUTH_REVOKE_SESSIONS = "auth:revokeSessions" as const;
export const IPC_AUTH_LIST_SESSIONS = "auth:listSessions" as const;
export const IPC_AUTH_REVOKE_SESSION = "auth:revokeSession" as const;
export const IPC_HOST_SET_CLOUD_SYNC = "host:setCloudSyncEnabled" as const;

export const IPC_AUTH_SESSION_INVALIDATED = "auth:sessionInvalidated" as const;
export const IPC_APP_QUIT_FOR_RESTART = "app:quitForRestart" as const;
export const IPC_PERMISSIONS_GET_STATUS = "permissions:getStatus" as const;
export const IPC_PERMISSIONS_OPEN_SETTINGS =
  "permissions:openSettings" as const;
export const IPC_PERMISSIONS_REQUEST = "permissions:request" as const;
export const IPC_PERMISSIONS_RESET_MICROPHONE =
  "permissions:resetMicrophone" as const;
export const IPC_PERMISSIONS_RESET = "permissions:reset" as const;
export const IPC_SHELL_OPEN_EXTERNAL = "shell:openExternal" as const;
export const IPC_SHELL_SHOW_IN_FOLDER = "shell:showItemInFolder" as const;
export const IPC_SHELL_SAVE_FILE_AS = "shell:saveFileAs" as const;
export const IPC_SHELL_LIST_OPENERS = "shell:listExternalOpeners" as const;
export const IPC_SHELL_OPEN_WITH = "shell:openWithExternal" as const;
export const IPC_SHELL_OPEN_PATH = "shell:openPath" as const;
export const IPC_PREFERENCES_GET_MODELS =
  "preferences:getLocalModelPreferences" as const;
export const IPC_PREFERENCES_SET_MODELS =
  "preferences:setLocalModelPreferences" as const;
export const IPC_PREFERENCES_LIST_MODELS = "preferences:listModels" as const;
export const IPC_CHATGPT_LIST_MODELS = "chatgpt:listModels" as const;
export const IPC_PREFERENCES_LIST_CLAUDE_CODE_MODELS =
  "preferences:listClaudeCodeModels" as const;
export const IPC_PREFERENCES_GET_PREVENT_SLEEP =
  "preferences:getPreventSleep" as const;
export const IPC_PREFERENCES_SET_PREVENT_SLEEP =
  "preferences:setPreventSleep" as const;
export const IPC_PREFERENCES_GET_LOCKED_COMPUTER_USE =
  "preferences:getLockedComputerUse" as const;
export const IPC_PREFERENCES_SET_LOCKED_COMPUTER_USE =
  "preferences:setLockedComputerUse" as const;
export const IPC_PREFERENCES_GET_SOUND_NOTIFICATIONS =
  "preferences:getSoundNotifications" as const;
export const IPC_PREFERENCES_SET_SOUND_NOTIFICATIONS =
  "preferences:setSoundNotifications" as const;
export const IPC_PREFERENCES_GET_TELEMETRY =
  "preferences:getTelemetry" as const;
export const IPC_PREFERENCES_SET_TELEMETRY =
  "preferences:setTelemetry" as const;
export const IPC_PREFERENCES_GET_READ_ALOUD =
  "preferences:getReadAloud" as const;
export const IPC_PREFERENCES_SET_READ_ALOUD =
  "preferences:setReadAloud" as const;
export const IPC_PREFERENCES_READ_ALOUD_CHANGED =
  "preferences:readAloudChanged" as const;
export const IPC_PREFERENCES_GET_ONBOARDING_COMPLETED =
  "preferences:getOnboardingCompleted" as const;
export const IPC_PREFERENCES_SET_ONBOARDING_COMPLETED =
  "preferences:setOnboardingCompleted" as const;
export const IPC_GLOBAL_SHORTCUTS_SET_SUSPENDED =
  "globalShortcuts:setSuspended" as const;
export const IPC_DIAGNOSTICS_RECORD_HEAP_TRACE =
  "diagnostics:recordHeapTrace" as const;
export const IPC_DIAGNOSTICS_REPORT_ERROR = "diagnostics:reportError" as const;
export const IPC_DIAGNOSTICS_REPORT_TIMING =
  "diagnostics:reportTiming" as const;
export const IPC_DIAGNOSTICS_EXPORT_LOGS = "diagnostics:exportLogs" as const;
export const IPC_DIAGNOSTICS_OPEN_LOGS = "diagnostics:openLogs" as const;
export const IPC_PROMPT_PRESETS_LIST = "promptPresets:list" as const;
export const IPC_PROMPT_PRESETS_READ = "promptPresets:read" as const;
export const IPC_PROMPT_PRESETS_SAVE = "promptPresets:save" as const;
export const IPC_PROMPT_PRESETS_DELETE = "promptPresets:delete" as const;
export const IPC_PROMPT_PRESETS_SELECT = "promptPresets:select" as const;
export const IPC_CUSTOMIZATIONS_RESET = "customizations:reset" as const;
export const IPC_PREFERENCES_GET_WAKE_WORD = "preferences:getWakeWord" as const;
export const IPC_PREFERENCES_SET_WAKE_WORD = "preferences:setWakeWord" as const;
export const IPC_PREFERENCES_WAKE_WORD_CHANGED =
  "preferences:wakeWordChanged" as const;
export const IPC_LLM_CREDENTIALS_LIST = "llmCredentials:list" as const;
export const IPC_LLM_CREDENTIALS_LIST_OAUTH_PROVIDERS =
  "llmCredentials:listOAuthProviders" as const;
export const IPC_LLM_CREDENTIALS_LIST_OAUTH =
  "llmCredentials:listOAuth" as const;
export const IPC_LLM_CREDENTIALS_LOGIN_OAUTH =
  "llmCredentials:loginOAuth" as const;
export const IPC_LLM_CREDENTIALS_DELETE_OAUTH =
  "llmCredentials:deleteOAuth" as const;
export const IPC_LLM_CREDENTIALS_SAVE = "llmCredentials:save" as const;
export const IPC_LLM_CREDENTIALS_DELETE = "llmCredentials:delete" as const;
export const IPC_LLM_CREDENTIALS_CANCEL_OAUTH =
  "llmCredentials:cancelOAuth" as const;
export const IPC_LLM_CREDENTIALS_VALIDATE_OAUTH =
  "llmCredentials:validateOAuth" as const;
export const IPC_CLAUDE_ACCOUNTS_LIST = "claudeAccounts:list" as const;
export const IPC_CLAUDE_ACCOUNTS_START_LOGIN =
  "claudeAccounts:startLogin" as const;
export const IPC_CLAUDE_ACCOUNTS_WAIT_LOGIN =
  "claudeAccounts:waitLogin" as const;
export const IPC_CLAUDE_ACCOUNTS_FINISH_LOGIN =
  "claudeAccounts:finishLogin" as const;
export const IPC_CLAUDE_ACCOUNTS_CANCEL_LOGIN =
  "claudeAccounts:cancelLogin" as const;
export const IPC_CLAUDE_ACCOUNTS_SIGN_OUT = "claudeAccounts:signOut" as const;
export const IPC_CLAUDE_ACCOUNTS_CHANGED = "claudeAccounts:changed" as const;
export const IPC_ENGINE_ACCOUNTS_CONNECT_CHATGPT_CLOUD =
  "engineAccounts:connectChatGptCloud" as const;
export const IPC_ENGINE_ACCOUNTS_CANCEL_CONNECT_CHATGPT_CLOUD =
  "engineAccounts:cancelConnectChatGptCloud" as const;
export const IPC_CHATGPT_LIST_PROFILES = "chatgpt:listProfiles" as const;
export const IPC_CHATGPT_SIGN_IN = "chatgpt:signIn" as const;
export const IPC_CHATGPT_CANCEL_SIGN_IN = "chatgpt:cancelSignIn" as const;
export const IPC_CHATGPT_SET_ACTIVE = "chatgpt:setActive" as const;
export const IPC_CHATGPT_SIGN_OUT = "chatgpt:signOut" as const;
export const IPC_CHATGPT_REMOVE = "chatgpt:remove" as const;
export const IPC_CHATGPT_PROFILES_CHANGED = "chatgpt:profilesChanged" as const;
export const IPC_USER_ASK_OPENED = "userAsk:opened" as const;
export const IPC_USER_ASK_UPDATED = "userAsk:updated" as const;
export const IPC_USER_ASK_CLOSED = "userAsk:closed" as const;
export const IPC_USER_ASK_LIST = "userAsk:list" as const;
export const IPC_USER_ASK_ANSWER = "userAsk:answer" as const;
export const IPC_USER_ASK_CANCEL = "userAsk:cancel" as const;
export const IPC_USER_ASK_POLICY_GET = "userAsk:policyGet" as const;
export const IPC_USER_ASK_POLICY_SET = "userAsk:policySet" as const;
export const IPC_USER_ASK_SECURE_VALUES_LIST =
  "userAsk:secureValuesList" as const;
export const IPC_USER_ASK_SECURE_VALUES_DELETE =
  "userAsk:secureValuesDelete" as const;
export const IPC_USER_ASK_SECURE_VALUES_RENAME =
  "userAsk:secureValuesRename" as const;

export const IPC_CONNECTOR_CONNECT_REQUEST =
  "connector-connect:request" as const;
export const IPC_CONNECTOR_CONNECT_UPDATE = "connector-connect:update" as const;
export const IPC_CONNECTOR_CONNECT_RESPOND =
  "connector-connect:respond" as const;

export const IPC_ONBOARDING_SYNTHESIZE =
  "onboarding:synthesizeCoreMemory" as const;

export const IPC_CLOUD_HOME_SCAN_LOCAL = "cloudHome:scanLocal" as const;
export const IPC_CLOUD_HOME_GET_IMPORT_OWNERSHIP =
  "cloudHome:getImportOwnership" as const;
export const IPC_CLOUD_HOME_CONFIRM_IMPORT_OWNERSHIP =
  "cloudHome:confirmImportOwnership" as const;

export const IPC_MEMORY_SYNC_GET_STATUS = "memorySync:getStatus" as const;
export const IPC_MEMORY_SYNC_STATUS = "memorySync:status" as const;
export const IPC_MEMORY_SYNC_NOW = "memorySync:syncNow" as const;
export const IPC_MEMORY_SYNC_ERASE_LOCAL = "memorySync:eraseLocal" as const;
export const IPC_MEMORY_SYNC_SET_HELD = "memorySync:setHeld" as const;

export const IPC_DISCOVERY_DETECT_PREFERRED_BROWSER =
  "discovery:detectPreferredBrowser" as const;
export const IPC_DISCOVERY_LIST_BROWSER_PROFILES =
  "discovery:listBrowserProfiles" as const;
export const IPC_DISCOVERY_WRITE_CORE_MEMORY =
  "discovery:writeCoreMemory" as const;
export const IPC_DISCOVERY_COLLECT_ALL_SIGNALS =
  "discovery:collectAllSignals" as const;

export const IPC_BROWSER_BRIDGE_STATUS = "browser:bridgeStatus" as const;

export const IPC_BROWSER_VIEW_GET_STATE = "browserView:getState" as const;
export const IPC_BROWSER_VIEW_CONNECT = "browserView:connect" as const;
export const IPC_BROWSER_VIEW_SHOW = "browserView:show" as const;
export const IPC_BROWSER_VIEW_SET_OWNER_SCOPE =
  "browserView:setOwnerScope" as const;
export const IPC_BROWSER_VIEW_SET_LAYOUT = "browserView:setLayout" as const;
export const IPC_BROWSER_VIEW_HIDE = "browserView:hide" as const;
export const IPC_BROWSER_VIEW_CREATE_TAB = "browserView:createTab" as const;
export const IPC_BROWSER_VIEW_SELECT_TAB = "browserView:selectTab" as const;
export const IPC_BROWSER_VIEW_CLOSE_TAB = "browserView:closeTab" as const;
export const IPC_BROWSER_VIEW_NAVIGATE = "browserView:navigate" as const;
export const IPC_BROWSER_VIEW_GO_BACK = "browserView:goBack" as const;
export const IPC_BROWSER_VIEW_GO_FORWARD = "browserView:goForward" as const;
export const IPC_BROWSER_VIEW_RELOAD = "browserView:reload" as const;
export const IPC_BROWSER_VIEW_REQUEST_EXTENSION_CONNECT =
  "browserView:requestExtensionConnect" as const;
export const IPC_BROWSER_VIEW_STATE = "browserView:state" as const;
export const IPC_BROWSER_EXTENSION_GET_CLIENTS =
  "browserExtension:getClients" as const;
export const IPC_BROWSER_EXTENSION_SET_ROUTING =
  "browserExtension:setRouting" as const;

export const IPC_HOME_LIST_RECENT_APPS = "home:listRecentApps" as const;
export const IPC_HOME_GET_ACTIVE_BROWSER_TAB =
  "home:getActiveBrowserTab" as const;
export const IPC_HOME_CAPTURE_APP_WINDOW = "home:captureAppWindow" as const;

export const IPC_MEDIA_SAVE_OUTPUT = "media:saveOutput" as const;
export const IPC_MEDIA_COPY_IMAGE = "media:copyImage" as const;
export const IPC_MEDIA_COPY_ATTACHMENT = "media:copyAttachment" as const;

export const IPC_MEETINGS_STATUS = "meetings:status" as const;
export const IPC_MEETINGS_START = "meetings:start" as const;
export const IPC_MEETINGS_PAUSE = "meetings:pause" as const;
export const IPC_MEETINGS_RESUME = "meetings:resume" as const;
export const IPC_MEETINGS_STOP = "meetings:stop" as const;
export const IPC_MEETINGS_OPEN_FOLDER = "meetings:openFolder" as const;

export const IPC_SCHEDULE_LIST_CRON_JOBS = "schedule:listCronJobs" as const;
export const IPC_SCHEDULE_LIST_HEARTBEATS = "schedule:listHeartbeats" as const;
export const IPC_SCHEDULE_LIST_CONVERSATION_EVENTS =
  "schedule:listConversationEvents" as const;
export const IPC_SCHEDULE_UPDATED = "schedule:updated" as const;
export const IPC_SCHEDULE_UPDATE_CRON_JOB = "schedule:updateCronJob" as const;
export const IPC_SCHEDULE_REMOVE_CRON_JOB = "schedule:removeCronJob" as const;
export const IPC_SCHEDULE_RUN_CRON_JOB = "schedule:runCronJob" as const;
export const IPC_SCHEDULE_UPSERT_HEARTBEAT =
  "schedule:upsertHeartbeat" as const;
export const IPC_SCHEDULE_RUN_HEARTBEAT = "schedule:runHeartbeat" as const;

export const IPC_LOCAL_CHAT_GET_OR_CREATE_ID =
  "localChat:getOrCreateDefaultConversationId" as const;
export const IPC_LOCAL_CHAT_SET_ACTIVE_ID =
  "localChat:setActiveConversationId" as const;
export const IPC_LOCAL_CHAT_LIST_MESSAGES = "localChat:listMessages" as const;
export const IPC_LOCAL_CHAT_LIST_MESSAGES_BEFORE =
  "localChat:listMessagesBefore" as const;
export const IPC_LOCAL_CHAT_LIST_MESSAGES_AFTER =
  "localChat:listMessagesAfter" as const;
export const IPC_LOCAL_CHAT_LIST_ACTIVITY = "localChat:listActivity" as const;
export const IPC_LOCAL_CHAT_LIST_LINEAGE_MESSAGES =
  "localChat:listLineageMessages" as const;
export const IPC_LOCAL_CHAT_LIST_MODEL_USAGE =
  "localChat:listModelUsage" as const;
export const IPC_LOCAL_CHAT_LIST_FILES = "localChat:listFiles" as const;
export const IPC_LOCAL_CHAT_UPDATED = "localChat:updated" as const;

export const IPC_NATIVE_INTEGRATIONS_LIST = "nativeIntegrations:list" as const;
export const IPC_NATIVE_INTEGRATIONS_ENABLE =
  "nativeIntegrations:enable" as const;
export const IPC_NATIVE_INTEGRATIONS_DISABLE =
  "nativeIntegrations:disable" as const;

export const IPC_CLOUD_CONVERSATION_CACHE_RETAIN_ACCOUNT =
  "cloudConversationCache:retainAccount" as const;
export const IPC_CLOUD_CONVERSATION_CACHE_ACTIVATE_AUTHORITY =
  "cloudConversationCache:activateAuthority" as const;
export const IPC_CLOUD_CONVERSATION_CACHE_READ =
  "cloudConversationCache:read" as const;
export const IPC_CLOUD_CONVERSATION_CACHE_REPLACE =
  "cloudConversationCache:replace" as const;
export const IPC_CLOUD_CONVERSATION_CACHE_PURGE_CONVERSATION =
  "cloudConversationCache:purgeConversation" as const;

export const IPC_COMPANION_HELLO = "companion:hello" as const;
export const IPC_COMPANION_LAYOUT = "companion:layout" as const;
export const IPC_COMPANION_HOVER = "companion:hover" as const;
export const IPC_COMPANION_PANEL_STATUS = "companion:panelStatus" as const;
export const IPC_COMPANION_ACTIVITY = "companion:activity" as const;
export const IPC_COMPANION_TOGGLE_EXPANDED =
  "companion:toggleExpanded" as const;
export const IPC_COMPANION_SET_EXPANDED = "companion:setExpanded" as const;
export const IPC_COMPANION_DRAG_START = "companion:dragStart" as const;
export const IPC_COMPANION_DRAG_MOVE = "companion:dragMove" as const;
export const IPC_COMPANION_DRAG_END = "companion:dragEnd" as const;
export const IPC_COMPANION_FOCUS = "companion:focus" as const;
export const IPC_COMPANION_OPEN_MAIN = "companion:openMain" as const;
export const IPC_COMPANION_SHOW_CONTEXT_MENU =
  "companion:showContextMenu" as const;
export const IPC_COMPANION_SEND = "companion:send" as const;
export const IPC_COMPANION_STOP = "companion:stop" as const;
export const IPC_COMPANION_SEND_REQUESTED = "companion:sendRequested" as const;
export const IPC_COMPANION_STOP_REQUESTED = "companion:stopRequested" as const;
export const IPC_COMPANION_PUBLISH_STATE = "companion:publishState" as const;
export const IPC_COMPANION_GET_STATE = "companion:getState" as const;
export const IPC_COMPANION_STATE = "companion:state" as const;
export const IPC_COMPANION_GET_VISIBLE = "companion:getVisible" as const;
export const IPC_COMPANION_SET_VISIBLE = "companion:setVisible" as const;
export const IPC_COMPANION_VISIBLE_CHANGED =
  "companion:visibleChanged" as const;
