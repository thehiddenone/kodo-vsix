import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { styles } from './styles';
import { SessionEntryView } from './SessionEntryView';
import type { UiSettings } from './types';
import type { SubsessionGroup } from './groupSubsessions';

interface SubsessionGroupViewProps {
  group: SubsessionGroup;
  uiSettings: UiSettings;
  /** Pre-rendered inner entries (built by the caller so it can special-case
   *  `ask_user` the same way the top-level feed does — this component stays
   *  agnostic of that). */
  children: ComponentChildren;
}

/**
 * Wraps one subsession's transcript in a collapsible block, expanded by
 * default. The take-over/task-brief lines stay outside the collapsible area
 * (always visible); only the subsession's own conversation entries hide when
 * collapsed. The hand-back `<kodo>`/`<kodo_crit>` line renders after the
 * block, once the subsession has actually ended.
 */
export function SubsessionGroupView({ group, uiSettings, children }: SubsessionGroupViewProps) {
  const [collapsed, setCollapsed] = useState(false);
  const displayName = group.startEntry.displayName;
  return (
    <div>
      <SessionEntryView entry={group.startEntry} uiSettings={uiSettings} />
      {group.task && <SessionEntryView entry={group.task} uiSettings={uiSettings} />}
      <div
        style={styles.subsessionBlockTitle}
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        title={collapsed ? 'Click to expand the subsession transcript' : 'Click to collapse the subsession transcript'}
      >
        {collapsed ? '[+] ' : '[-] '}
        {displayName} subsession.
        {collapsed && ' Click to see the details.'}
      </div>
      {!collapsed && <div style={styles.subsessionBlockContent}>{children}</div>}
      {group.endEntry && <SessionEntryView entry={group.endEntry} uiSettings={uiSettings} />}
    </div>
  );
}
