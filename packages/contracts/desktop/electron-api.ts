import type { DriveEvidenceSource } from "../chat-evidence.js";
import type { ChatContext } from "../index.js";
import type {
  IpcEventChannel,
  IpcEventPayload,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcSendArgs,
  IpcSendChannel,
  ResettablePermissionKind,
  TypedIpcRenderer,
} from "./ipc-contract.js";
import {
  IPC_PI_CHAT_EVENTS,
  IPC_PI_CHAT_REQUEST,
  IPC_AGENT_SEND_INPUT,
  IPC_APP_HARD_RESET,
  IPC_APP_QUIT_FOR_RESTART,
  IPC_APP_RELAUNCH,
  IPC_APP_RELOAD,
  IPC_APP_SET_READY,
  IPC_APP_SOURCE_APPLY,
  IPC_APP_SOURCE_APPLY_REMOTE,
  IPC_APP_SOURCE_APPLY_UPSTREAM,
  IPC_APP_SOURCE_GET_STATE,
  IPC_APP_SOURCE_SKIP,
  IPC_APP_SOURCE_STATE,
  IPC_APP_SOURCE_UNDO,
  IPC_AUTH_APPLY_SESSION_TOKEN,
  IPC_AUTH_DELETE_USER,
  IPC_AUTH_GET_CHALLENGE_TOKEN,
  IPC_AUTH_GET_SESSION,
  IPC_AUTH_GET_TOKEN,
  IPC_AUTH_LIST_SESSIONS,
  IPC_AUTH_REVOKE_SESSION,
  IPC_AUTH_REVOKE_SESSIONS,
  IPC_AUTH_SESSION_INVALIDATED,
  IPC_AUTH_SIGN_OUT,
  IPC_BROWSER_BRIDGE_STATUS,
  IPC_BROWSER_VIEW_CLOSE_TAB,
  IPC_BROWSER_VIEW_CONNECT,
  IPC_BROWSER_VIEW_CREATE_TAB,
  IPC_BROWSER_VIEW_GET_STATE,
  IPC_BROWSER_VIEW_GO_BACK,
  IPC_BROWSER_VIEW_GO_FORWARD,
  IPC_BROWSER_VIEW_HIDE,
  IPC_BROWSER_VIEW_NAVIGATE,
  IPC_BROWSER_VIEW_RELOAD,
  IPC_BROWSER_VIEW_REQUEST_EXTENSION_CONNECT,
  IPC_BROWSER_VIEW_SELECT_TAB,
  IPC_BROWSER_VIEW_SET_LAYOUT,
  IPC_BROWSER_VIEW_SET_OWNER_SCOPE,
  IPC_BROWSER_VIEW_SHOW,
  IPC_BROWSER_VIEW_STATE,
  IPC_CAPTURE_BEGIN_REGION_CAPTURE,
  IPC_CAPTURE_REGION_FAILED,
  IPC_CHAT_CONTEXT_GET,
  IPC_CHAT_CONTEXT_REMOVE_SCREENSHOT,
  IPC_CHAT_CONTEXT_SET,
  IPC_CHAT_CONTEXT_UPDATED,
  IPC_CHAT_EVIDENCE_CARDS,
  IPC_CHAT_EVIDENCE_DRIVE_CARDS,
  IPC_CHATGPT_CANCEL_SIGN_IN,
  IPC_CHATGPT_LIST_MODELS,
  IPC_CHATGPT_LIST_PROFILES,
  IPC_CHATGPT_PROFILES_CHANGED,
  IPC_CHATGPT_REMOVE,
  IPC_CHATGPT_SET_ACTIVE,
  IPC_CHATGPT_SIGN_IN,
  IPC_CHATGPT_SIGN_OUT,
  IPC_CLAUDE_ACCOUNTS_CANCEL_LOGIN,
  IPC_CLAUDE_ACCOUNTS_CHANGED,
  IPC_CLAUDE_ACCOUNTS_FINISH_LOGIN,
  IPC_CLAUDE_ACCOUNTS_LIST,
  IPC_CLAUDE_ACCOUNTS_SIGN_OUT,
  IPC_CLAUDE_ACCOUNTS_START_LOGIN,
  IPC_CLAUDE_ACCOUNTS_WAIT_LOGIN,
  IPC_CLOUD_CONVERSATION_CACHE_ACTIVATE_AUTHORITY,
  IPC_CLOUD_CONVERSATION_CACHE_PURGE_CONVERSATION,
  IPC_CLOUD_CONVERSATION_CACHE_READ,
  IPC_CLOUD_CONVERSATION_CACHE_REPLACE,
  IPC_CLOUD_CONVERSATION_CACHE_RETAIN_ACCOUNT,
  IPC_CLOUD_HOME_CONFIRM_IMPORT_OWNERSHIP,
  IPC_CLOUD_HOME_GET_IMPORT_OWNERSHIP,
  IPC_CLOUD_HOME_SCAN_LOCAL,
  IPC_COMPANION_ACTIVITY,
  IPC_COMPANION_DRAG_END,
  IPC_COMPANION_DRAG_MOVE,
  IPC_COMPANION_DRAG_START,
  IPC_COMPANION_FOCUS,
  IPC_COMPANION_GET_STATE,
  IPC_COMPANION_GET_VISIBLE,
  IPC_COMPANION_HELLO,
  IPC_COMPANION_HOVER,
  IPC_COMPANION_LAYOUT,
  IPC_COMPANION_OPEN_MAIN,
  IPC_COMPANION_PANEL_STATUS,
  IPC_COMPANION_PUBLISH_STATE,
  IPC_COMPANION_SEND,
  IPC_COMPANION_SEND_REQUESTED,
  IPC_COMPANION_SET_EXPANDED,
  IPC_COMPANION_SET_VISIBLE,
  IPC_COMPANION_SHOW_CONTEXT_MENU,
  IPC_COMPANION_STATE,
  IPC_COMPANION_STOP,
  IPC_COMPANION_STOP_REQUESTED,
  IPC_COMPANION_TOGGLE_EXPANDED,
  IPC_COMPANION_VISIBLE_CHANGED,
  IPC_CONNECTOR_CONNECT_REQUEST,
  IPC_CONNECTOR_CONNECT_RESPOND,
  IPC_CONNECTOR_CONNECT_UPDATE,
  IPC_CUSTOMIZATIONS_RESET,
  IPC_DEVICE_GET_ID,
  IPC_DIAGNOSTICS_EXPORT_LOGS,
  IPC_DIAGNOSTICS_OPEN_LOGS,
  IPC_DIAGNOSTICS_RECORD_HEAP_TRACE,
  IPC_DIAGNOSTICS_REPORT_ERROR,
  IPC_DIAGNOSTICS_REPORT_TIMING,
  IPC_DICTATION_ACTIVE_CHANGED,
  IPC_DICTATION_CANCEL_OPENROUTER,
  IPC_DICTATION_GET_SHORTCUT,
  IPC_DICTATION_GET_SOUND_EFFECTS_ENABLED,
  IPC_DICTATION_HAS_OPENROUTER_KEY,
  IPC_DICTATION_PLAY_SOUND,
  IPC_DICTATION_SET_SHORTCUT,
  IPC_DICTATION_SET_SOUND_EFFECTS_ENABLED,
  IPC_DICTATION_TOGGLE,
  IPC_DICTATION_TRANSCRIBE_WITH_OPENROUTER,
  IPC_DISCOVERY_COLLECT_ALL_SIGNALS,
  IPC_DISCOVERY_DETECT_PREFERRED_BROWSER,
  IPC_DISCOVERY_LIST_BROWSER_PROFILES,
  IPC_DISCOVERY_WRITE_CORE_MEMORY,
  IPC_DISPLAY_CANVAS_FILE_URL,
  IPC_DISPLAY_CANVAS_HTML_CHANGED,
  IPC_DISPLAY_CANVAS_HTML_URL,
  IPC_DISPLAY_LIST_CANVAS_HTML,
  IPC_DISPLAY_LIST_FOLDER,
  IPC_DISPLAY_MEDIA_SOURCE,
  IPC_DISPLAY_OPEN_SHARED_CANVAS,
  IPC_DISPLAY_OPEN_SHARE_LINK,
  IPC_DISPLAY_READ_FILE,
  IPC_DISPLAY_SET_SELECTED_DEVICE,
  IPC_DISPLAY_STAT_PATH,
  IPC_DISPLAY_TRASH_FORCE_DELETE,
  IPC_DISPLAY_TRASH_LIST,
  IPC_DISPLAY_UPDATE,
  IPC_ENGINE_ACCOUNTS_CANCEL_CONNECT_CHATGPT_CLOUD,
  IPC_ENGINE_ACCOUNTS_CONNECT_CHATGPT_CLOUD,
  IPC_EXECUTION_ANSWER_REMOTE_REQUEST,
  IPC_EXECUTION_PENDING_REMOTE_REQUEST,
  IPC_EXECUTION_REMOTE_REQUEST,
  IPC_EXECUTION_TARGET_SET,
  IPC_GLOBAL_SHORTCUTS_SET_SUSPENDED,
  IPC_HOME_CAPTURE_APP_WINDOW,
  IPC_HOME_GET_ACTIVE_BROWSER_TAB,
  IPC_HOME_LIST_RECENT_APPS,
  IPC_HOST_CONFIGURE_RUNTIME,
  IPC_HOST_SET_CLOUD_SYNC,
  IPC_LLM_CREDENTIALS_CANCEL_OAUTH,
  IPC_LLM_CREDENTIALS_DELETE,
  IPC_LLM_CREDENTIALS_DELETE_OAUTH,
  IPC_LLM_CREDENTIALS_LIST,
  IPC_LLM_CREDENTIALS_LIST_OAUTH,
  IPC_LLM_CREDENTIALS_LIST_OAUTH_PROVIDERS,
  IPC_LLM_CREDENTIALS_LOGIN_OAUTH,
  IPC_LLM_CREDENTIALS_SAVE,
  IPC_LLM_CREDENTIALS_VALIDATE_OAUTH,
  IPC_LOCAL_CHAT_GET_OR_CREATE_ID,
  IPC_LOCAL_CHAT_LIST_ACTIVITY,
  IPC_LOCAL_CHAT_LIST_FILES,
  IPC_LOCAL_CHAT_LIST_LINEAGE_MESSAGES,
  IPC_LOCAL_CHAT_LIST_MESSAGES,
  IPC_LOCAL_CHAT_LIST_MESSAGES_AFTER,
  IPC_LOCAL_CHAT_LIST_MESSAGES_BEFORE,
  IPC_LOCAL_CHAT_LIST_MODEL_USAGE,
  IPC_LOCAL_CHAT_SET_ACTIVE_ID,
  IPC_LOCAL_CHAT_UPDATED,
  IPC_MEDIA_COPY_ATTACHMENT,
  IPC_MEDIA_COPY_IMAGE,
  IPC_MEDIA_SAVE_OUTPUT,
  IPC_MEETINGS_OPEN_FOLDER,
  IPC_MEETINGS_PAUSE,
  IPC_MEETINGS_RESUME,
  IPC_MEETINGS_START,
  IPC_MEETINGS_STATUS,
  IPC_MEETINGS_STOP,
  IPC_MEMORY_SYNC_ERASE_LOCAL,
  IPC_MEMORY_SYNC_GET_STATUS,
  IPC_MEMORY_SYNC_NOW,
  IPC_MEMORY_SYNC_STATUS,
  IPC_NATIVE_INTEGRATIONS_DISABLE,
  IPC_NATIVE_INTEGRATIONS_ENABLE,
  IPC_NATIVE_INTEGRATIONS_LIST,
  IPC_OFFICE_PREVIEW_LIST,
  IPC_OFFICE_PREVIEW_START,
  IPC_OFFICE_PREVIEW_UPDATE,
  IPC_ONBOARDING_SYNTHESIZE,
  IPC_OVERLAY_END_REGION_CAPTURE,
  IPC_OVERLAY_HIDE_WINDOW_HIGHLIGHT,
  IPC_OVERLAY_PREVIEW_WINDOW_HIGHLIGHT_AT_POINT,
  IPC_OVERLAY_SET_INTERACTIVE,
  IPC_OVERLAY_START_REGION_CAPTURE,
  IPC_OVERLAY_WINDOW_HIGHLIGHT,
  IPC_PERMISSIONS_GET_STATUS,
  IPC_PERMISSIONS_OPEN_SETTINGS,
  IPC_PERMISSIONS_REQUEST,
  IPC_PERMISSIONS_RESET,
  IPC_PERMISSIONS_RESET_MICROPHONE,
  IPC_PREFERENCES_GET_LOCKED_COMPUTER_USE,
  IPC_PREFERENCES_GET_MODELS,
  IPC_PREFERENCES_GET_ONBOARDING_COMPLETED,
  IPC_PREFERENCES_GET_PREVENT_SLEEP,
  IPC_PREFERENCES_GET_READ_ALOUD,
  IPC_PREFERENCES_GET_SOUND_NOTIFICATIONS,
  IPC_PREFERENCES_GET_TELEMETRY,
  IPC_PREFERENCES_GET_WAKE_WORD,
  IPC_PREFERENCES_LIST_CLAUDE_CODE_MODELS,
  IPC_PREFERENCES_LIST_MODELS,
  IPC_PREFERENCES_MODELS_UPDATED,
  IPC_PREFERENCES_READ_ALOUD_CHANGED,
  IPC_PREFERENCES_SET_LOCKED_COMPUTER_USE,
  IPC_PREFERENCES_SET_MODELS,
  IPC_PREFERENCES_SET_ONBOARDING_COMPLETED,
  IPC_PREFERENCES_SET_PREVENT_SLEEP,
  IPC_PREFERENCES_SET_READ_ALOUD,
  IPC_PREFERENCES_SET_SOUND_NOTIFICATIONS,
  IPC_PREFERENCES_SET_TELEMETRY,
  IPC_PREFERENCES_SET_WAKE_WORD,
  IPC_PREFERENCES_WAKE_WORD_CHANGED,
  IPC_PROMPT_PRESETS_DELETE,
  IPC_PROMPT_PRESETS_LIST,
  IPC_PROMPT_PRESETS_READ,
  IPC_PROMPT_PRESETS_SAVE,
  IPC_PROMPT_PRESETS_SELECT,
  IPC_REGION_CANCEL,
  IPC_REGION_CLICK,
  IPC_REGION_COMMIT_PREPARED,
  IPC_REGION_GET_WINDOW_CAPTURE,
  IPC_REGION_PREPARE_SELECTION,
  IPC_REGION_SELECT,
  IPC_RUNTIME_AVAILABILITY,
  IPC_SCHEDULE_LIST_CONVERSATION_EVENTS,
  IPC_SCHEDULE_LIST_CRON_JOBS,
  IPC_SCHEDULE_LIST_HEARTBEATS,
  IPC_SCHEDULE_REMOVE_CRON_JOB,
  IPC_SCHEDULE_RUN_CRON_JOB,
  IPC_SCHEDULE_RUN_HEARTBEAT,
  IPC_SCHEDULE_UPDATE_CRON_JOB,
  IPC_SCHEDULE_UPDATED,
  IPC_SCHEDULE_UPSERT_HEARTBEAT,
  IPC_SCREENSHOT_CAPTURE,
  IPC_SHELL_LIST_OPENERS,
  IPC_SHELL_OPEN_EXTERNAL,
  IPC_SHELL_OPEN_PATH,
  IPC_SHELL_OPEN_WITH,
  IPC_SHELL_SAVE_FILE_AS,
  IPC_SHELL_SHOW_IN_FOLDER,
  IPC_THEME_LIST_INSTALLED,
  IPC_UI_GET_STATE,
  IPC_UI_SET_STATE,
  IPC_UI_STATE,
  IPC_UI_STATE_KV_APPLY,
  IPC_UI_STATE_KV_CHANGED,
  IPC_UI_STATE_KV_CLEAR,
  IPC_USER_ASK_ANSWER,
  IPC_USER_ASK_CANCEL,
  IPC_USER_ASK_SECURE_VALUES_DELETE,
  IPC_USER_ASK_SECURE_VALUES_RENAME,
  IPC_USER_ASK_SECURE_VALUES_LIST,
  IPC_USER_ASK_CLOSED,
  IPC_USER_ASK_LIST,
  IPC_USER_ASK_OPENED,
  IPC_USER_ASK_POLICY_GET,
  IPC_USER_ASK_POLICY_SET,
  IPC_USER_ASK_UPDATED,
  IPC_VOICE_CREATE_OPENAI_SESSION,
  IPC_VOICE_CREATE_XAI_SESSION,
  IPC_VOICE_GET_RUNTIME_STATE,
  IPC_VOICE_GET_SESSION_ERROR_STATE,
  IPC_VOICE_ORCHESTRATOR_ACTIVITY,
  IPC_VOICE_ORCHESTRATOR_CHAT,
  IPC_VOICE_ORCHESTRATOR_CONFIG,
  IPC_VOICE_PERSIST_TRANSCRIPT,
  IPC_VOICE_PREFERENCES_CHANGED,
  IPC_VOICE_REPORT_SESSION_ERROR,
  IPC_VOICE_REPORT_SESSION_ERROR_STATE,
  IPC_VOICE_RTC_GET_SHORTCUT,
  IPC_VOICE_RTC_SET_SHORTCUT,
  IPC_VOICE_RTC_TOGGLE,
  IPC_VOICE_RUNTIME_STATE,
  IPC_VOICE_SESSION_ERROR,
  IPC_VOICE_SESSION_ERROR_STATE,
  IPC_WEBSITE_GET_BASE_URL,
  IPC_SELF_HOST_GET_STATE,
  IPC_SELF_HOST_TAKE_PENDING_LINK,
  IPC_SELF_HOST_INSPECT_LINK,
  IPC_SELF_HOST_CONNECT,
  IPC_SELF_HOST_USE_DEFAULT,
  IPC_SELF_HOST_START_PAIRING,
  IPC_SELF_HOST_PAIRING_STATUS,
  IPC_SELF_HOST_CANCEL_PAIRING,
  IPC_SELF_HOST_PAIR_LINK,
  IPC_WINDOW_CLOSE,
  IPC_WINDOW_IS_MAXIMIZED,
  IPC_WINDOW_MAXIMIZE,
  IPC_WINDOW_MINIMIZE,
  IPC_WINDOW_SET_NATIVE_BUTTONS_VISIBLE,
  IPC_WINDOW_SHOW,
} from "./ipc-channels.js";

