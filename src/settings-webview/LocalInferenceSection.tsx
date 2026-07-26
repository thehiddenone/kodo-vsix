import { HuggingFaceSection } from './HuggingFaceSection';
import { LlamaCppSection } from './LlamaCppSection';
import { LlamaOverrideSection } from './LlamaOverrideSection';
import { LocalLlmsSection } from './LocalLlmsSection';
import type { HfTokenEntry, LlamaCppInfo, LocalDownloadState, LocalRegistryEntry } from './types';

interface LocalInferenceSectionProps {
  llamaCpp: LlamaCppInfo;
  llamaServerOverridePath: string | null;
  hfTokens: HfTokenEntry[];
  localRegistry: LocalRegistryEntry[];
  downloads: LocalDownloadState[];
  updatableNames: string[];
  isMac: boolean;
  detectedVramGb: number | null;
  detectedRamGb: number | null;
  onAddToken: () => void;
  onAddHf: () => void;
  onAddFile: () => void;
  onAddServer: () => void;
  onManageFlavors: (name: string) => void;
}

export function LocalInferenceSection(props: LocalInferenceSectionProps) {
  return (
    <div>
      <h2>Local Inference</h2>
      <hr className="section-divider" />
      <LlamaCppSection llamaCpp={props.llamaCpp} />
      <hr className="section-divider" />
      <LlamaOverrideSection llamaServerOverridePath={props.llamaServerOverridePath} />
      <hr className="section-divider" />
      <HuggingFaceSection hfTokens={props.hfTokens} onAddToken={props.onAddToken} />
      <hr className="section-divider" />
      <LocalLlmsSection
        localRegistry={props.localRegistry}
        downloads={props.downloads}
        updatableNames={props.updatableNames}
        isMac={props.isMac}
        detectedVramGb={props.detectedVramGb}
        detectedRamGb={props.detectedRamGb}
        onAddHf={props.onAddHf}
        onAddFile={props.onAddFile}
        onAddServer={props.onAddServer}
        onManageFlavors={props.onManageFlavors}
      />
    </div>
  );
}
