/** Host-side wire shapes for the Kōdo Settings panel — the `KodoSettingsState`
 *  pushed to the webview and the `KodoSettingsMessage`s it sends back. The
 *  webview bundle (`src/settings-webview/`) keeps its own independent copies
 *  of these same shapes (see `session/types.ts`'s doc comment on why host and
 *  webview sides duplicate small wire types rather than share one module). */

import type { ApiKeyEntry } from '../cloud-credentials';
import type { HfTokenEntry } from '../hf-tokens';
import type { CloudRegistry, EffortLevel, LocalDownloadState, LocalRegistryEntry } from '../llm-registry-types';
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

export interface AddFlavorPayload {
  /** The local registry entry this flavor is being added to. */
  name: string;
  flavor_name: string;
  description: string;
  /** Raw multi-line "--flag value" text box content, parsed server-side. */
  llama_args_text: string;
  /** GB, 0 = unknown/no requirement — see LlamaFlavorInfo.min_ram/min_vram. */
  min_ram: number;
  min_vram: number;
}

export interface UpdateFlavorPayload {
  /** The local registry entry the edited flavor belongs to. */
  name: string;
  /** The existing flavor's id — kept fixed, never re-derived from flavor_name. */
  flavor_id: string;
  flavor_name: string;
  description: string;
  /** Raw multi-line "--flag value" text box content, parsed server-side. */
  llama_args_text: string;
  /** GB, 0 = unknown/no requirement. Not carried forward if omitted — the
   * modal always resends its own fields' current contents. */
  min_ram: number;
  min_vram: number;
}

export interface KodoSettingsState {
  rules: GlobalRuleEntry[];
  stuckDetection: StuckDetectionSettings;
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
}

export type KodoSettingsMessage =
  | { type: 'ready' }
  | { type: 'delete_rules'; rules: GlobalRuleEntry[] }
  | ({ type: 'set_stuck_detection' } & StuckDetectionSettings)
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
  | ({ type: 'add_flavor' } & AddFlavorPayload)
  | ({ type: 'update_flavor' } & UpdateFlavorPayload)
  | { type: 'remove_flavor'; name: string; flavor_id: string }
  | { type: 'close' };
