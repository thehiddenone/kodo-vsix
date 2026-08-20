/** Host-pushed state: a plain merge-patch reducer mirroring the original
 *  `update` message handler's per-field defaulting exactly. */

import type { KodoSettingsState } from './types';

export const initial: KodoSettingsState = {
  rules: [],
  stuckDetection: { active: 'local_only', scope: 'top_level', auto_unstuck_interactive: false },
  housekeeperLlm: { selected: '', options: [] },
  llamaCpp: { installedVersion: null, latestVersion: null, busy: false },
  sessions: [],
  sessionRules: null,
  uiSettings: {
    showTimestamps: false, timezone: 'system', clockFormat: 'ymd_24h', enterSubmits: true, showAllLocalLlmQuants: false,
  },
  hfTokens: [],
  cloudRegistry: {},
  modelsByVendor: {},
  keysByVendor: {},
  metaContributorTier: false,
  openRouterCatalog: [],
  openRouterAutoMode: false,
  bedrockCatalog: [],
  bedrockRegion: 'us-east-1',
  cloudUniform: {},
  localRegistry: [],
  llamaServerOverridePath: null,
  downloads: [],
  detectedVramGb: null,
  detectedRamGb: null,
  isMac: false,
  updatableNames: [],
  samplingSpecs: [],
  knobDefs: {},
  llamaArgCatalog: [],
};

export type Action = { type: 'patch'; data: Partial<KodoSettingsState> };

export function reducer(state: KodoSettingsState, action: Action): KodoSettingsState {
  if (action.type !== 'patch') {
    return state;
  }
  const data = action.data;
  const next = { ...state };
  if (Array.isArray(data.rules)) {
    next.rules = data.rules;
  }
  if (data.stuckDetection && typeof data.stuckDetection === 'object') {
    next.stuckDetection = data.stuckDetection;
  }
  if (data.housekeeperLlm && typeof data.housekeeperLlm === 'object') {
    next.housekeeperLlm = data.housekeeperLlm;
  }
  if (data.llamaCpp && typeof data.llamaCpp === 'object') {
    next.llamaCpp = data.llamaCpp;
  }
  if (data.uiSettings && typeof data.uiSettings === 'object') {
    next.uiSettings = data.uiSettings;
  }
  if (Array.isArray(data.sessions)) {
    next.sessions = data.sessions;
  }
  if (data.sessionRules === null || (data.sessionRules && typeof data.sessionRules === 'object')) {
    next.sessionRules = data.sessionRules;
  }
  if (Array.isArray(data.hfTokens)) {
    next.hfTokens = data.hfTokens;
  }
  if (data.cloudRegistry && typeof data.cloudRegistry === 'object') {
    next.cloudRegistry = data.cloudRegistry;
  }
  if (data.modelsByVendor && typeof data.modelsByVendor === 'object') {
    next.modelsByVendor = data.modelsByVendor;
  }
  if (data.keysByVendor && typeof data.keysByVendor === 'object') {
    next.keysByVendor = data.keysByVendor;
  }
  if (typeof data.metaContributorTier === 'boolean') {
    next.metaContributorTier = data.metaContributorTier;
  }
  if (Array.isArray(data.openRouterCatalog)) {
    next.openRouterCatalog = data.openRouterCatalog;
  }
  if (typeof data.openRouterAutoMode === 'boolean') {
    next.openRouterAutoMode = data.openRouterAutoMode;
  }
  if (Array.isArray(data.bedrockCatalog)) {
    next.bedrockCatalog = data.bedrockCatalog;
  }
  if (typeof data.bedrockRegion === 'string') {
    next.bedrockRegion = data.bedrockRegion;
  }
  if (data.cloudUniform && typeof data.cloudUniform === 'object') {
    next.cloudUniform = data.cloudUniform;
  }
  next.localRegistry = data.localRegistry || state.localRegistry;
  next.llamaServerOverridePath = data.llamaServerOverridePath !== undefined
    ? data.llamaServerOverridePath : state.llamaServerOverridePath;
  next.downloads = data.downloads || [];
  next.detectedVramGb = data.detectedVramGb !== undefined ? data.detectedVramGb : state.detectedVramGb;
  next.detectedRamGb = data.detectedRamGb !== undefined ? data.detectedRamGb : state.detectedRamGb;
  next.isMac = Boolean(data.isMac);
  next.updatableNames = data.updatableNames !== undefined ? data.updatableNames : state.updatableNames;
  next.samplingSpecs = data.samplingSpecs !== undefined ? data.samplingSpecs : state.samplingSpecs;
  next.knobDefs = data.knobDefs !== undefined ? data.knobDefs : state.knobDefs;
  next.llamaArgCatalog = data.llamaArgCatalog !== undefined ? data.llamaArgCatalog : state.llamaArgCatalog;
  return next;
}
