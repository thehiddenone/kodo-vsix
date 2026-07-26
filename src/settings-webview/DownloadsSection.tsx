import { useEffect, useState } from 'preact/hooks';
import { formatBytes, formatSpeed } from './localLlmUtils';
import type { LocalDownloadState, LocalRegistryEntry } from './types';
import { vscode } from './vscode';

interface DownloadRowProps {
  dl: LocalDownloadState;
  localRegistry: LocalRegistryEntry[];
}

function DownloadRow({ dl, localRegistry }: DownloadRowProps) {
  // Same immediate-feedback pattern as ModelCard's install/update buttons —
  // the next disk-poll tick always re-renders this row from scratch. Reset
  // on every status change (this component's state persists across renders,
  // unlike the original's from-scratch DOM rebuild) so a pause→resume cycle
  // doesn't leave the Pause button stuck disabled/"Pausing…" forever.
  const [pausing, setPausing] = useState(false);
  const [resuming, setResuming] = useState(false);
  useEffect(() => { setPausing(false); setResuming(false); }, [dl.status]);

  const dlEntry = localRegistry.find((e) => e.name === dl.name);
  const pct = dl.bytes_total ? Math.min(100, (dl.bytes_downloaded / dl.bytes_total) * 100) : 0;
  let labelText = dl.bytes_total
    ? `${formatBytes(dl.bytes_downloaded)} / ${formatBytes(dl.bytes_total)}`
    : `${formatBytes(dl.bytes_downloaded)} downloaded`;
  if (dl.status === 'downloading' && dl.bytes_per_second != null) {
    labelText += ` — ${formatSpeed(dl.bytes_per_second)}`;
  }
  const statusText = dl.status === 'paused' ? 'Paused'
    : dl.status === 'failed' ? `Failed${dl.error ? `: ${dl.error}` : ''}`
    : 'Downloading…';

  return (
    <>
      <div className="download-row">
        <div className="download-name">{dlEntry?.description || dl.name}</div>
        <div className="download-repo">{dl.repo_id}</div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
        <div className="progress-label">{labelText}</div>
        <div className={`download-status ${dl.status}`}>{statusText}</div>
        <div className="row-buttons">
          {dl.status === 'downloading' ? (
            <button
              className="secondary-btn"
              disabled={pausing}
              onClick={() => { setPausing(true); vscode.postMessage({ type: 'pause', name: dl.name }); }}
            >
              {pausing ? 'Pausing…' : 'Pause'}
            </button>
          ) : (
            <button
              disabled={resuming}
              onClick={() => { setResuming(true); vscode.postMessage({ type: 'resume', name: dl.name }); }}
            >
              {resuming ? 'Resuming…' : 'Resume'}
            </button>
          )}
          <button className="secondary-btn" onClick={() => vscode.postMessage({ type: 'cancel', name: dl.name })}>
            Cancel
          </button>
        </div>
      </div>
      <hr className="divider" />
    </>
  );
}

interface DownloadsSectionProps {
  downloads: LocalDownloadState[];
  localRegistry: LocalRegistryEntry[];
}

/** Nothing downloading — show nothing at all, mirroring the original. */
export function DownloadsSection({ downloads, localRegistry }: DownloadsSectionProps) {
  if (downloads.length === 0) { return null; }
  return (
    <div id="downloads-section">
      <hr className="divider" />
      {downloads.map((dl) => <DownloadRow key={dl.name} dl={dl} localRegistry={localRegistry} />)}
    </div>
  );
}

export function UpdatesBanner({ updatableNames, localRegistry }: { updatableNames: string[]; localRegistry: LocalRegistryEntry[] }) {
  const names = updatableNames || [];
  if (names.length === 0) { return null; }
  const labels = names.map((name) => localRegistry.find((e) => e.name === name)?.description || name);
  const text = names.length === 1
    ? `An update is available for ${labels[0]}.`
    : `Updates are available for ${names.length} models: ${labels.join(', ')}.`;
  return <div id="updates-banner">⚠️ {text}</div>;
}
