/** Shared by the "Global Allow-Rules" section and the "Session Settings"
 *  modal's rules list — same buttons, checkboxes, and labels either way
 *  (only the rule set, checked-set, and delete/close callbacks differ). */

import type { GlobalRuleEntry } from './types';
import { ruleKey } from './types';

interface ToolbarProps {
  className: string;
  rules: GlobalRuleEntry[];
  checked: Set<string>;
  onCheckedChange: (next: Set<string>) => void;
  onDeleteSelected: (selected: GlobalRuleEntry[]) => void;
  onClose: () => void;
}

export function RuleToolbar({ className, rules, checked, onCheckedChange, onDeleteSelected, onClose }: ToolbarProps) {
  return (
    <div className={className}>
      <button
        className="secondary-btn"
        disabled={rules.length === 0}
        onClick={() => onCheckedChange(new Set(rules.map(ruleKey)))}
      >
        Select All
      </button>
      <button className="secondary-btn" disabled={checked.size === 0} onClick={() => onCheckedChange(new Set())}>
        Clear Selection
      </button>
      <button
        className="delete-rules-btn"
        disabled={checked.size === 0}
        onClick={() => {
          const selected = rules.filter((r) => checked.has(ruleKey(r)));
          if (selected.length === 0) { return; }
          onDeleteSelected(selected);
          onCheckedChange(new Set());
        }}
      >
        Delete Selected
      </button>
      <button className="secondary-btn" onClick={onClose}>Close</button>
    </div>
  );
}

interface RowProps {
  rule: GlobalRuleEntry;
  checked: Set<string>;
  onCheckedChange: (next: Set<string>) => void;
}

function RuleRow({ rule, checked, onCheckedChange }: RowProps) {
  const key = ruleKey(rule);
  return (
    <div className="rule-row">
      <input
        type="checkbox"
        checked={checked.has(key)}
        onChange={(e) => {
          const next = new Set(checked);
          if ((e.target as HTMLInputElement).checked) { next.add(key); } else { next.delete(key); }
          onCheckedChange(next);
        }}
      />
      <span className="rule-kind-badge">{rule.kind === 'path' ? 'path access' : 'run_command'}</span>
      <span className="rule-text" title={`${rule.executable} ${rule.value}`}>
        <span className="rule-executable">{rule.executable}</span>
        {rule.kind === 'path' ? `  →  ${rule.value}` : `  ${rule.value}`}
      </span>
    </div>
  );
}

interface ListProps {
  rules: GlobalRuleEntry[];
  checked: Set<string>;
  onCheckedChange: (next: Set<string>) => void;
  emptyText: string;
}

export function RuleList({ rules, checked, onCheckedChange, emptyText }: ListProps) {
  if (rules.length === 0) {
    return <div id="empty-msg">{emptyText}</div>;
  }
  return (
    <div className="rule-table">
      {rules.map((rule) => (
        <RuleRow key={ruleKey(rule)} rule={rule} checked={checked} onCheckedChange={onCheckedChange} />
      ))}
    </div>
  );
}
