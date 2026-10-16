import { useEffect, useReducer, useState } from 'preact/hooks';
import { AddFileModal } from './AddFileModal';
import { ImportHfModelModal } from './ImportHfModelModal';
import { AddKeyModal } from './AddKeyModal';
import { AddServerUrlModal } from './AddServerUrlModal';
import { AddTokenModal } from './AddTokenModal';
import { CloudVendorSection } from './CloudVendorSection';
import { ConfigureModal } from './ConfigureModal';
import { GeneralSection } from './GeneralSection';
import { ProfileModal } from './ProfileModal';
import { GlobalRulesSection } from './GlobalRulesSection';
import { AgentReportModal } from './AgentReportModal';
import { AgentsSection } from './AgentsSection';
import { BenchmarkModal } from './BenchmarkModal';
import type { BenchmarkMode } from './BenchmarkModal';
import { CopyAgentModal } from './CopyAgentModal';
import { InstallAgentsModal } from './InstallAgentsModal';
import { InstallSkillsModal } from './InstallSkillsModal';
import { LocalInferenceSection } from './LocalInferenceSection';
import { Nav } from './Nav';
import { initial, reducer } from './reducer';
import { SessionSettingsModal } from './SessionSettingsModal';
import { SessionsSection } from './SessionsSection';
import { SkillsSection } from './SkillsSection';
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
  const [installSkillsModalOpen, setInstallSkillsModalOpen] = useState(false);
  // Holds the source to pre-fill when the user picked a local folder, so one
  // modal serves both entry points and the keep-or-replace step is never
  // skipped just because the source happened to be local.
  const [installAgentsSource, setInstallAgentsSource] = useState<string | null>(null);
  const [copyAgentModalOpen, setCopyAgentModalOpen] = useState(false);
  // The built-in a row's Copy button preselects in the copy modal; '' = the first.
  const [copyAgentName, setCopyAgentName] = useState('');
  // The agent whose Benchmark / Basics test modal is open, or null.
  const [benchmarkFor, setBenchmarkFor] = useState<
    { agent: string; label: string; mode: BenchmarkMode } | null
  >(null);
  // The agent whose Validate report is open, or null.
  const [reportAgentName, setReportAgentName] = useState<string | null>(null);
  // Which LLM's Configure (Default-profile knobs) modal is open, and which
  // LLM's Manage-profiles modal is open — separate, since they are two
  // different editors reachable from the same card (and from the sidebar's
  // Configure button, which deep-links into the first).
  const [configureEntryName, setConfigureEntryName] = useState<string | null>(null);
  const [profileEntryName, setProfileEntryName] = useState<string | null>(null);

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
      if (data.type === 'open_install_agents') {
        // Reply to `pick_agent_source` — the native folder picker's result,
        // fed into the same modal a repository URL goes through so the
        // keep-or-replace step is never skipped for a local source.
        setSelectedKey('agents');
        setInstallAgentsSource(data.source);
        return;
      }
      if (data.type === 'configure_local_model') {
        // Deep link from the sidebar card's Configure button — the panel has
        // already been forced to the 'local-inference' tab alongside this.
        setConfigureEntryName(data.name);
        return;
      }
      if (data.type === 'manage_local_model_profiles') {
        // Deep link from the sidebar profile picker's "Manage Profiles..."
        // item — same tab-forcing as the Configure deep link above.
        setProfileEntryName(data.name);
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
      if (configureEntryName) { setConfigureEntryName(null); }
      if (profileEntryName) { setProfileEntryName(null); }
      if (installSkillsModalOpen) { setInstallSkillsModalOpen(false); }
      if (installAgentsSource !== null) { setInstallAgentsSource(null); }
      if (copyAgentModalOpen) { setCopyAgentModalOpen(false); }
      if (reportAgentName !== null) { setReportAgentName(null); }
      if (benchmarkFor !== null) { setBenchmarkFor(null); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    sessionSettingsFor, addTokenModalOpen, addKeyModalVendor, hfModalOpen, fileModalOpen,
    serverModalOpen, configureEntryName, profileEntryName, installSkillsModalOpen,
    installAgentsSource, copyAgentModalOpen, reportAgentName, benchmarkFor,
  ]);

  function openCopyAgent(name?: string) {
    // Drop any reply a previous copy left in state, so the modal starts clean.
    dispatch({ type: 'patch', data: { agentCopyScan: null, agentCopy: null } });
    setCopyAgentName(name ?? '');
    setCopyAgentModalOpen(true);
  }

  function openBenchmark(agent: string, label: string, mode: BenchmarkMode) {
    // Same staleness guard: the modal reads only the reply to this request.
    dispatch({ type: 'patch', data: { harborOptions: null } });
    setBenchmarkFor({ agent, label, mode });
    vscode.postMessage({ type: 'fetch_harbor_options' });
  }

  function openAgentReport(name: string) {
    dispatch({ type: 'patch', data: { agentReport: null } });
    setReportAgentName(name);
    vscode.postMessage({ type: 'validate_agent', name });
  }

  function openSessionSettings(sessionId: string) {
    setSessionSettingsFor(sessionId);
    vscode.postMessage({ type: 'fetch_session_rules', sessionId });
  }

  const activeSession = sessionSettingsFor ? state.sessions.find((s) => s.id === sessionSettingsFor) : undefined;
  const configureEntry = configureEntryName
    ? state.localRegistry.find((e) => e.name === configureEntryName)
    : undefined;
  const profileEntry = profileEntryName
    ? state.localRegistry.find((e) => e.name === profileEntryName)
    : undefined;

  return (
    <div className="layout">
      <Nav selectedKey={selectedKey} onSelect={setSelectedKey} />
      <div className="content">
        {selectedKey === 'general' && (
          <GeneralSection
            uiSettings={state.uiSettings}
            stuckDetection={state.stuckDetection}
            housekeeperLlm={state.housekeeperLlm}
            defaultAgent={state.defaultAgent}
          />
        )}
        {selectedKey === 'sessions' && (
          <SessionsSection sessions={state.sessions} onOpenSettings={openSessionSettings} />
        )}
        {selectedKey === 'agents' && (
          <AgentsSection
            agents={state.agents}
            onInstallClick={() => setInstallAgentsSource('')}
            onCopyClick={openCopyAgent}
            onValidate={openAgentReport}
            onBenchmark={openBenchmark}
          />
        )}
        {selectedKey === 'skills' && (
          <SkillsSection skills={state.skills} onInstallClick={() => setInstallSkillsModalOpen(true)} />
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
            uiSettings={state.uiSettings}
            onAddToken={() => setAddTokenModalOpen(true)}
            onAddHf={() => setHfModalOpen(true)}
            onAddFile={() => { setFilePickedPath(null); setFileModalOpen(true); }}
            onAddServer={() => setServerModalOpen(true)}
            onConfigure={(name) => setConfigureEntryName(name)}
            onManageProfiles={(name) => setProfileEntryName(name)}
          />
        )}
        {CLOUD_VENDOR_KEYS.includes(selectedKey) && (
          <CloudVendorSection
            vendor={selectedKey}
            cloudRegistry={state.cloudRegistry}
            modelsByVendor={state.modelsByVendor}
            keysByVendor={state.keysByVendor}
            onAddKey={setAddKeyModalVendor}
            metaContributorTier={state.metaContributorTier}
            onSetMetaContributorTier={(enabled) => vscode.postMessage({ type: 'set_meta_contributor_tier', enabled })}
            openRouterCatalog={state.openRouterCatalog}
            openRouterAutoMode={state.openRouterAutoMode}
            onSetOpenRouterAutoMode={(enabled) => vscode.postMessage({ type: 'set_openrouter_auto_mode', enabled })}
            onRefreshOpenRouterCatalog={() => vscode.postMessage({ type: 'refresh_openrouter_catalog' })}
            bedrockCatalog={state.bedrockCatalog}
            bedrockRegion={state.bedrockRegion}
            onSetBedrockRegion={(region) => vscode.postMessage({ type: 'set_bedrock_region', region })}
            onRefreshBedrockCatalog={() => vscode.postMessage({ type: 'refresh_bedrock_catalog' })}
            cloudUniform={state.cloudUniform}
            onSetCloudUniformEnabled={(vendor, enabled) => vscode.postMessage({ type: 'set_cloud_uniform_enabled', vendor, enabled })}
            onSetCloudUniformModel={(vendor, model_id) => vscode.postMessage({ type: 'set_cloud_uniform_model', vendor, model_id })}
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
      {hfModalOpen && <ImportHfModelModal search={state.hfSearch} onClose={() => setHfModalOpen(false)} />}
      {fileModalOpen && (
        <AddFileModal
          localRegistry={state.localRegistry}
          pickedPath={filePickedPath}
          onClose={() => setFileModalOpen(false)}
        />
      )}
      {serverModalOpen && <AddServerUrlModal localRegistry={state.localRegistry} onClose={() => setServerModalOpen(false)} />}
      {configureEntry && (
        <ConfigureModal
          entry={configureEntry}
          knobDefs={state.knobDefs}
          onClose={() => setConfigureEntryName(null)}
        />
      )}
      {profileEntry && (
        <ProfileModal
          entry={profileEntry}
          llamaArgCatalog={state.llamaArgCatalog}
          onClose={() => setProfileEntryName(null)}
        />
      )}
      {installAgentsSource !== null && (
        <InstallAgentsModal
          initialSource={installAgentsSource}
          scan={state.agentScan}
          install={state.agentInstall}
          onClose={() => setInstallAgentsSource(null)}
        />
      )}
      {copyAgentModalOpen && (
        <CopyAgentModal
          builtins={state.agents.builtins}
          initialName={copyAgentName}
          scan={state.agentCopyScan}
          copy={state.agentCopy}
          onClose={() => setCopyAgentModalOpen(false)}
        />
      )}
      {benchmarkFor !== null && (
        <BenchmarkModal
          agent={benchmarkFor.agent}
          label={benchmarkFor.label}
          mode={benchmarkFor.mode}
          options={state.harborOptions}
          onClose={() => setBenchmarkFor(null)}
        />
      )}
      {reportAgentName !== null && (
        <AgentReportModal
          name={reportAgentName}
          result={state.agentReport}
          onClose={() => setReportAgentName(null)}
        />
      )}
      {installSkillsModalOpen && (
        <InstallSkillsModal
          existingSkills={state.skills.skills}
          scan={state.skillScan}
          install={state.skillInstall}
          onClose={() => setInstallSkillsModalOpen(false)}
        />
      )}
    </div>
  );
}
