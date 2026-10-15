import type { AgentReportResult } from './types';
import { vscode } from './vscode';

interface AgentReportModalProps {
  /** The agent this modal was opened for. */
  name: string;
  /** Latest `agents.validate` reply, or `null` before the first. Only a reply
   * for `name` is shown, so one left over from another row never is. */
  result: AgentReportResult | null;
  onClose: () => void;
}

/** "Validate" — one agent's report (kodo/doc/AGENT_BUILDER.md §5): whether it
 * loads (and if not, why — the same reason its row shows), then every lint
 * warning on its prompt. Warnings never stop an agent loading; they point at
 * where the prompt departs from the prompt-writing rules. A finding with a line
 * opens the prompt file there. */
export function AgentReportModal({ name, result, onClose }: AgentReportModalProps) {
  const answered = result !== null && result.name === name;
  const report = answered ? result!.report : null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="modal-box"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Validate {name}</h3>

        {!answered && <p className="modal-intro">Validating…</p>}

        {answered && report === null && (
          <p className="field-error">Could not validate this agent — {result!.error}</p>
        )}

        {report !== null && (
          <>
            <p className="modal-intro">
              {report.load === 'ok' ? (
                <>✓ Loads.</>
              ) : (
                <span className="skill-error">✗ Does not load — {report.error}</span>
              )}
            </p>
            {report.path !== '' && (
              <p className="modal-intro">
                <span className="value-code">{report.path}</span>
              </p>
            )}
            {report.findings.length === 0 ? (
              <p className="modal-intro">No lint warnings.</p>
            ) : (
              <>
                <p className="modal-intro">
                  {report.findings.length} lint warning{report.findings.length === 1 ? '' : 's'}:
                </p>
                <div className="rule-table report-findings">
                  {report.findings.map((f, i) => (
                    <div className="report-finding" key={i}>
                      <div className="report-rule">{f.rule}</div>
                      <div className="report-line">
                        {f.line !== null && report.path !== '' ? (
                          <a
                            href="#"
                            title="Open the prompt at this line"
                            onClick={(e) => {
                              e.preventDefault();
                              vscode.postMessage({
                                type: 'open_agent_file', path: report.path, line: f.line,
                              });
                            }}
                          >
                            line {f.line}
                          </a>
                        ) : '—'}
                      </div>
                      <div>{f.message}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