export type ElectronApiHost = {
  platform: string;
  getPathForFile: (file: File) => string;
};

export const createElectronApi = (
  ipc: TypedIpcRenderer,
  host: ElectronApiHost,
) => {
  const invoker =
    <C extends IpcInvokeChannel>(channel: C) =>
    (...args: IpcInvokeArgs<C>) =>
      ipc.invoke(channel, ...args);
  const sender =
    <C extends IpcSendChannel>(channel: C) =>
    (...args: IpcSendArgs<C>) =>
      ipc.send(channel, ...args);
  const on =
    <C extends IpcEventChannel>(channel: C) =>
    (callback: (payload: IpcEventPayload<C>) => void): (() => void) =>
      ipc.on(channel, (_event, payload) => callback(payload));
  const onSignal =
    (channel: IpcEventChannel) =>
    (callback: () => void): (() => void) =>
      ipc.on(channel, () => callback());
  const onWithEvent =
    <C extends IpcEventChannel>(channel: C) =>
    (
      callback: (event: unknown, payload: IpcEventPayload<C>) => void,
    ): (() => void) =>
      ipc.on(channel, callback);

  return {
    platform: host.platform,

    files: {
      getPathForFile: (file: File) => host.getPathForFile(file),
    },

    cloudHome: {
      scanLocal: invoker(IPC_CLOUD_HOME_SCAN_LOCAL),
      getImportOwnership: invoker(IPC_CLOUD_HOME_GET_IMPORT_OWNERSHIP),
      confirmImportOwnership: invoker(IPC_CLOUD_HOME_CONFIRM_IMPORT_OWNERSHIP),
    },

    memorySync: {
      getStatus: invoker(IPC_MEMORY_SYNC_GET_STATUS),
      onStatus: on(IPC_MEMORY_SYNC_STATUS),
      syncNow: invoker(IPC_MEMORY_SYNC_NOW),
      eraseLocal: invoker(IPC_MEMORY_SYNC_ERASE_LOCAL),
    },

    cloudConversationCache: {
      retainAccount: (accountScope: string) =>
        ipc.invoke(IPC_CLOUD_CONVERSATION_CACHE_RETAIN_ACCOUNT, {
          accountScope,
        }),
      activateAuthority: invoker(
        IPC_CLOUD_CONVERSATION_CACHE_ACTIVATE_AUTHORITY,
      ),
      read: invoker(IPC_CLOUD_CONVERSATION_CACHE_READ),
      replace: invoker(IPC_CLOUD_CONVERSATION_CACHE_REPLACE),
      purgeConversation: invoker(
        IPC_CLOUD_CONVERSATION_CACHE_PURGE_CONVERSATION,
      ),
    },

    window: {
      minimize: sender(IPC_WINDOW_MINIMIZE),
      maximize: sender(IPC_WINDOW_MAXIMIZE),
      close: sender(IPC_WINDOW_CLOSE),
      isMaximized: invoker(IPC_WINDOW_IS_MAXIMIZED),
      show: sender(IPC_WINDOW_SHOW),
      setNativeButtonsVisible: sender(IPC_WINDOW_SET_NATIVE_BUTTONS_VISIBLE),
    },

    display: {
      onUpdate: on(IPC_DISPLAY_UPDATE),
      readFile: (
        filePath: string,
        options?: { conversationId?: string | null; maxBytes?: number },
      ) =>
        ipc.invoke(IPC_DISPLAY_READ_FILE, {
          filePath,
          conversationId: options?.conversationId,
          maxBytes: options?.maxBytes,
        }),
      mediaSource: (filePath: string) =>
        ipc.invoke(IPC_DISPLAY_MEDIA_SOURCE, { filePath }),
      statPath: (filePath: string, options?: { conversationId?: string | null }) =>
        ipc.invoke(IPC_DISPLAY_STAT_PATH, {
          filePath,
          conversationId: options?.conversationId,
        }),
      listFolder: (filePath: string, options?: { conversationId?: string | null }) =>
        ipc.invoke(IPC_DISPLAY_LIST_FOLDER, {
          filePath,
          conversationId: options?.conversationId,
        }),
      setSelectedDevice: sender(IPC_DISPLAY_SET_SELECTED_DEVICE),
      listCanvasHtml: invoker(IPC_DISPLAY_LIST_CANVAS_HTML),
      onCanvasHtmlChanged: onSignal(IPC_DISPLAY_CANVAS_HTML_CHANGED),
      openSharedCanvas: invoker(IPC_DISPLAY_OPEN_SHARED_CANVAS),
      onOpenShareLink: on(IPC_DISPLAY_OPEN_SHARE_LINK),
      canvasFileUrl: (filePath: string) =>
        ipc.invoke(IPC_DISPLAY_CANVAS_FILE_URL, { filePath }),
      canvasHtmlUrl: (html: string, options?: { drivePath?: string }) =>
        ipc.invoke(IPC_DISPLAY_CANVAS_HTML_URL, {
          html,
          ...(options?.drivePath ? { drivePath: options.drivePath } : {}),
        }),
      listTrash: invoker(IPC_DISPLAY_TRASH_LIST),
      forceDeleteTrash: invoker(IPC_DISPLAY_TRASH_FORCE_DELETE),
    },

    officePreview: {
      list: (options?: { conversationId?: string | null }) =>
        ipc.invoke(IPC_OFFICE_PREVIEW_LIST, options ?? {}),
      start: (filePath: string, options?: { conversationId?: string | null }) =>
        ipc.invoke(IPC_OFFICE_PREVIEW_START, {
          filePath,
          conversationId: options?.conversationId,
        }),
      onUpdate: on(IPC_OFFICE_PREVIEW_UPDATE),
    },

    chatEvidence: {
      cards: (filePaths: string[]) =>
        ipc.invoke(IPC_CHAT_EVIDENCE_CARDS, { filePaths }),
      driveCards: (files: DriveEvidenceSource[]) =>
        ipc.invoke(IPC_CHAT_EVIDENCE_DRIVE_CARDS, { files }),
    },

    ui: {
      getState: invoker(IPC_UI_GET_STATE),
      setState: invoker(IPC_UI_SET_STATE),
      onState: on(IPC_UI_STATE),
      setAppReady: sender(IPC_APP_SET_READY),
      reload: sender(IPC_APP_RELOAD),
      relaunch: sender(IPC_APP_RELAUNCH),
      hardReset: invoker(IPC_APP_HARD_RESET),
    },

    remoteExecution: {
      onRequest: on(IPC_EXECUTION_REMOTE_REQUEST),
      answer: (allow: boolean) =>
        ipc.invoke(IPC_EXECUTION_ANSWER_REMOTE_REQUEST, { allow }),
      pending: () => ipc.invoke(IPC_EXECUTION_PENDING_REMOTE_REQUEST),
    },

    executionTarget: {
      onSet: on(IPC_EXECUTION_TARGET_SET),
    },

    appSource: {
      getState: invoker(IPC_APP_SOURCE_GET_STATE),
      onState: on(IPC_APP_SOURCE_STATE),
      apply: invoker(IPC_APP_SOURCE_APPLY),
      undo: invoker(IPC_APP_SOURCE_UNDO),
      applyRemote: invoker(IPC_APP_SOURCE_APPLY_REMOTE),
      applyUpstream: invoker(IPC_APP_SOURCE_APPLY_UPSTREAM),
      skip: invoker(IPC_APP_SOURCE_SKIP),
    },

    capture: {
      getContext: invoker(IPC_CHAT_CONTEXT_GET),
      setContext: (context: ChatContext | null) =>
        ipc.send(IPC_CHAT_CONTEXT_SET, context),
      onContext: on(IPC_CHAT_CONTEXT_UPDATED),
      onRegionCaptureFailed: onSignal(IPC_CAPTURE_REGION_FAILED),
      screenshot: invoker(IPC_SCREENSHOT_CAPTURE),
      removeScreenshot: sender(IPC_CHAT_CONTEXT_REMOVE_SCREENSHOT),
      submitRegionSelection: sender(IPC_REGION_SELECT),
      prepareRegionSelection: invoker(IPC_REGION_PREPARE_SELECTION),
      commitPreparedRegionCapture: sender(IPC_REGION_COMMIT_PREPARED),
      submitRegionClick: sender(IPC_REGION_CLICK),
      getWindowCapture: invoker(IPC_REGION_GET_WINDOW_CAPTURE),
      cancelRegion: sender(IPC_REGION_CANCEL),
      beginRegionCapture: invoker(IPC_CAPTURE_BEGIN_REGION_CAPTURE),
    },

    overlay: {
      setInteractive: sender(IPC_OVERLAY_SET_INTERACTIVE),
      hideWindowHighlight: sender(IPC_OVERLAY_HIDE_WINDOW_HIGHLIGHT),
      previewWindowHighlightAtPoint: sender(
        IPC_OVERLAY_PREVIEW_WINDOW_HIGHLIGHT_AT_POINT,
      ),
      onStartRegionCapture: on(IPC_OVERLAY_START_REGION_CAPTURE),
      onEndRegionCapture: onSignal(IPC_OVERLAY_END_REGION_CAPTURE),
      onWindowHighlight: on(IPC_OVERLAY_WINDOW_HIGHLIGHT),
    },

    theme: {
      listInstalled: invoker(IPC_THEME_LIST_INSTALLED),
    },

    website: {
      getBaseUrl: invoker(IPC_WEBSITE_GET_BASE_URL),
    },

    selfHost: {
      getState: invoker(IPC_SELF_HOST_GET_STATE),
      takePendingLink: invoker(IPC_SELF_HOST_TAKE_PENDING_LINK),
      inspectLink: invoker(IPC_SELF_HOST_INSPECT_LINK),
      connect: invoker(IPC_SELF_HOST_CONNECT),
      useDefault: invoker(IPC_SELF_HOST_USE_DEFAULT),
      startPairing: invoker(IPC_SELF_HOST_START_PAIRING),
      pairingStatus: invoker(IPC_SELF_HOST_PAIRING_STATUS),
      cancelPairing: invoker(IPC_SELF_HOST_CANCEL_PAIRING),
      onPairLink: on(IPC_SELF_HOST_PAIR_LINK),
    },

    uiState: {
      apply: sender(IPC_UI_STATE_KV_APPLY),
      clear: sender(IPC_UI_STATE_KV_CLEAR),
      onChanged: on(IPC_UI_STATE_KV_CHANGED),
    },

    voice: {
      toggleRtc: sender(IPC_VOICE_RTC_TOGGLE),
      persistTranscript: sender(IPC_VOICE_PERSIST_TRANSCRIPT),
      orchestratorChat: invoker(IPC_VOICE_ORCHESTRATOR_CHAT),
      getOrchestratorConfig: invoker(IPC_VOICE_ORCHESTRATOR_CONFIG),
      onOrchestratorActivity: on(IPC_VOICE_ORCHESTRATOR_ACTIVITY),
      createOpenAISession: invoker(IPC_VOICE_CREATE_OPENAI_SESSION),
      createXaiSession: invoker(IPC_VOICE_CREATE_XAI_SESSION),
      getRuntimeState: invoker(IPC_VOICE_GET_RUNTIME_STATE),
      onRuntimeState: on(IPC_VOICE_RUNTIME_STATE),
      pushRuntimeState: sender(IPC_VOICE_RUNTIME_STATE),
      setRtcShortcut: invoker(IPC_VOICE_RTC_SET_SHORTCUT),
      getRtcShortcut: invoker(IPC_VOICE_RTC_GET_SHORTCUT),
      reportSessionError: sender(IPC_VOICE_REPORT_SESSION_ERROR),
      onSessionError: on(IPC_VOICE_SESSION_ERROR),
      reportSessionErrorState: sender(IPC_VOICE_REPORT_SESSION_ERROR_STATE),
      getSessionErrorState: invoker(IPC_VOICE_GET_SESSION_ERROR_STATE),
      onSessionErrorState: on(IPC_VOICE_SESSION_ERROR_STATE),
      onPreferencesChanged: on(IPC_VOICE_PREFERENCES_CHANGED),
    },

    dictation: {
      onToggle: on(IPC_DICTATION_TOGGLE),
      getShortcut: invoker(IPC_DICTATION_GET_SHORTCUT),
      setShortcut: invoker(IPC_DICTATION_SET_SHORTCUT),
      getSoundEffectsEnabled: invoker(IPC_DICTATION_GET_SOUND_EFFECTS_ENABLED),
      setSoundEffectsEnabled: invoker(IPC_DICTATION_SET_SOUND_EFFECTS_ENABLED),
      hasOpenRouterKey: invoker(IPC_DICTATION_HAS_OPENROUTER_KEY),
      transcribeWithOpenRouter: invoker(
        IPC_DICTATION_TRANSCRIBE_WITH_OPENROUTER,
      ),
      cancelOpenRouter: sender(IPC_DICTATION_CANCEL_OPENROUTER),
      activeChanged: sender(IPC_DICTATION_ACTIVE_CHANGED),
      playSound: sender(IPC_DICTATION_PLAY_SOUND),
    },

    companion: {
      hello: sender(IPC_COMPANION_HELLO),
      onLayout: on(IPC_COMPANION_LAYOUT),
      setHovered: sender(IPC_COMPANION_HOVER),
      reportPanelStatus: sender(IPC_COMPANION_PANEL_STATUS),
      onActivity: on(IPC_COMPANION_ACTIVITY),
      toggleExpanded: sender(IPC_COMPANION_TOGGLE_EXPANDED),
      onSetExpanded: on(IPC_COMPANION_SET_EXPANDED),
      dragStart: sender(IPC_COMPANION_DRAG_START),
      dragMove: sender(IPC_COMPANION_DRAG_MOVE),
      dragEnd: sender(IPC_COMPANION_DRAG_END),
      focus: sender(IPC_COMPANION_FOCUS),
      openMain: sender(IPC_COMPANION_OPEN_MAIN),
      showContextMenu: sender(IPC_COMPANION_SHOW_CONTEXT_MENU),
      send: sender(IPC_COMPANION_SEND),
      stop: sender(IPC_COMPANION_STOP),
      getState: invoker(IPC_COMPANION_GET_STATE),
      onState: on(IPC_COMPANION_STATE),
      publishState: sender(IPC_COMPANION_PUBLISH_STATE),
      onSendRequested: on(IPC_COMPANION_SEND_REQUESTED),
      onStopRequested: onSignal(IPC_COMPANION_STOP_REQUESTED),
      getVisible: invoker(IPC_COMPANION_GET_VISIBLE),
      setVisible: invoker(IPC_COMPANION_SET_VISIBLE),
      onVisibleChanged: on(IPC_COMPANION_VISIBLE_CHANGED),
    },

    piChat: {
      request: invoker(IPC_PI_CHAT_REQUEST),
      onEvents: on(IPC_PI_CHAT_EVENTS),
    },

    agent: {
      sendInput: invoker(IPC_AGENT_SEND_INPUT),
      onAvailability: on(IPC_RUNTIME_AVAILABILITY),
    },

    userAsk: {
      onOpened: onWithEvent(IPC_USER_ASK_OPENED),
      onUpdated: onWithEvent(IPC_USER_ASK_UPDATED),
      onClosed: onWithEvent(IPC_USER_ASK_CLOSED),
      list: invoker(IPC_USER_ASK_LIST),
      answer: invoker(IPC_USER_ASK_ANSWER),
      cancel: invoker(IPC_USER_ASK_CANCEL),
      policyGet: invoker(IPC_USER_ASK_POLICY_GET),
      policySet: invoker(IPC_USER_ASK_POLICY_SET),
      secureValuesList: invoker(IPC_USER_ASK_SECURE_VALUES_LIST),
      secureValuesDelete: invoker(IPC_USER_ASK_SECURE_VALUES_DELETE),
      secureValuesRename: invoker(IPC_USER_ASK_SECURE_VALUES_RENAME),
    },

    system: {
      getDeviceId: invoker(IPC_DEVICE_GET_ID),
      configurePiRuntime: invoker(IPC_HOST_CONFIGURE_RUNTIME),
      getAuthSession: invoker(IPC_AUTH_GET_SESSION),
      getChallengeToken: invoker(IPC_AUTH_GET_CHALLENGE_TOKEN),
      signOutAuth: invoker(IPC_AUTH_SIGN_OUT),
      deleteAuthUser: invoker(IPC_AUTH_DELETE_USER),
      applyAuthSessionToken: (sessionToken: string) =>
        ipc.invoke(IPC_AUTH_APPLY_SESSION_TOKEN, { sessionToken }),
      getAuthToken: invoker(IPC_AUTH_GET_TOKEN),
      revokeAuthSessions: invoker(IPC_AUTH_REVOKE_SESSIONS),
      listAuthSessions: invoker(IPC_AUTH_LIST_SESSIONS),
      revokeAuthSession: (sessionId: string) =>
        ipc.invoke(IPC_AUTH_REVOKE_SESSION, { sessionId }),
      setCloudSyncEnabled: invoker(IPC_HOST_SET_CLOUD_SYNC),
      onAuthSessionInvalidated: onSignal(IPC_AUTH_SESSION_INVALIDATED),
      quitForRestart: invoker(IPC_APP_QUIT_FOR_RESTART),
      getPermissionStatus: invoker(IPC_PERMISSIONS_GET_STATUS),
      openPermissionSettings: (kind: string) =>
        ipc.invoke(IPC_PERMISSIONS_OPEN_SETTINGS, { kind }),
      requestPermission: (kind: string) =>
        ipc.invoke(IPC_PERMISSIONS_REQUEST, { kind }),
      resetMicrophonePermission: invoker(IPC_PERMISSIONS_RESET_MICROPHONE),
      resetPermission: (kind: ResettablePermissionKind) =>
        ipc.invoke(IPC_PERMISSIONS_RESET, { kind }),
      openExternal: sender(IPC_SHELL_OPEN_EXTERNAL),
      showItemInFolder: sender(IPC_SHELL_SHOW_IN_FOLDER),
      saveFileAs: (sourcePath: string, defaultName?: string) =>
        ipc.invoke(IPC_SHELL_SAVE_FILE_AS, { sourcePath, defaultName }),
      listExternalOpeners: (filePath: string) =>
        ipc.invoke(IPC_SHELL_LIST_OPENERS, { filePath }),
      openWithExternal: (filePath: string, openerId: string) =>
        ipc.invoke(IPC_SHELL_OPEN_WITH, { filePath, openerId }),
      openPath: (filePath: string) =>
        ipc.invoke(IPC_SHELL_OPEN_PATH, { filePath }),
      getPreventComputerSleep: invoker(IPC_PREFERENCES_GET_PREVENT_SLEEP),
      setPreventComputerSleep: invoker(IPC_PREFERENCES_SET_PREVENT_SLEEP),
      getLockedComputerUseStatus: invoker(
        IPC_PREFERENCES_GET_LOCKED_COMPUTER_USE,
      ),
      setLockedComputerUseEnabled: invoker(
        IPC_PREFERENCES_SET_LOCKED_COMPUTER_USE,
      ),
      getSoundNotificationsEnabled: invoker(
        IPC_PREFERENCES_GET_SOUND_NOTIFICATIONS,
      ),
      setSoundNotificationsEnabled: invoker(
        IPC_PREFERENCES_SET_SOUND_NOTIFICATIONS,
      ),
      getTelemetryEnabled: invoker(IPC_PREFERENCES_GET_TELEMETRY),
      setTelemetryEnabled: invoker(IPC_PREFERENCES_SET_TELEMETRY),
      getReadAloudEnabled: invoker(IPC_PREFERENCES_GET_READ_ALOUD),
      setReadAloudEnabled: invoker(IPC_PREFERENCES_SET_READ_ALOUD),
      onReadAloudEnabledChanged: on(IPC_PREFERENCES_READ_ALOUD_CHANGED),
      getOnboardingCompleted: invoker(IPC_PREFERENCES_GET_ONBOARDING_COMPLETED),
      setOnboardingCompleted: invoker(IPC_PREFERENCES_SET_ONBOARDING_COMPLETED),
      setGlobalShortcutsSuspended: invoker(IPC_GLOBAL_SHORTCUTS_SET_SUSPENDED),
      recordHeapTrace: (durationMs?: number) =>
        ipc.invoke(IPC_DIAGNOSTICS_RECORD_HEAP_TRACE, { durationMs }),
      reportError: sender(IPC_DIAGNOSTICS_REPORT_ERROR),
      reportTiming: sender(IPC_DIAGNOSTICS_REPORT_TIMING),
      openLogs: invoker(IPC_DIAGNOSTICS_OPEN_LOGS),
      exportLogs: invoker(IPC_DIAGNOSTICS_EXPORT_LOGS),
      getWakeWordEnabled: invoker(IPC_PREFERENCES_GET_WAKE_WORD),
      setWakeWordEnabled: invoker(IPC_PREFERENCES_SET_WAKE_WORD),
      onWakeWordEnabledChanged: on(IPC_PREFERENCES_WAKE_WORD_CHANGED),
      listPromptPresets: invoker(IPC_PROMPT_PRESETS_LIST),
      readPromptPreset: invoker(IPC_PROMPT_PRESETS_READ),
      savePromptPreset: invoker(IPC_PROMPT_PRESETS_SAVE),
      deletePromptPreset: invoker(IPC_PROMPT_PRESETS_DELETE),
      selectPromptPreset: invoker(IPC_PROMPT_PRESETS_SELECT),
      resetCustomizations: invoker(IPC_CUSTOMIZATIONS_RESET),
      getLocalModelPreferences: invoker(IPC_PREFERENCES_GET_MODELS),
      setLocalModelPreferences: invoker(IPC_PREFERENCES_SET_MODELS),
      listChatGptModels: invoker(IPC_CHATGPT_LIST_MODELS),
      listClaudeCodeModels: invoker(IPC_PREFERENCES_LIST_CLAUDE_CODE_MODELS),
      listLlmModels: invoker(IPC_PREFERENCES_LIST_MODELS),
      onLlmModelsUpdated: on(IPC_PREFERENCES_MODELS_UPDATED),
      listLlmCredentials: invoker(IPC_LLM_CREDENTIALS_LIST),
      listLlmOAuthProviders: invoker(IPC_LLM_CREDENTIALS_LIST_OAUTH_PROVIDERS),
      listLlmOAuthCredentials: invoker(IPC_LLM_CREDENTIALS_LIST_OAUTH),
      loginLlmOAuthCredential: (provider: string) =>
        ipc.invoke(IPC_LLM_CREDENTIALS_LOGIN_OAUTH, { provider }),
      listClaudeLocalAccounts: invoker(IPC_CLAUDE_ACCOUNTS_LIST),
      startClaudeLocalLogin: (options?: {
        configId?: string;
        email?: string;
      }) =>
        ipc.invoke(IPC_CLAUDE_ACCOUNTS_START_LOGIN, {
          configId: options?.configId,
          email: options?.email,
        }),
      waitClaudeLocalLogin: (loginId: string) =>
        ipc.invoke(IPC_CLAUDE_ACCOUNTS_WAIT_LOGIN, { loginId }),
      finishClaudeLocalLogin: (loginId: string, code: string) =>
        ipc.invoke(IPC_CLAUDE_ACCOUNTS_FINISH_LOGIN, { loginId, code }),
      cancelClaudeLocalLogin: (loginId: string) =>
        ipc.invoke(IPC_CLAUDE_ACCOUNTS_CANCEL_LOGIN, { loginId }),
      signOutClaudeLocalConfig: (configId: string) =>
        ipc.invoke(IPC_CLAUDE_ACCOUNTS_SIGN_OUT, { configId }),
      onClaudeLocalAccountsChanged: onSignal(IPC_CLAUDE_ACCOUNTS_CHANGED),
      connectChatGptCloud: (options?: {
        accountId?: string;
        clientId?: string;
        enablePlanUsage?: boolean;
      }) =>
        ipc.invoke(IPC_ENGINE_ACCOUNTS_CONNECT_CHATGPT_CLOUD, {
          accountId: options?.accountId,
          clientId: options?.clientId,
          enablePlanUsage: options?.enablePlanUsage,
        }),
      cancelChatGptCloudConnect: invoker(
        IPC_ENGINE_ACCOUNTS_CANCEL_CONNECT_CHATGPT_CLOUD,
      ),
      listChatGptProfiles: invoker(IPC_CHATGPT_LIST_PROFILES),
      signInChatGpt: (options?: {
        profileId?: string;
        sharedClientId?: string;
        enablePlanUsage?: boolean;
      }) =>
        ipc.invoke(IPC_CHATGPT_SIGN_IN, {
          profileId: options?.profileId,
          sharedClientId: options?.sharedClientId,
          enablePlanUsage: options?.enablePlanUsage,
        }),
      cancelChatGptSignIn: invoker(IPC_CHATGPT_CANCEL_SIGN_IN),
      setActiveChatGptProfile: (profileId: string) =>
        ipc.invoke(IPC_CHATGPT_SET_ACTIVE, { profileId }),
      signOutChatGptProfile: (profileId: string) =>
        ipc.invoke(IPC_CHATGPT_SIGN_OUT, { profileId }),
      removeChatGptProfile: (profileId: string) =>
        ipc.invoke(IPC_CHATGPT_REMOVE, { profileId }),
      onChatGptProfilesChanged: onSignal(IPC_CHATGPT_PROFILES_CHANGED),
      cancelLlmOAuthCredential: (provider: string) =>
        ipc.invoke(IPC_LLM_CREDENTIALS_CANCEL_OAUTH, { provider }),
      validateLlmOAuthCredential: (provider: string) =>
        ipc.invoke(IPC_LLM_CREDENTIALS_VALIDATE_OAUTH, { provider }),
      deleteLlmOAuthCredential: (provider: string) =>
        ipc.invoke(IPC_LLM_CREDENTIALS_DELETE_OAUTH, { provider }),
      saveLlmCredential: invoker(IPC_LLM_CREDENTIALS_SAVE),
      deleteLlmCredential: (provider: string) =>
        ipc.invoke(IPC_LLM_CREDENTIALS_DELETE, { provider }),
      onConnectorConnectRequest: onWithEvent(IPC_CONNECTOR_CONNECT_REQUEST),
      onConnectorConnectUpdate: onWithEvent(IPC_CONNECTOR_CONNECT_UPDATE),
      respondConnectorConnect: invoker(IPC_CONNECTOR_CONNECT_RESPOND),
    },

    onboarding: {
      synthesizeCoreMemory: invoker(IPC_ONBOARDING_SYNTHESIZE),
    },

    discovery: {
      detectPreferred: invoker(IPC_DISCOVERY_DETECT_PREFERRED_BROWSER),
      listProfiles: invoker(IPC_DISCOVERY_LIST_BROWSER_PROFILES),
      writeCoreMemory: (
        content: string,
        options?: { includeLocation?: boolean },
      ) =>
        ipc.invoke(IPC_DISCOVERY_WRITE_CORE_MEMORY, {
          content,
          includeLocation: options?.includeLocation === true,
        }),
      collectAllSignals: invoker(IPC_DISCOVERY_COLLECT_ALL_SIGNALS),
    },

    browser: {
      onBridgeStatus: on(IPC_BROWSER_BRIDGE_STATUS),
    },

    browserView: {
      getState: invoker(IPC_BROWSER_VIEW_GET_STATE),
      connect: invoker(IPC_BROWSER_VIEW_CONNECT),
      show: invoker(IPC_BROWSER_VIEW_SHOW),
      setOwnerScope: (payload: { ownerId?: string } = {}) =>
        ipc.invoke(IPC_BROWSER_VIEW_SET_OWNER_SCOPE, payload),
      setLayout: invoker(IPC_BROWSER_VIEW_SET_LAYOUT),
      hide: invoker(IPC_BROWSER_VIEW_HIDE),
      createTab: (
        payload: { url?: string; ownerId?: string; activate?: boolean } = {},
      ) => ipc.invoke(IPC_BROWSER_VIEW_CREATE_TAB, payload),
      selectTab: invoker(IPC_BROWSER_VIEW_SELECT_TAB),
      closeTab: invoker(IPC_BROWSER_VIEW_CLOSE_TAB),
      navigate: invoker(IPC_BROWSER_VIEW_NAVIGATE),
      goBack: invoker(IPC_BROWSER_VIEW_GO_BACK),
      goForward: invoker(IPC_BROWSER_VIEW_GO_FORWARD),
      reload: invoker(IPC_BROWSER_VIEW_RELOAD),
      requestExtensionConnect: invoker(
        IPC_BROWSER_VIEW_REQUEST_EXTENSION_CONNECT,
      ),
      onState: on(IPC_BROWSER_VIEW_STATE),
    },

    home: {
      listRecentApps: (limit?: number) =>
        ipc.invoke(IPC_HOME_LIST_RECENT_APPS, { limit }),
      getActiveBrowserTab: (bundleId: string) =>
        ipc.invoke(IPC_HOME_GET_ACTIVE_BROWSER_TAB, { bundleId }),
      captureAppWindow: (target: { pid: number }) =>
        ipc.invoke(IPC_HOME_CAPTURE_APP_WINDOW, { pid: target.pid }),
    },

    media: {
      saveOutput: (url: string, fileName: string) =>
        ipc.invoke(IPC_MEDIA_SAVE_OUTPUT, { url, fileName }),
      copyImage: (pngBase64: string) =>
        ipc.invoke(IPC_MEDIA_COPY_IMAGE, { pngBase64 }),
      copyAttachment: invoker(IPC_MEDIA_COPY_ATTACHMENT),
    },

    meetings: {
      status: invoker(IPC_MEETINGS_STATUS),
      start: (payload?: { sessionId?: string; segmentSeconds?: number }) =>
        ipc.invoke(IPC_MEETINGS_START, payload ?? {}),
      pause: invoker(IPC_MEETINGS_PAUSE),
      resume: invoker(IPC_MEETINGS_RESUME),
      stop: invoker(IPC_MEETINGS_STOP),
      openFolder: (payload?: { sessionId?: string }) =>
        ipc.invoke(IPC_MEETINGS_OPEN_FOLDER, payload ?? {}),
    },

    schedule: {
      listCronJobs: invoker(IPC_SCHEDULE_LIST_CRON_JOBS),
      listHeartbeats: invoker(IPC_SCHEDULE_LIST_HEARTBEATS),
      listConversationEvents: invoker(IPC_SCHEDULE_LIST_CONVERSATION_EVENTS),
      runCronJob: invoker(IPC_SCHEDULE_RUN_CRON_JOB),
      removeCronJob: invoker(IPC_SCHEDULE_REMOVE_CRON_JOB),
      updateCronJob: invoker(IPC_SCHEDULE_UPDATE_CRON_JOB),
      upsertHeartbeat: invoker(IPC_SCHEDULE_UPSERT_HEARTBEAT),
      runHeartbeat: invoker(IPC_SCHEDULE_RUN_HEARTBEAT),
      onUpdated: onSignal(IPC_SCHEDULE_UPDATED),
    },

    localChat: {
      getOrCreateDefaultConversationId: invoker(
        IPC_LOCAL_CHAT_GET_OR_CREATE_ID,
      ),
      setActiveConversationId: invoker(IPC_LOCAL_CHAT_SET_ACTIVE_ID),
      listMessages: invoker(IPC_LOCAL_CHAT_LIST_MESSAGES),
      listMessagesBefore: invoker(IPC_LOCAL_CHAT_LIST_MESSAGES_BEFORE),
      listMessagesAfter: invoker(IPC_LOCAL_CHAT_LIST_MESSAGES_AFTER),
      listActivity: invoker(IPC_LOCAL_CHAT_LIST_ACTIVITY),
      listLineageMessages: invoker(IPC_LOCAL_CHAT_LIST_LINEAGE_MESSAGES),
      listModelUsage: invoker(IPC_LOCAL_CHAT_LIST_MODEL_USAGE),
      listFiles: invoker(IPC_LOCAL_CHAT_LIST_FILES),
      onUpdated: on(IPC_LOCAL_CHAT_UPDATED),
    },

    nativeIntegrations: {
      list: invoker(IPC_NATIVE_INTEGRATIONS_LIST),
      enable: invoker(IPC_NATIVE_INTEGRATIONS_ENABLE),
      disable: invoker(IPC_NATIVE_INTEGRATIONS_DISABLE),
    },
  };
};

export type ElectronAPI = ReturnType<typeof createElectronApi>;
