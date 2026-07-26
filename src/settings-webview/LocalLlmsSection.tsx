import { useState } from 'preact/hooks';
import { DownloadsSection, UpdatesBanner } from './DownloadsSection';
import { ModelCard } from './ModelCard';
import type { LocalDownloadState, LocalRegistryEntry } from './types';

interface LocalLlmsSectionProps {
  localRegistry: LocalRegistryEntry[];
  downloads: LocalDownloadState[];
  updatableNames: string[];
  isMac: boolean;
  detectedVramGb: number | null;
  detectedRamGb: number | null;
  onAddHf: () => void;
  onAddFile: () => void;
  onAddServer: () => void;
  onManageFlavors: (name: string) => void;
}

export function LocalLlmsSection({
  localRegistry, downloads, updatableNames, isMac, detectedVramGb, detectedRamGb,
  onAddHf, onAddFile, onAddServer, onManageFlavors,
}: LocalLlmsSectionProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [installedExpanded, setInstalledExpanded] = useState(false);

  const downloadingNames = new Set(downloads.map((d) => d.name));
  const cardProps = { downloadingNames, updatableNames, isMac, detectedVramGb, detectedRamGb, onManageFlavors };

  const installed = localRegistry.filter((e) => e.installed);

  const groups = new Map<string, LocalRegistryEntry[]>();
  for (const entry of localRegistry) {
    const key = entry.base_llm || entry.name;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  }

  return (
    <div>
      <div className="section-subheading">Local LLMs</div>

      <p className="explain">Download a GGUF model from huggingface.com and add it to your local registry.</p>
      <button className="action-btn" onClick={onAddHf}>Add local LLM (GGUF) from huggingface.com</button>
      <div className="spacer" />

      <p className="explain">Add a GGUF file you already have on disk.</p>
      <button className="action-btn" onClick={onAddFile}>Add local LLM (GGUF) from file</button>
      <div className="spacer" />

      <p className="explain">
        Point Kōdo at a llama-server (or OpenAI-compatible) instance you host yourself — on this machine or
        anywhere else on your network.
      </p>
      <button className="action-btn" onClick={onAddServer}>Add a link to self-hosted llama-server</button>

      <hr className="divider" />

      <DownloadsSection downloads={downloads} localRegistry={localRegistry} />
      <UpdatesBanner updatableNames={updatableNames} localRegistry={localRegistry} />

      <div id="installed-section">
        <div className="base-llm-group">
          <div className={'group-header' + (installedExpanded ? ' expanded' : '')} onClick={() => setInstalledExpanded((v) => !v)}>
            <span className="chevron">▶</span>
            <span className="group-title">Installed</span>
            <span className="group-count">({installed.length})</span>
          </div>
          <div className={'group-body' + (installedExpanded ? ' expanded' : '')}>
            {installed.length === 0 ? (
              <div id="empty-msg">Nothing installed yet — download one of the quants below.</div>
            ) : (
              installed.map((entry) => <ModelCard key={entry.name} entry={entry} {...cardProps} />)
            )}
          </div>
        </div>
        <hr className="divider" />
      </div>

      <div className="section-heading">Available local LLM quants</div>
      <p className="explain">
        Browse the quants below and click &quot;Download and Install&quot; to fetch one — once it finishes, it
        shows up above under Installed and is ready to use.
      </p>

      <div id="cards">
        {localRegistry.length === 0 ? (
          <div id="empty-msg">No local LLMs yet — add one above.</div>
        ) : (
          [...groups.entries()].map(([key, entries]) => {
            const expanded = expandedGroups.has(key);
            return (
              <div className="base-llm-group" key={key}>
                <div className={'group-header' + (expanded ? ' expanded' : '')} onClick={() => toggleGroup(key)}>
                  <span className="chevron">▶</span>
                  <span className="group-title">{key}</span>
                  <span className="group-count">({entries.length})</span>
                </div>
                <div className={'group-body' + (expanded ? ' expanded' : '')}>
                  {entries.map((entry) => <ModelCard key={entry.name} entry={entry} {...cardProps} />)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
