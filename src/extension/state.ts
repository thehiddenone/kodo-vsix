/**
 * Window-global mutable state shared across the extension-host modules under
 * `src/extension/` — the pieces `extension.ts` used to hold as bare
 * module-level `let`s before being split apart. Every extracted module reads
 * and writes through this one object instead of its own copy, so behavior is
 * unchanged: there is still exactly one instance of each field per window.
 */

import type * as vscode from 'vscode';
import type { CloudRegistry, KnobDefs, LlamaArgSpec, LocalDownloadState, LocalRegistryEntry, OpenRouterModelInfo, SamplingParamSpec, ThinkingFamilies } from '../llm-registry-types';
import type { ServerLauncher } from '../server-launcher';
import type { SessionController } from '../session/controller';
import type { SidebarProvider } from '../sidebar-provider';
import type { WsClient } from '../ws-client';

// Mirrors _DEFAULT_USER_SETTINGS["models"]["local"] in kodo/server/_config.py.
export const DEFAULT_LOCAL_MODEL = 'llamacpp-qwen36-27b-q4-k-xl';
export const DEFAULT_CLOUD_VENDOR = 'anthropic';

interface WindowState {
  extensionContext: vscode.ExtensionContext | null;
  // Serial queue for api_key.request handling — at most one "enter key" dialog
  // at a time; later requests for the same vendor find the stored key immediately.
  apiKeyQueue: Promise<void>;
  // Serial queue for prompt.choose_project_folder handling — at most one native
  // folder-picker dialog at a time.
  chooseProjectFolderQueue: Promise<void>;

  launcher: ServerLauncher | null;
  wsUrl: string;
  // Session-less control connection (sidebar / llama / picker). Held for the
  // window's lifetime so the singleton stays up while the window is open.
  controlClient: WsClient | null;
  controlConnected: boolean;
  sidebarProvider: SidebarProvider | null;
  deactivating: boolean;

  // Open session tabs in this window, keyed by the controller's internal key.
  sessions: Map<string, SessionController>;

  // Startup-failure remediation (rebuild ~/.kodo/venv and retry once) has
  // already been attempted for this window's server launch.
  serverStartRemediationAttempted: boolean;

  // "Starting the local Kōdo server…" progress notification, shown from the
  // first launch attempt in `activate()` until the control connection either
  // connects for the first time or exhausts remediation.
  serverStartProgressResolve: (() => void) | null;
  serverStartProgressReporter: vscode.Progress<{ message?: string }> | null;
  serverStartupConnected: boolean;

  projectRoot: string;
  physicalRoot: string;
  hasWorkspace: boolean;
  modeState: 'local' | 'cloud';
  // Stable per-window id (persisted) so the server lets this window reclaim its
  // sessions after a reload within the disconnect grace window.
  windowId: string;

