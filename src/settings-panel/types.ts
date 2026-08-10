/** Host-side wire shapes for the Kōdo Settings panel — the `KodoSettingsState`
 *  pushed to the webview and the `KodoSettingsMessage`s it sends back. The
 *  webview bundle (`src/settings-webview/`) keeps its own independent copies
 *  of these same shapes (see `session/types.ts`'s doc comment on why host and
 *  webview sides duplicate small wire types rather than share one module). */

import type { ApiKeyEntry } from '../cloud-credentials';
import type { HfTokenEntry } from '../hf-tokens';
import type {
  CloudRegistry,
  EffortLevel,
  KnobDefs,
  LlamaArgSpec,
  LocalDownloadState,
  LocalRegistryEntry,
  SamplingParamSpec,
} from '../llm-registry-types';
import type { RememberedWorkspace } from '../workspace-resume-policy';

/** A granted "always allow" rule (doc/SECURITY_RULES_PLAN.md §2.7,
 * kodo/doc/WS_PROTOCOL.md §7.6c/§7.6e). `kind: "command"` is an (executable,
 * subcommand) pair; `kind: "path"` is a workspace-escape (executable,
 * resolved absolute path) pair. Same shape for both the global store
 * (`security.rules.*`) and a single session's store
 * (`session.security_rules.*`). */
export interface GlobalRuleEntry {
  kind: 'command' | 'path';
  executable: string;
  value: string;
}

/** One row of the Kōdo Settings panel's "Sessions" list — the same data
 * `pickSession()` already parses from `session.list` (kodo/doc/WS_PROTOCOL.md
 * § "New client→server: session.list"), reused here so opening the panel
 * needs no extra round-trip beyond the one `session.list` fetch. */
export interface SessionListEntry {
  id: string;
  name: string;
  workflowMode: string | null;
  taken: boolean;
  workspace: RememberedWorkspace | null;
}

/** The session-scoped allow-rules currently shown in the "Session Settings"
 * modal — `null` while no modal is open or its fetch hasn't resolved yet. */
export interface SessionRulesState {
  sessionId: string;
  rules: GlobalRuleEntry[];
}

/** The `stuck_detection` settings block (kodo/doc/SETTINGS.md §2.6,
 * kodo/doc/WS_PROTOCOL.md §7.6d) — backs the Kōdo Settings panel's
 * "General" section. */
export interface StuckDetectionSettings {
  active: 'off' | 'local_only' | 'local_and_cloud';
  scope: 'top_level' | 'top_level_and_subagents';
  auto_unstuck_interactive: boolean;
}

/** One entry in the "housekeeper LLM" catalog (kodo.titling.
 * HOUSEKEEPER_LLM_OPTIONS, kodo/doc/SETTINGS.md §2.7) — the small local model
 * that writes session titles/greetings. `id` is a `HousekeeperLlmOption.
 * model_id`, also the wire value persisted as `housekeeper_llm` in
 * settings.json. */
export interface HousekeeperLlmOption {
  id: string;
  name: string;
  description: string;
}

/** The `housekeeper_llm` settings block (kodo/doc/SETTINGS.md §2.7,
 * kodo/doc/WS_PROTOCOL.md §7.6f) — backs the Kōdo Settings panel's "General"
 * section's "Housekeeper LLM" subsection. `options` mirrors the server's
 * `HOUSEKEEPER_LLM_OPTIONS` catalog verbatim, in catalog order — the panel
 * renders one radio button per entry with no id hardcoded client-side, so a
 * new catalog entry server-side needs no kodo-vsix change to appear here. */
export interface HousekeeperLlmSettings {
  selected: string;
  options: HousekeeperLlmOption[];
}

/** llama.cpp install state backing the "Llama.cpp" section (kodo/doc/
 * WS_PROTOCOL.md §7.6, `llamacpp.version_info`). `installedVersion`/
 * `latestVersion` are `"bN"` strings or `null` ("not installed"/"unknown" —
 * the latter only when the GitHub Releases fetch failed). `busy` disables
 * every button while an install/update/uninstall is in flight. */
export interface LlamaCppInfo {
  installedVersion: string | null;
  latestVersion: string | null;
  busy: boolean;
}

