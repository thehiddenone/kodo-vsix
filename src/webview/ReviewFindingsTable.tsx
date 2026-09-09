import { useState } from 'preact/hooks';
import { styles } from './styles';
import type { ReviewFinding, SessionEntry } from './types';

type ReviewFindingsEntry = Extract<SessionEntry, { type: 'review_findings' }>;

interface ReviewFindingsTableProps {
  entry: ReviewFindingsEntry;
}

/**
 * The findings table for one review round of a Guided-mode work product — the
 * only place the user is told *what* a reviewer objected to, rather than just
 * how many things it found.
 *
 * Two properties are load-bearing and come from the server, not from here:
 *
 * - **The rows are already in display order** (outstanding first, then by the
 *   first location's path and line). Sorting is done once, server-side, so the
 *   client and the server cannot disagree about it — do not re-sort here.
 * - **One row is one finding, never one row per location.** A finding carries a
 *   list of locations precisely so a cross-file defect stays a single item;
 *   the extra locations render inside the row.
 *
 * Nothing on this table ever reaches a model. It arrives as an event the server
 * persists as a marker, and markers are never rebuilt into the LLM's message
 * history — so the user can be shown the whole backlog, fixed items included,
 * without adding a word to any agent's context.
 *
 * Collapsed by default once the round left nothing outstanding: a table with
 * only fixed rows is a record, and the open ones are what deserve the space.
 */
export function ReviewFindingsTable({ entry }: ReviewFindingsTableProps) {
  const outstanding = entry.findings.filter((f) => f.state === 'outstanding');
  const fixed = entry.findings.length - outstanding.length;
  const [collapsed, setCollapsed] = useState(outstanding.length === 0);
  const reviewer = entry.reviewerName === 'user' ? 'your review' : entry.reviewerName;
  return (
    <div style={styles.reviewFindings}>
      <div
        style={styles.reviewFindingsHeader}
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        title={collapsed ? 'Click to see the findings' : 'Click to collapse the findings'}
      >
        <span>{collapsed ? '[+]' : '[-]'}</span>
        <span style={styles.reviewFindingsTitle}>Findings after {reviewer}</span>
        <span style={styles.reviewFindingsCounter}>
          round {entry.iteration} of {entry.maxRounds} · {outstanding.length} outstanding
          {fixed > 0 && `, ${fixed} fixed`}
        </span>
      </div>
      {!collapsed && (
        <div style={styles.reviewFindingsBody}>
          <table style={styles.reviewFindingsTable}>
            <thead>
              <tr>
                <th style={styles.reviewFindingsHeadCell}>State</th>
                <th style={styles.reviewFindingsHeadCell}>Where</th>
                <th style={styles.reviewFindingsHeadCell}>Kind</th>
                <th style={styles.reviewFindingsHeadCell}>What</th>
                <th style={styles.reviewFindingsHeadCell}>Raised by</th>
              </tr>
            </thead>
            <tbody>
              {entry.findings.map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** `path:line`, or just the path for a finding with no line (a document-wide
 *  objection, or the user's own feedback on a whole work product). */
function formatLocation(path: string, firstLine: number | null): string {
  return firstLine === null ? path : `${path}:${firstLine}`;
}

function FindingRow({ finding }: { finding: ReviewFinding }) {
  const isFixed = finding.state !== 'outstanding';
  const [first, ...rest] = finding.locations;
  return (
    <tr style={isFixed ? styles.reviewFindingsRowFixed : undefined}>
      <td style={styles.reviewFindingsCell}>
        <span style={styles.reviewFindingsBadge}>{isFixed ? 'fixed' : 'open'}</span>
      </td>
      <td style={{ ...styles.reviewFindingsCell, ...styles.reviewFindingsLocation }}>
        {first ? formatLocation(first.path, first.firstLine) : '—'}
        {/* A multi-location finding is one defect spanning several files; the
            other sides are listed here rather than split into their own rows,
            which would un-link exactly what `locations` exists to keep together. */}
        {rest.map((location) => (
          <span key={location.path + location.firstLine} style={styles.reviewFindingsExtraLocation}>
            {formatLocation(location.path, location.firstLine)}
          </span>
        ))}
      </td>
      <td style={styles.reviewFindingsCell}>{finding.kind}</td>
      <td style={styles.reviewFindingsCell}>{finding.description}</td>
      <td style={{ ...styles.reviewFindingsCell, ...styles.reviewFindingsReporter }}>
        {finding.reportedBy}
      </td>
    </tr>
  );
}