  // ---------------------------------------------------------------------
  // Window-global control/LLM state (sidebar + settings-panel mirror)
  // ---------------------------------------------------------------------
  cloudRegistryState: CloudRegistry;
  // OpenRouter's own fetched/cached model catalog (doc/LLM_REGISTRY.md §3a)
  // -- a third, dynamic registry, separate from cloudRegistryState above
  // (OpenRouter has no compiled-in model tuple). From hello.ack's
  // `openrouter_catalog` field and the `openrouter.models.refresh` reply.
  openRouterCatalogState: OpenRouterModelInfo[];
  activeCloudVendorState: string;
  localRegistryState: LocalRegistryEntry[];
  activeLocalModelState: string;
  effectiveLocalModelState: string;
  llamaInstalledState: boolean;
  llamaVersionState: string;
  // Latest build number available on GitHub Releases — only known once the
  // Kōdo Settings panel's "Llama.cpp" section has fetched `llamacpp.version_info`
  // at least once (not part of `hello.ack`); `null` until then or on fetch failure.
  llamaLatestVersionState: string | null;
  llamaInstallingState: boolean;
  llamaRunningState: boolean;
  llamaRunningModelState: string;
  llamaStartingState: boolean;
  llamaStoppingState: boolean;
  llamaServerOverridePathState: string | null;
  llamaStartProgressResolve: (() => void) | null;
  detectedVramGbState: number | null;
  detectedRamGbState: number | null;
  // base_llm -> thinking-family metadata, from the server's `thinking_families`
  // payload (doc/LLM_REGISTRY.md §4.5). Forwarded to every open session tab —
  // thinking_level itself is per-session server-tracked state (doc/SESSIONS.md),
  // not a window-global setting.
  thinkingFamiliesState: ThinkingFamilies;
  // The server's request-level sampling parameter table, from the
  // `sampling_specs` field of the same `hello.ack`/`local_llm.registry_state`
  // payload (kodo/doc/SAMPLING.md). Static for the life of the server, so it
  // rides the registry push rather than every per-session `state`. Forwarded
  // to every open session tab; the per-quant override VALUES are per-session
  // server state instead, arriving on `state.sampling`.
  samplingSpecsState: SamplingParamSpec[];
  // Every knob definition any registry entry offers, keyed by id, from the
  // `knob_defs` field of the same payload (kodo/doc/LLM_REGISTRY.md §4.6).
  // Deduplicated server-side rather than repeated on every entry, since all
  // 82 built-ins share the same six knobs. Drives the Configure modal.
  knobDefsState: KnobDefs;
  // The curated llama-server flag table the user-defined profile editor's
  // "Add argument" picker renders from, from the same payload's
  // `llama_arg_catalog` field (kodo/doc/LLM_REGISTRY.md §4.7). Static.
  llamaArgCatalogState: LlamaArgSpec[];
  // Live download progress, read off manager-state.json on disk rather than
  // pushed over the WS wire (see local-model-downloads.ts and
  // doc/LOCAL_MODEL_MANAGER.md §11) — keyed by registry entry name.
  localDownloadsState: LocalDownloadState[];
  // Installed models whose remote GGUF has changed (ETag mismatch) — reported
  // asynchronously by `local_llm.updates_available` in reply to a
  // `local_llm.check_updates` fire-and-forget scan (doc/LOCAL_MODEL_MANAGER.md
  // §12). Empty until that reply lands, and reset per-scan (not merged).
  localUpdatableNamesState: string[];

  // custom_file entries' installed state is resolved ONCE per entry, the first
  // time this window's extension host sees that entry — never re-checked
  // afterward, per doc/LLM_REGISTRY.md §4.
  customFileInstalledCache: Map<string, boolean>;

  reconciledOpenSessions: boolean;
  // True when THIS activation follows a reload that changed the workspace
  // identity — see open-session-memory.ts's doc comment on
  // `_serializerStateIsDead` (now `serializerStateIsDead`) for the full story.
  serializerStateIsDead: boolean;

  // Pending control request/response round-trips (e.g. session.list).
  pendingControl: Map<string, (payload: Record<string, unknown>) => void>;

  llamaProgressReporter: vscode.Progress<{ message?: string; increment?: number }> | null;
  llamaProgressResolve: (() => void) | null;
  llamaProgressReject: ((err: Error) => void) | null;
  llamaLastPct: number;
}

export const state: WindowState = {
  extensionContext: null,
  apiKeyQueue: Promise.resolve(),
  chooseProjectFolderQueue: Promise.resolve(),

  launcher: null,
  wsUrl: '',
  controlClient: null,
  controlConnected: false,
  sidebarProvider: null,
  deactivating: false,

  sessions: new Map(),

  serverStartRemediationAttempted: false,

  serverStartProgressResolve: null,
  serverStartProgressReporter: null,
  serverStartupConnected: false,

  projectRoot: '',
  physicalRoot: '',
  hasWorkspace: false,
  modeState: 'local',
  windowId: '',

  cloudRegistryState: {},
  openRouterCatalogState: [],
  activeCloudVendorState: DEFAULT_CLOUD_VENDOR,
  localRegistryState: [],
  activeLocalModelState: '',
  effectiveLocalModelState: '',
  llamaInstalledState: false,
  llamaVersionState: '',
  llamaLatestVersionState: null,
  llamaInstallingState: false,
  llamaRunningState: false,
  llamaRunningModelState: '',
  llamaStartingState: false,
  llamaStoppingState: false,
  llamaServerOverridePathState: null,
  llamaStartProgressResolve: null,
  detectedVramGbState: null,
  detectedRamGbState: null,
  thinkingFamiliesState: {},
  samplingSpecsState: [],
  knobDefsState: {},
  llamaArgCatalogState: [],
  localDownloadsState: [],
  localUpdatableNamesState: [],

  customFileInstalledCache: new Map(),

  reconciledOpenSessions: false,
  serializerStateIsDead: false,

  pendingControl: new Map(),

  llamaProgressReporter: null,
  llamaProgressResolve: null,
  llamaProgressReject: null,
  llamaLastPct: 0,
};
