import { useEffect, useState } from 'preact/hooks';
import { RuleList, RuleToolbar } from './RuleList';
import type { GlobalRuleEntry } from './types';
import { ruleKey } from './types';
import { vscode } from './vscode';

export function GlobalRulesSection({ rules }: { rules: GlobalRuleEntry[] }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // A rule removed elsewhere (e.g. deleted from another window) can't stay checked.
  useEffect(() => {
    const keys = new Set(rules.map(ruleKey));
    setChecked((prev) => {
      const next = new Set([...prev].filter((k) => keys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [rules]);

  return (
    <div>
      <h2>Global Allow-Rules</h2>
      <p className="intro-text">
        Commands and paths you told Kōdo to always allow, machine-wide, when it asked permission — these apply
        across every project and session on this machine and are never asked about again until you delete them
        here.
      </p>
      <RuleToolbar
        className="toolbar"
        rules={rules}
        checked={checked}
        onCheckedChange={setChecked}
        onDeleteSelected={(selected) => vscode.postMessage({ type: 'delete_rules', rules: selected })}
        onClose={() => vscode.postMessage({ type: 'close' })}
      />
      <RuleList
        rules={rules}
        checked={checked}
        onCheckedChange={setChecked}
        emptyText="No global allow-rules yet — they're added from a permission prompt's 'always allow' checkbox when you choose the 'global' scope."
      />
    </div>
  );
}
