import { useEffect, useRef, useState } from 'preact/hooks';
import { HF_REPO_RE } from './localLlmUtils';
import type { HfSearchHit, HfSearchResult } from './types';
import { vscode } from './vscode';

interface ImportHfModelModalProps {
  /** The newest `local_llm.hf_search` reply the host has pushed, possibly
   *  left over from an earlier opening — only a reply to a query this
   *  opening sent is shown. */
  search: HfSearchResult | null;
  onClose: () => void;
}

/** Wait this long after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 250;
/** Shorter text is not searched (mirrors the server's own minimum). */
const SEARCH_MIN_LENGTH = 2;

const TIER_LABELS: Record<HfSearchHit['publisher_tier'], string> = {
  top: 'Top publisher',
  known: 'Known publisher',
  other: '',
};

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function hitDetails(hit: HfSearchHit): string {
  const parts = [`↓ ${compact.format(hit.downloads)}`, `♥ ${compact.format(hit.likes)}`];
  if (hit.base_model) { parts.push(`base: ${hit.base_model}`); }
  if (hit.license) { parts.push(hit.license); }
  return parts.join(' · ');
}

/**
 * Ask for one Hugging Face GGUF repository id and hand it to the Model Importer
 * agent, which runs in a new read-only session tab (`import_hf_with_agent`,
 * kodo/doc/LLM_REGISTRY.md §4.0b). The agent — not this form — picks the
 * quants, reads their GGUF headers and writes the catalog entries.
 *
 * The field doubles as a search box: a pause in typing sends `hf_search`
 * (`local_llm.hf_search`, §4.0c), and the ranked matches — top publishers,
 * then known publishers, then the rest — are listed under it. Picking one
 * fills the field; an exact `account/repo` typed or pasted works without it.
 */
export function ImportHfModelModal({ search, onClose }: ImportHfModelModalProps) {
  const [repoId, setRepoId] = useState('');
  const [sentQuery, setSentQuery] = useState('');
  const [shown, setShown] = useState<HfSearchResult | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const repoRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<number | undefined>(undefined);
  useEffect(() => repoRef.current?.focus(), []);
  useEffect(() => () => window.clearTimeout(debounce.current), []);

  // Adopt a reply only when it answers the newest query this opening sent;
  // until then the previous results stay up, so typing does not flicker.
  useEffect(() => {
    if (search && sentQuery && search.query === sentQuery) {
      setShown(search);
      setActive(-1);
    }
  }, [search, sentQuery]);

  const trimmedRepoId = repoId.trim();
  const repoValid = HF_REPO_RE.test(trimmedRepoId);
  const searching = sentQuery !== '' && shown?.query !== sentQuery;
  const hits = shown?.results ?? [];
  const showList = listOpen && trimmedRepoId.length >= SEARCH_MIN_LENGTH && hits.length > 0;

  function onInput(value: string) {
    setRepoId(value);
    setListOpen(true);
    setTriedSubmit(false);
    window.clearTimeout(debounce.current);
    const query = value.trim();
    if (query.length < SEARCH_MIN_LENGTH) {
      setSentQuery('');
      return;
    }
    debounce.current = window.setTimeout(() => {
      setSentQuery(query);
      vscode.postMessage({ type: 'hf_search', query });
    }, SEARCH_DEBOUNCE_MS);
  }

  function pick(hit: HfSearchHit) {
    window.clearTimeout(debounce.current);
    setRepoId(hit.repo_id);
    setListOpen(false);
    setActive(-1);
    repoRef.current?.focus();
  }

  function submit() {
    if (!repoValid) {
      setTriedSubmit(true);
      return;
    }
    vscode.postMessage({ type: 'import_hf_with_agent', repo_id: trimmedRepoId });
    onClose();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) { return; }
      e.preventDefault();
      setListOpen(true);
      // -1 is "back in the field": the cycle runs field → rows → field.
      const last = hits.length - 1;
      const down = e.key === 'ArrowDown';
      setActive((i) => (down ? (i >= last ? -1 : i + 1) : (i <= -1 ? last : i - 1)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showList && active >= 0 && active < hits.length) {
        pick(hits[active]);
      } else {
        submit();
      }
    } else if (e.key === 'Escape' && showList) {
      e.stopPropagation();
      setListOpen(false);
      setActive(-1);
    }
  }

  let status = '';
  if (triedSubmit && !repoValid) {
    status = trimmedRepoId ? 'Expected the form "account/repo" — pick a match or type the full id.' : '';
  } else if (shown?.error && !searching) {
    status = shown.error;
  }
  let note = '';
  if (searching) {
    note = 'Searching Hugging Face…';
  } else if (shown && !shown.error && shown.query === trimmedRepoId && hits.length === 0) {
    note = 'No GGUF repositories match.';
  }

  return (
    <div className="li-modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
      <div className="modal-dialog hf-import-modal-dialog" role="dialog" aria-modal="true">
        <h3>Add local LLM (GGUF) from huggingface.com</h3>
        <div className="modal-field">
          <label for="hf-repo-id">Hugging Face GGUF repository</label>
          <input
            ref={repoRef}
            type="text"
            id="hf-repo-id"
            role="combobox"
            aria-expanded={showList}
            aria-controls="hf-search-list"
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? `hf-search-${active}` : undefined}
            placeholder="Search, e.g. qwen 27b — or paste unsloth/Qwen3.8-27B-GGUF"
            autocomplete="off"
            spellcheck={false}
            value={repoId}
            onInput={(e) => onInput((e.target as HTMLInputElement).value)}
            onKeyDown={onKeyDown}
          />
          {showList && (
            <div className="hf-search-list" id="hf-search-list" role="listbox">
              {hits.map((hit, i) => (
                <div
                  key={hit.repo_id}
                  id={`hf-search-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`hf-search-option${i === active ? ' active' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); pick(hit); }}
                  onMouseEnter={() => setActive(i)}
                >
                  <div className="hf-search-option-head">
                    <span className="hf-search-option-id">{hit.repo_id}</span>
                    {TIER_LABELS[hit.publisher_tier] && (
                      <span className={`hf-search-badge tier-${hit.publisher_tier}`}>
                        {TIER_LABELS[hit.publisher_tier]}
                      </span>
                    )}
                    {hit.in_catalog && <span className="hf-search-badge">In catalog</span>}
                    {hit.gated && (
                      <span className="hf-search-badge" title="Needs an accepted license and HF_TOKEN set for the Kōdo server">
                        Gated
                      </span>
                    )}
                  </div>
                  <div className="hf-search-option-details">{hitDetails(hit)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="field-error">{status}</div>
          {note && <div className="field-hint">{note}</div>}
          <div className="field-hint">
            The Model Importer agent reads the repository, picks one quant per precision tier, checks each
            quant's GGUF header for built-in MTP, and adds them to your local LLMs. It works in a new session
            tab you can watch but not type into. Nothing is downloaded until you install a quant.
          </div>
        </div>
        <div className="modal-actions">
          <button id="hf-import-btn" disabled={!repoValid} onClick={submit}>Import</button>
          <button className="secondary-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