/** The "Show Timestamps" flags (kodo-vsix-only — never sent to or read by the
 *  kodo server) backing the "General" section's top subsection. Persisted to
 *  `~/.kodo/etc/ui-settings.json` (`extension/settings-io.ts`'s
 *  `readUiSettings`/`writeUiSettings`) — a dedicated file, deliberately
 *  separate from the server-mirrored `~/.kodo/etc/settings.json`
 *  (`readSettings`/`writeSettings`). `clockFormat` is one of six presets
 *  (`<dateOrder>_<12h|24h>`, e.g. `"ymd_24h"`) the webview's `webview/types.ts`
 *  `ClockFormatPreset` also defines — kept as a plain `string` here (not that
 *  union) since the host and webview sides define their own copies of small
 *  wire types independently (see `session/types.ts`'s duplicated
 *  `EditControl`/`CommandControl`), and the six option values/labels are
 *  hardcoded into the settings webview's own copy
 *  (`settings-webview/GeneralSection.tsx`'s `CLOCK_FORMAT_OPTIONS`) rather
 *  than shared. */
export interface UiSettings {
  showTimestamps: boolean;
  timezone: string;
  clockFormat: string;
  /** Whether Enter (alone) sends the prompt and Shift+Enter adds a newline
   *  (`true`, the default — preserves the input box's original behavior), or
   *  the reverse (`false`: Enter adds a newline, Shift+Enter sends). Backs
   *  the "General" section's "How to submit a prompt" radio choice. */
  enterSubmits: boolean;
  /** Names of pinned local LLM registry entries, in pin order (oldest pin
   *  first/topmost) — sidebar-only, never surfaced in this settings panel.
   *  See `sidebar-provider.ts`'s pin/unpin handling. */
  pinnedLocalModels: string[];
  /** Same as `pinnedLocalModels` but for cloud vendor keys. */
  pinnedCloudVendors: string[];
  /** Local registry entry names ("quants") for which the user picked "Start
   *  anyway, don't ask again" on the pre-launch memory/llama.cpp-version
   *  warning dialog (`confirmLocalLlamaLaunch`, `extension/local-llm-registry.ts`)
   *  — every future launch attempt for that exact quant skips the dialog
   *  entirely, no matter what warnings apply at the time. One-way: nothing
   *  in the product removes an entry from this list once added (no "re-enable
   *  warnings" UI exists), mirroring how this whole file has no in-app editor. */
  dismissedLocalLaunchWarnings: string[];
  /** Absolute path of the directory the "+" attach-file dialog last opened
   *  into — updated to the containing folder of the most recently attached
   *  file. Host-only (never surfaced in this settings panel); falls back to
   *  the workspace root, then the user's home directory, when empty or when
   *  the saved directory no longer exists. See `attachment-manager.ts`. */
  lastAttachDir: string;
  /** Whether the "Local Inference" tab's "Available local LLM quants" list
   *  shows every registry entry (`true`) or hides ones the detected
   *  VRAM+RAM can't run (`false`, the default — `ramWarning`'s red/yellow
   *  cases in `settings-webview/localLlmUtils.ts`). Never hides an already
   *  *installed* entry, regardless of its value. Backs the "Local Inference"
   *  section's "Show all LLM quants including those that will not run on
   *  this system due to insufficient RAM/VRAM" checkbox. */
  showAllLocalLlmQuants: boolean;
}

/** Payloads shared with the (former, now-merged-in) Local Inference Settings
 * panel — kodo/doc/LLM_REGISTRY.md §4. */
export interface AddHuggingfaceLlmPayload {
  name: string;
  description: string;
  repo_id: string;
  filename: string;
  llama_args: Record<string, string>;
  context_window: number;
}

export interface AddFileLlmPayload {
  name: string;
  description: string;
  path: string;
  llama_args: Record<string, string>;
  context_window: number;
}

export interface AddServerUrlLlmPayload {
  name: string;
  description: string;
  url: string;
}

export interface AddProfilePayload {
  /** The local registry entry this profile is being added to. */
  name: string;
  profile_name: string;
  description: string;
  /** Raw multi-line "--flag value" text box content, parsed server-side.
   * Carries the argument picker's rows too — the picker and the raw box are
   * two views of the same text (see `ProfileModal.tsx`). */
  llama_args_text: string;
}

export interface UpdateProfilePayload {
  /** The local registry entry the edited profile belongs to. */
  name: string;
  /** The existing profile's id — kept fixed, never re-derived from profile_name. */
  profile_id: string;
  profile_name: string;
  description: string;
  /** Raw multi-line "--flag value" text box content, parsed server-side. */
  llama_args_text: string;
}

