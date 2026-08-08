import { useEffect, useState } from 'preact/hooks';
import { DOWNLOADABLE, CUSTOM, PROFILE_CAPABLE, ramWarning, llamacppVersionWarning } from './localLlmUtils';
import type { LocalRegistryEntry } from './types';
import { vscode } from './vscode';

interface ModelCardProps {
  entry: LocalRegistryEntry;
  downloadingNames: Set<string>;
  updatableNames: string[];
  isMac: boolean;
  detectedVramGb: number | null;
  detectedRamGb: number | null;
  installedLlamaCppVersion: string | null;
  /** Opens the Default profile's knobs (ConfigureModal). */
  onConfigure: (name: string) => void;
  /** Opens the user-defined profile editor (ProfileModal). */
  onManageProfiles: (name: string) => void;
}

export function ModelCard({
  entry, downloadingNames, updatableNames, isMac, detectedVramGb, detectedRamGb, installedLlamaCppVersion,
  onConfigure, onManageProfiles,
}: ModelCardProps) {
  const tip = isMac ? entry.mac_tip : entry.gpu_tip;
  const warning = ramWarning(entry, detectedVramGb, detectedRamGb);
  const versionWarning = llamacppVersionWarning(entry, installedLlamaCppVersion);
  const updatable = DOWNLOADABLE.has(entry.kind) && entry.installed && updatableNames.includes(entry.name);
  // Immediate feedback only — the next 'update' (kickoff reply, disk-poll
  // tick, or an error event's registry_state) always re-renders this card
  // from scratch, so a silent early failure just gets a normal button back.
  // Unlike the original (which rebuilt this card's DOM from scratch every
  // render, so a fresh button was guaranteed), this component's state
  // persists across renders — so each flag must be explicitly reset once
  // the condition that made it relevant has moved on, or a failed
  // install/update would leave the button stuck disabled forever.
  const [installing, setInstalling] = useState(false);
  const [updating, setUpdating] = useState(false);
  const isDownloading = downloadingNames.has(entry.name);
  useEffect(() => setInstalling(false), [entry.installed, isDownloading]);
  useEffect(() => setUpdating(false), [updatable]);

  return (
    <div className="model-card">
      {/* entry.name is an internal identifier for hardcoded entries (a slug);
          only custom entries lack a description and fall back to the
          user-typed name. */}
      <div className="cell-name">{entry.description || entry.name}</div>

      {(entry.quant_type || entry.quant_author) && (
        <div className="model-meta-line">{[entry.quant_type, entry.quant_author].filter(Boolean).join(' · ')}</div>
      )}

      {entry.repo_id ? (
        <div className="model-meta-line"><a href={`https://huggingface.co/${entry.repo_id}`}>{entry.repo_id}</a></div>
      ) : entry.kind === 'custom_file' && entry.path ? (
        <div className="model-meta-line">{entry.path}</div>
      ) : entry.kind === 'custom_server_url' && entry.url ? (
        <div className="model-meta-line">{entry.url}</div>
      ) : null}

      {entry.size_hint && (
        <div className="model-meta-line"><span className="meta-label">Size: </span>{entry.size_hint}</div>
      )}

      {tip && <div className="hw-tip">{tip}</div>}

      {warning && <div className={`ram-warning ${warning.level}`}>{warning.text}</div>}

      {versionWarning && <div className={`ram-warning ${versionWarning.level}`}>{versionWarning.text}</div>}

      {entry.installed && <span className="installed-tag">Installed</span>}

      {updatable && <div className="update-available-tag">⚠️ Update available</div>}

      <div className="row-buttons">
        {/* Which configuration is *active* is chosen in the sidebar; these two
            buttons edit the definitions. "Configure" is the Default profile's
            knobs, "Manage profiles" the user-defined arg sets — the same split
            the sidebar card makes. Only meaningful once the model is
            installed, since both describe how to launch a local file. */}
        {PROFILE_CAPABLE.has(entry.kind) && entry.installed && (
          <button className="secondary-btn" type="button" onClick={() => onConfigure(entry.name)}>
            Configure
          </button>
        )}

        {PROFILE_CAPABLE.has(entry.kind) && entry.installed && (
          <button className="secondary-btn" type="button" onClick={() => onManageProfiles(entry.name)}>
            Manage profiles
          </button>
        )}

        {DOWNLOADABLE.has(entry.kind) && !entry.installed && (
          isDownloading ? (
            <span className="download-repo">Downloading — see progress above.</span>
          ) : (
            <button
              disabled={installing}
              onClick={() => {
                setInstalling(true);
                vscode.postMessage({ type: 'install', name: entry.name });
              }}
            >
              {installing ? 'Starting download…' : 'Download and Install'}
            </button>
          )
        )}

        {entry.installed && entry.installed_path && (
          <button className="secondary-btn" onClick={() => vscode.postMessage({ type: 'reveal', name: entry.name })}>
            Show me local files
          </button>
        )}

        {updatable && (
          <button
            disabled={updating}
            onClick={() => {
              setUpdating(true);
              vscode.postMessage({ type: 'update', name: entry.name });
            }}
          >
            {updating ? 'Updating…' : 'Update'}
          </button>
        )}

        {DOWNLOADABLE.has(entry.kind) && entry.installed && (
          <button className="secondary-btn" onClick={() => vscode.postMessage({ type: 'uninstall', name: entry.name })}>
            Uninstall
          </button>
        )}

        {CUSTOM.has(entry.kind) && (
          <button className="secondary-btn" onClick={() => vscode.postMessage({ type: 'remove', name: entry.name })}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
