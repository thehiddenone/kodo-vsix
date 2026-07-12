/**
 * Reads live local-LLM download progress straight off disk, by polling
 * `manager-state.json` — the file `kodo.llms.local.LocalModelManager` (server
 * side) already treats as its single source of truth (kodo/doc/
 * LOCAL_MODEL_MANAGER.md §11). There is deliberately no WS push for this:
 * every open VS Code window polls independently and converges on whatever
 * the file says, which is what lets a download started in one window (or
 * left running after the window closed, as long as the kodo-server process
 * stays alive) show up correctly in any window that later opens the Local
 * Inference Settings panel — no broadcast/connection-tracking infra needed.
 *
 * Mirrors `kodo.llms.llamacpp._manager._models_dir`'s resolution rule
 * (`llm_models_dir` in `~/.kodo/etc/settings.json`, else
 * `~/.kodo/llama.cpp/models`) and `_state.py`'s on-disk JSON shape for
 * `ModelRecord`/`ModelFile`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DownloadStatus, LocalDownloadState } from './llm-registry-types';

const POLL_INTERVAL_MS = 1000;

function kodoHomeDir(): string {
  return path.join(os.homedir(), '.kodo');
}

function modelsDir(): string {
  try {
    const settings = JSON.parse(
      fs.readFileSync(path.join(kodoHomeDir(), 'etc', 'settings.json'), 'utf8'),
    ) as Record<string, unknown>;
    if (typeof settings['llm_models_dir'] === 'string' && settings['llm_models_dir']) {
      return settings['llm_models_dir'];
    }
  } catch {
    // fall through to the default below
  }
  return path.join(kodoHomeDir(), 'llama.cpp', 'models');
}

function stateFilePath(): string {
  return path.join(modelsDir(), 'manager-state.json');
}

interface RawModelFile {
  filename: string;
  role: string;
  downloaded_bytes?: number;
  size?: number | null;
  status?: string;
  error?: string;
  bytes_per_second?: number | null;
}

interface RawModelRecord {
  repo_id: string;
  files?: RawModelFile[];
}

/** Parse `manager-state.json`'s raw shape into the per-model summary the UI needs. */
function summarize(modelId: string, raw: RawModelRecord): LocalDownloadState | null {
  const files = (raw.files ?? []).filter((f) => f.role === 'main' || f.role === 'shard');
  if (files.length === 0) {
    return null;
  }
  const installed = files.every((f) => f.status === 'completed');
  if (installed) {
    return null; // fully installed — not a "download in progress" any more
  }
  let status: DownloadStatus = 'downloading';
  let error = '';
  const failed = files.find((f) => f.status === 'failed');
  if (failed) {
    status = 'failed';
    error = failed.error ?? '';
  } else if (files.some((f) => f.status === 'paused')) {
    status = 'paused';
  }
  const bytesDownloaded = files.reduce((sum, f) => sum + (f.downloaded_bytes ?? 0), 0);
  const sizes = files.map((f) => f.size);
  const bytesTotal = sizes.every((s) => typeof s === 'number') ? (sizes as number[]).reduce((a, b) => a + b, 0) : null;
  // Only one file downloads at a time (server's __run_transfer loop is
  // per-file, sequential), so at most one of these is ever non-null — summed
  // rather than picked, since which file that is isn't tracked here.
  const rates = files.map((f) => f.bytes_per_second).filter((r): r is number => typeof r === 'number');
  const bytesPerSecond = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) : null;
  return {
    name: modelId,
    repo_id: raw.repo_id,
    status,
    bytes_downloaded: bytesDownloaded,
    bytes_total: bytesTotal,
    error,
    bytes_per_second: bytesPerSecond,
  };
}

/** Read and parse the state file. Never throws — returns `null` on any error
 * (missing file, a concurrent non-atomic-looking read, corrupt JSON); the
 * caller just keeps showing the last-known-good snapshot until the next tick. */
function readDownloadStates(): Map<string, LocalDownloadState> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(stateFilePath(), 'utf8'));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const result = new Map<string, LocalDownloadState>();
  for (const [modelId, record] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof record !== 'object' || record === null) {
      continue;
    }
    const summary = summarize(modelId, record as RawModelRecord);
    if (summary) {
      result.set(modelId, summary);
    }
  }
  return result;
}

/**
 * Poll `manager-state.json` at a fixed interval, invoking `onChange` only
 * when the file's mtime actually moved (cheap `fs.statSync` check gates the
 * more expensive parse) — so an idle machine with no active download costs
 * one stat() call per second and nothing else.
 */
export function startLocalDownloadPolling(
  onChange: (states: Map<string, LocalDownloadState>) => void,
): { dispose(): void } {
  let lastMtimeMs = -1;

  const tick = (): void => {
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(stateFilePath()).mtimeMs;
    } catch {
      return; // no state file yet — nothing has ever been downloaded
    }
    if (mtimeMs === lastMtimeMs) {
      return;
    }
    const states = readDownloadStates();
    if (states === null) {
      return; // parse raced a non-atomic-looking write — retry next tick
    }
    lastMtimeMs = mtimeMs;
    onChange(states);
  };

  const timer = setInterval(tick, POLL_INTERVAL_MS);
  return { dispose: () => clearInterval(timer) };
}