export interface KodoSettingsState {
  rules: GlobalRuleEntry[];
  stuckDetection: StuckDetectionSettings;
  housekeeperLlm: HousekeeperLlmSettings;
  llamaCpp: LlamaCppInfo;
  sessions: SessionListEntry[];
  sessionRules: SessionRulesState | null;
  uiSettings: UiSettings;
  /** Configured HuggingFace tokens. */
  hfTokens: HfTokenEntry[];
  /** Per-vendor tab state (former standalone Cloud AI Settings panel) —
   * hardcoded vendor metadata/models, mirrors settings.json `models.cloud`. */
  cloudRegistry: CloudRegistry;
  /** vendor -> effort -> model_id. */
  modelsByVendor: Record<string, Record<string, string>>;
  /** vendor -> its configured API keys. */
  keysByVendor: Record<string, ApiKeyEntry[]>;
  /** "Local Inference" tab state (former Local Inference Settings panel). */
  localRegistry: LocalRegistryEntry[];
  llamaServerOverridePath: string | null;
  detectedVramGb: number | null;
  detectedRamGb: number | null;
  /** Live download progress, polled off disk — see local-model-downloads.ts. */
  downloads: LocalDownloadState[];
  /** Picks gpu_tip vs mac_tip and the "Show me local files" label. */
  isMac: boolean;
  /**
   * Names of installed models whose remote GGUF no longer matches what's on
   * disk (an ETag mismatch found by `local_llm.check_updates` /
   * `LocalModelManager.check_for_update` — kodo/doc/LOCAL_MODEL_MANAGER.md
   * §12). Drives the yellow "updates available" banner and each affected
   * card's "Update" button. Populated asynchronously — empty until the
   * fire-and-forget scan kicked off when the "Local Inference" tab opens
   * replies.
   */
  updatableNames: string[];
  /** The server's request-level sampling parameter table (`sampling_specs`,
   * kodo/doc/SAMPLING.md). Drives both the session sampling modal and the
   * profile editor's argument rows; `[]` before the first registry payload
   * lands, which simply hides that section. */
  samplingSpecs: SamplingParamSpec[];
  /** Every knob definition any entry offers, keyed by id (`knob_defs`,
   * kodo/doc/LLM_REGISTRY.md §4.6) — shipped once per payload rather than
   * repeated on all 82 entries. Drives the Configure modal. */
  knobDefs: KnobDefs;
  /** The curated llama-server flag table the user-defined profile editor's
   * "Add argument" picker renders from (`llama_arg_catalog`,
   * kodo/doc/LLM_REGISTRY.md §4.7). */
  llamaArgCatalog: LlamaArgSpec[];
}

export type KodoSettingsMessage =
  | { type: 'ready' }
  | { type: 'delete_rules'; rules: GlobalRuleEntry[] }
  | ({ type: 'set_stuck_detection' } & StuckDetectionSettings)
  | { type: 'set_housekeeper_llm'; id: string }
  | ({ type: 'set_ui_settings' } & UiSettings)
  | { type: 'install_llamacpp' }
  | { type: 'uninstall_llamacpp' }
  | { type: 'update_llamacpp' }
  | { type: 'install_llamacpp_version_prompt' }
  | { type: 'delete_session'; sessionId: string }
  | { type: 'open_session'; sessionId: string }
  | { type: 'fetch_session_rules'; sessionId: string }
  | { type: 'delete_session_rules'; sessionId: string; rules: GlobalRuleEntry[] }
  | { type: 'add_hf_token'; name: string; secret: string }
  | { type: 'remove_hf_token'; uuid: string }
  | { type: 'activate_hf_token'; uuid: string }
  | { type: 'set_cloud_model'; vendor: string; effort: EffortLevel; model_id: string }
  | { type: 'add_key'; vendor: string; name: string; secret: string }
  | { type: 'forget_key'; vendor: string; uuid: string }
  | { type: 'make_active'; vendor: string; uuid: string }
  | ({ type: 'add_huggingface' } & AddHuggingfaceLlmPayload)
  | ({ type: 'add_file' } & AddFileLlmPayload)
  | ({ type: 'add_server_url' } & AddServerUrlLlmPayload)
  | { type: 'pick_gguf_file' }
  | { type: 'install'; name: string }
  | { type: 'pause'; name: string }
  | { type: 'resume'; name: string }
  | { type: 'cancel'; name: string }
  | { type: 'uninstall'; name: string }
  | { type: 'update'; name: string }
  | { type: 'remove'; name: string }
  | { type: 'reveal'; name: string }
  | { type: 'set_override' }
  | { type: 'remove_override' }
  | ({ type: 'add_profile' } & AddProfilePayload)
  | ({ type: 'update_profile' } & UpdateProfilePayload)
  | { type: 'remove_profile'; name: string; profile_id: string }
  | { type: 'set_active_profile'; name: string; profile_id: string }
  | { type: 'set_knobs'; name: string; knobs: Record<string, string> }
  | { type: 'close' };
