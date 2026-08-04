/**
 * Webview-local copies of the Kōdo Settings panel's wire shapes — kept
 * independent from `src/settings-panel/types.ts` (the host side), mirroring
 * the same host/webview type-duplication convention `src/webview/types.ts`
 * already uses relative to `src/session/types.ts`.
 */

export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

/** A sparse set of request-level sampling parameters (kodo/doc/SAMPLING.md).
 * Mirrors the shared `SamplingValues` in ../llm-registry-types, per this
 * file's webview-local-copy convention. */
export type SamplingValues = Record<string, number | string[]>;

/** Webview-local mirror of the shared `SamplingParamSpec` (see
 * ../llm-registry-types for the field docs). */
export interface SamplingParamSpec {
  name: string;
  kind: 'float' | 'int' | 'str_list';
  label: string;
  advanced: boolean;
  minimum: number | null;
  maximum: number | null;
  step: number | null;
  neutral: string;
  cli_flags: string[];
  help: string;
}

export interface GlobalRuleEntry {
  kind: 'command' | 'path';
  executable: string;
  value: string;
}

export interface RememberedWorkspace {
  physicalRoot: string;
  folders: Record<string, string>;
  codeWorkspaceFile: string | null;
  locked: boolean;
  compatible: boolean;
}

export interface SessionListEntry {
  id: string;
  name: string;
  workflowMode: string | null;
  taken: boolean;
  workspace: RememberedWorkspace | null;
}

export interface SessionRulesState {
  sessionId: string;
  rules: GlobalRuleEntry[];
}

export interface StuckDetectionSettings {
  active: 'off' | 'local_only' | 'local_and_cloud';
  scope: 'top_level' | 'top_level_and_subagents';
  auto_unstuck_interactive: boolean;
}

export interface LlamaCppInfo {
  installedVersion: string | null;
  latestVersion: string | null;
  busy: boolean;
}

export interface UiSettings {
  showTimestamps: boolean;
  timezone: string;
  clockFormat: string;
  /** Whether Enter (alone) sends the prompt and Shift+Enter adds a newline
   *  (`true`, the default), or the reverse (`false`). Backs the "General"
   *  section's "How to submit a prompt" radio choice. */
  enterSubmits: boolean;
}

export interface HfTokenEntry {
  uuid: string;
  name: string;
  active: boolean;
}

export interface ApiKeyEntry {
  uuid: string;
  name: string;
  active: boolean;
}

export interface CloudModelInfo {
  model_id: string;
  name: string;
  recommendation?: string;
}

export interface CloudVendorRegistryInfo {
  display_name: string;
  models: CloudModelInfo[];
}

export type CloudRegistry = Record<string, CloudVendorRegistryInfo>;

export type LlamaFlavorPlatform = 'mac' | 'gpu' | 'both';

export interface LocalFlavor {
  id: string;
  name: string;
  description?: string;
  llama_args?: Record<string, string>;
  min_ram?: number;
  min_vram?: number;
  predefined?: boolean;
  platform?: LlamaFlavorPlatform;
  /** Request-level sampling defaults (kodo/doc/SAMPLING.md §9) — sparse,
   * holding only what is set; `{}` for every built-in flavor. */
  sampling?: SamplingValues;
}

export interface LocalRegistryEntry {
  name: string;
  kind: 'hardcoded_hf' | 'custom_hf' | 'custom_file' | 'custom_server_url';
  description?: string;
  base_llm?: string;
  quant_type?: string;
  quant_author?: string;
  repo_id?: string;
  path?: string;
  url?: string;
  size_hint?: string;
  mac_tip?: string;
  gpu_tip?: string;
  min_memory?: number;
  memory?: number;
  llm_author?: string;
  llamacpp_version?: number;
  installed: boolean;
  installed_path?: string;
  flavors: LocalFlavor[];
  active_flavor?: string;
}

export interface LocalDownloadState {
  name: string;
  repo_id: string;
  bytes_downloaded: number;
  bytes_total: number | null;
  bytes_per_second: number | null;
  status: 'downloading' | 'paused' | 'failed';
  error?: string;
}

export interface KodoSettingsState {
  rules: GlobalRuleEntry[];
  stuckDetection: StuckDetectionSettings;
  llamaCpp: LlamaCppInfo;
  sessions: SessionListEntry[];
  sessionRules: SessionRulesState | null;
  uiSettings: UiSettings;
  hfTokens: HfTokenEntry[];
  cloudRegistry: CloudRegistry;
  modelsByVendor: Record<string, Record<string, string>>;
  keysByVendor: Record<string, ApiKeyEntry[]>;
  localRegistry: LocalRegistryEntry[];
  llamaServerOverridePath: string | null;
  detectedVramGb: number | null;
  detectedRamGb: number | null;
  downloads: LocalDownloadState[];
  isMac: boolean;
  updatableNames: string[];
  /** The server's request-level sampling parameter table (`sampling_specs`,
   * kodo/doc/SAMPLING.md). Drives the flavor editor's request-level defaults
   * form and its CLI-vs-request conflict warning; `[]` before the first
   * registry payload lands, which simply hides that section. */
  samplingSpecs: SamplingParamSpec[];
}

