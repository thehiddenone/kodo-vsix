/** Shared helpers for the "Local Inference" tab's add-LLM and manage-flavors
 *  modals — parsing form input into the wire shapes the host expects, and
 *  the local-registry name-clash check every add form validates against. */

import type { LlamaFlavorPlatform, LocalRegistryEntry } from './types';

export const DEFAULT_CONTEXT_WINDOW = 262144;
export const HF_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseLlamaArgs(text: string): Record<string, string> {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const result: Record<string, string> = {};
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    result[tokens[i]] = tokens[i + 1];
  }
  return result;
}

export function parseNonNegativeInt(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) { return 0; }
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function nameTaken(localRegistry: LocalRegistryEntry[], name: string): boolean {
  return localRegistry.some((e) => e.name === name);
}

export function llamaArgsToText(llamaArgs: Record<string, string> | undefined): string {
  return Object.entries(llamaArgs || {})
    .map(([flag, value]) => (value ? `${flag} ${value}` : flag))
    .join('\n');
}

// The "Manage flavors" modal's platform radio group — order matters (render
// order). `both` (no restriction) is the default for a brand-new flavor,
// mirroring the server's LlamaFlavorPlatform.BOTH default.
export const FLAVOR_PLATFORM_OPTIONS: { value: LlamaFlavorPlatform; label: string }[] = [
  { value: 'mac', label: 'Apple Silicon only' },
  { value: 'gpu', label: 'NVIDIA GPU only' },
  { value: 'both', label: 'Apple Silicon and NVIDIA GPU' },
];

// Short badge text for a flavor's platform restriction in the "Manage
// flavors" list — omitted (empty string) for 'both' since that's "no
// restriction," not something worth calling out next to every row.
export function flavorPlatformBadge(platform: LlamaFlavorPlatform | undefined): string {
  if (platform === 'mac') { return 'Apple Silicon only'; }
  if (platform === 'gpu') { return 'NVIDIA GPU only'; }
  return '';
}

export const DOWNLOADABLE = new Set(['hardcoded_hf', 'custom_hf']);
export const CUSTOM = new Set(['custom_hf', 'custom_file', 'custom_server_url']);
export const FLAVOR_CAPABLE = new Set(['hardcoded_hf', 'custom_hf', 'custom_file']);

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) { return ''; }
  const mb = n / (1024 * 1024);
  return mb < 1024 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(2)} GB`;
}

// Auto-scales B/s -> KB/s -> MB/s -> GB/s (1024-based), unlike formatBytes
// above: a speed can legitimately sit well under 1 MB/s on a slow
// connection, where formatBytes' MB/GB-only scale would round to '0 MB'.
export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond === null || bytesPerSecond === undefined || bytesPerSecond < 0) { return ''; }
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = bytesPerSecond;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const formatted = unitIndex === 0 ? Math.round(value).toString() : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

export interface RamWarning {
  level: 'red' | 'yellow';
  text: string;
}

// Rules (per product spec): red if below the absolute minimum; yellow if
// below the recommended amount. When min_memory === memory, the red check
// already covers every case the yellow check would (vram >= min == memory
// implies vram >= memory), so only red can ever fire — no special-casing
// needed. A 0 value means "unknown — don't warn" for that threshold.
// vram/ram are summed into one "total memory available for a
// GPU+CPU-offloaded model" figure — on macOS ram is always null (vram
// already reports the full unified-memory pool), so the sum degrades to
// vram alone there. See doc/LLM_REGISTRY.md §4.4 in the kodo repo.
export function ramWarning(
  entry: LocalRegistryEntry,
  vram: number | null,
  ram: number | null,
): RamWarning | null {
  if (vram === null && ram === null) { return null; }
  const total = (vram || 0) + (ram || 0);
  const min = entry.min_memory || 0;
  const rec = entry.memory || 0;
  if (min > 0 && total < min) {
    return {
      level: 'red',
      text: `⛔ This LLM will likely not run on this machine — it needs at least ${min} GB of combined VRAM + RAM, but only ${total} GB was detected.`,
    };
  }
  if (rec > 0 && total < rec) {
    return {
      level: 'yellow',
      text: `⚠️ This LLM may not perform well with large contexts on this machine — ${rec} GB of combined VRAM + RAM is recommended, but only ${total} GB was detected.`,
    };
  }
  return null;
}

export interface LlamaCppVersionWarning {
  level: 'red';
  text: string;
}

// entry.llamacpp_version is a bare build number (0 = "any version works —
// don't warn"); the installed version is the "b<N>" string llama-server
// itself reports (see doc/WS_PROTOCOL.md §4.1, doc/LLM_REGISTRY.md §4.4).
// installedVersion is null until the first hello.ack/version_info reply —
// don't warn on unknown state, same convention as ramWarning's vram/ram nulls.
export function llamacppVersionWarning(
  entry: LocalRegistryEntry,
  installedVersion: string | null,
): LlamaCppVersionWarning | null {
  const required = entry.llamacpp_version || 0;
  if (required <= 0 || !installedVersion) { return null; }
  const installed = parseInt(installedVersion.replace(/^b/i, ''), 10);
  if (!Number.isFinite(installed) || installed >= required) { return null; }
  return {
    level: 'red',
    text: `⛔ The installed llama.cpp (b${installed}) does not support this LLM — it requires at least b${required}. Update llama.cpp to run it.`,
  };
}
