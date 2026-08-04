import { useEffect, useReducer, useState } from 'preact/hooks';
import { AddFileModal } from './AddFileModal';
import { AddHuggingfaceModal } from './AddHuggingfaceModal';
import { AddKeyModal } from './AddKeyModal';
import { AddServerUrlModal } from './AddServerUrlModal';
import { AddTokenModal } from './AddTokenModal';
import { CloudVendorSection } from './CloudVendorSection';
import { FlavorModal } from './FlavorModal';
import { GeneralSection } from './GeneralSection';
import { GlobalRulesSection } from './GlobalRulesSection';
import { LocalInferenceSection } from './LocalInferenceSection';
import { Nav } from './Nav';
import { initial, reducer } from './reducer';
import { SessionSettingsModal } from './SessionSettingsModal';
import { SessionsSection } from './SessionsSection';
import { CLOUD_VENDOR_KEYS } from './types';
import type { InboundMessage } from './types';
import { vscode } from './vscode';

export function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [selectedKey, setSelectedKey] = useState('general');
  const [sessionSettingsFor, setSessionSettingsFor] = useState<string | null>(null);
  const [addTokenModalOpen, setAddTokenModalOpen] = useState(false);
  const [addKeyModalVendor, setAddKeyModalVendor] = useState<string | null>(null);
  const [hfModalOpen, setHfModalOpen] = useState(false);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [filePickedPath, setFilePickedPath] = useState<string | null>(null);
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [flavorEntryName, setFlavorEntryName] = useState<string | null>(null);

  useEffect(() => {
    vscode.postMessage({ type: 'ready' });

    function onMessage(event: MessageEvent) {
      const data = event.data as InboundMessage;
      if (data.type === 'gguf_file_picked') {
        if (data.path) {
          setFilePickedPath(data.path);
        }
        return;
      }
      if (data.type === 'select_section') {
        setSelectedKey(data.key);
        return;
      }
      if (data.type !== 'update') { return; }
      dispatch({ type: 'patch', data });
      // A deleted (or otherwise vanished) session can't keep its modal open.
      if (Array.isArray(data.sessions)) {
        setSessionSettingsFor((current) => (
          current && !data.sessions!.some((s) => s.id === current) ? null : current
        ));
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') { return; }
      if (sessionSettingsFor) { setSessionSettingsFor(null); }
      if (addTokenModalOpen) { setAddTokenModalOpen(false); }
      if (addKeyModalVendor) { setAddKeyModalVendor(null); }
      if (hfModalOpen) { setHfModalOpen(false); }
      if (fileModalOpen) { setFileModalOpen(false); }
      if (serverModalOpen) { setServerModalOpen(false); }
      if (flavorEntryName) { setFlavorEntryName(null); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessionSettingsFor, addTokenModalOpen, addKeyModalVendor, hfModalOpen, fileModalOpen, serverModalOpen, flavorEntryName]);

  function openSessionSettings(sessionId: string) {
    setSessionSettingsFor(sessionId);
    vscode.postMessage({ type: 'fetch_session_rules', sessionId });
  }

  const activeSession = sessionSettingsFor ? state.sessions.find((s) => s.id === sessionSettingsFor) : undefined;
  const flavorEntry = flavorEntryName ? state.localRegistry.find((e) => e.name === flavorEntryName) : undefined;

  return (
    <div className="layout">
      <Nav selectedKey={selectedKey} onSelect={setSelectedKey} />
      <div className="content">
        {selectedKey === 'general' && (
          <GeneralSection uiSettings={state.uiSettings} stuckDetection={state.stuckDetection} />
        )}
        {selectedKey === 'sessions' && (
          <SessionsSection sessions={state.sessions} onOpenSettings={openSessionSettings} />
        )}
        {selectedKey === 'global-rules' && <GlobalRulesSection rules={state.rules} />}
        {selectedKey === 'local-inference' && (
          <LocalInferenceSection
            llamaCpp={state.llamaCpp}
            llamaServerOverridePath={state.llamaServerOverridePath}
            hfTokens={state.hfTokens}
            localRegistry={state.localRegistry}
            downloads={state.downloads}
            updatableNames={state.updatableNames}
            isMac={state.isMac}
            detectedVramGb={state.detectedVramGb}
            detectedRamGb={state.detectedRamGb}
            onAddToken={() => setAddTokenModalOpen(true)}
            onAddHf={() => setHfModalOpen(true)}
            onAddFile={() => { setFilePickedPath(null); setFileModalOpen(true); }}
            onAddServer={() => setServerModalOpen(true)}
            onManageFlavors={(name) => setFlavorEntryName(name)}
          />
        )}
        {CLOUD_VENDOR_KEYS.includes(selectedKey) && (
          <CloudVendorSection
            vendor={selectedKey}
            cloudRegistry={state.cloudRegistry}
            modelsByVendor={state.modelsByVendor}
            keysByVendor={state.keysByVendor}
            onAddKey={setAddKeyModalVendor}
          />
        )}
      </div>

      {activeSession && (
        <SessionSettingsModal
          session={activeSession}
          sessionRules={state.sessionRules}
          onClose={() => setSessionSettingsFor(null)}
        />
      )}
      {addTokenModalOpen && <AddTokenModal onClose={() => setAddTokenModalOpen(false)} />}
      {addKeyModalVendor && <AddKeyModal vendor={addKeyModalVendor} onClose={() => setAddKeyModalVendor(null)} />}
      {hfModalOpen && <AddHuggingfaceModal localRegistry={state.localRegistry} onClose={() => setHfModalOpen(false)} />}
      {fileModalOpen && (
        <AddFileModal
          localRegistry={state.localRegistry}
          pickedPath={filePickedPath}
          onClose={() => setFileModalOpen(false)}
        />
      )}
      {serverModalOpen && <AddServerUrlModal localRegistry={state.localRegistry} onClose={() => setServerModalOpen(false)} />}
      {flavorEntry && (
        <FlavorModal
          entry={flavorEntry}
          samplingSpecs={state.samplingSpecs}
          onClose={() => setFlavorEntryName(null)}
        />
      )}
    </div>
  );
}