export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'max'];

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low effort',
  medium: 'Medium effort',
  high: 'High effort',
  max: 'Max effort',
};

export const EFFORT_EXAMPLES: Record<EffortLevel, string> = {
  low: 'Example workload: renaming a variable across a few files, formatting cleanup, drafting a commit message.',
  medium: 'Example workload: implementing a small feature end-to-end, fixing a bug that touches a couple of files.',
  high: 'Example workload: refactoring a subsystem, debugging a subtle concurrency issue, reviewing a large diff.',
  max: 'Example workload: architecting a cross-cutting feature, untangling a gnarly production incident, deep multi-file refactors under tight constraints.',
};

export interface CloudVendorMeta {
  label: string;
  icon: string;
  coming_soon_text: string;
}

// Every cloud vendor gets its own top-level nav entry — the ones without a
// working cloudRegistry entry yet fall back to the "coming soon" panel (only
// "anthropic" is wired server-side today; see LLM_REGISTRY.md).
export const CLOUD_VENDORS: Record<string, CloudVendorMeta> = {
  anthropic: { label: 'Anthropic', icon: '⚛️', coming_soon_text: '' },
  openai: { label: 'OpenAI', icon: '🧠', coming_soon_text: "GPT models are being wired up next. Once ready, you'll be able to add OpenAI API keys and assign GPT models to each effort level right here." },
  google: { label: 'Google', icon: '✨', coming_soon_text: "Gemini is next on the roadmap. When it ships, a Google API key here will route each effort level straight to a Gemini model." },
  meta: { label: 'Meta', icon: '🦙', coming_soon_text: "Llama model support is on the way. This page will let you manage Meta API access and pick a Llama model per effort level." },
  alibaba: { label: 'Alibaba', icon: '🧞', coming_soon_text: "Qwen support is queued up behind the scenes. Drop in an Alibaba API key once it lands, and pick a Qwen model for each effort level." },
  deepseek: { label: 'DeepSeek', icon: '🐋', coming_soon_text: "DeepSeek's reasoning models are being integrated. Check back soon to configure DeepSeek access and effort-level assignments." },
  kimi: { label: 'Kimi', icon: '🌙', coming_soon_text: 'Kimi support is in the pipeline. Soon you’ll be able to bring your own Kimi API key and route work to its models here.' },
  openrouter: { label: 'OpenRouter', icon: '🔀', coming_soon_text: "OpenRouter will let you tap into many vendors through a single key. We're building the plumbing — this page will host that configuration." },
};

export const CLOUD_VENDOR_KEYS = Object.keys(CLOUD_VENDORS);

export interface NavEntry {
  key: string;
  label: string;
}

export const NAV: NavEntry[] = [
  { key: 'general', label: 'General' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'global-rules', label: 'Global Allow-Rules' },
  { key: 'local-inference', label: 'Local Inference' },
  ...CLOUD_VENDOR_KEYS.map((key) => ({ key, label: `${CLOUD_VENDORS[key].icon} ${CLOUD_VENDORS[key].label}` })),
];

/** A rule's identity for a checked-set (Set<string>), mirroring the original
 *  `ruleKey` helper exactly. */
export function ruleKey(rule: GlobalRuleEntry): string {
  return `${rule.kind}|${rule.executable}|${rule.value}`;
}

/** Every message this webview can post to the host — mirrors
 *  `src/settings-panel/types.ts`'s `KodoSettingsMessage` (host-side copy). */
export type OutboundMessage =
  | { type: 'ready' }
  | { type: 'close' }
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
  | { type: 'add_huggingface'; name: string; description: string; repo_id: string; filename: string; llama_args: Record<string, string>; context_window: number }
  | { type: 'add_file'; name: string; description: string; path: string; llama_args: Record<string, string>; context_window: number }
  | { type: 'add_server_url'; name: string; description: string; url: string }
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
  | { type: 'add_flavor'; name: string; flavor_name: string; description: string; llama_args_text: string; min_ram: number; min_vram: number; platform: LlamaFlavorPlatform; sampling: SamplingValues }
  | { type: 'update_flavor'; name: string; flavor_id: string; flavor_name: string; description: string; llama_args_text: string; min_ram: number; min_vram: number; platform: LlamaFlavorPlatform; sampling: SamplingValues }
  | { type: 'remove_flavor'; name: string; flavor_id: string };

/** Messages the host can post into this webview. */
export type InboundMessage =
  | ({ type: 'update' } & Partial<KodoSettingsState>)
  | { type: 'select_section'; key: string }
  | { type: 'gguf_file_picked'; path: string | null };
