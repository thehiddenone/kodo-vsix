import type { SkillEntry, SkillsState } from './types';
import { vscode } from './vscode';

interface RowProps {
  skill: SkillEntry;
}

function SkillRow({ skill }: RowProps) {
  const broken = skill.error !== '';
  // A broken skill has no description to show, so its load error takes the
  // column instead — that is the whole reason broken skills are listed at all
  // (kodo/doc/SKILLS.md §5): the user can see what is wrong and delete it.
  const detail = broken ? skill.error : skill.description;
  return (
    <div className="skill-row">
      <div className="skill-name" title={skill.path}>{skill.name}</div>
      <div className={'skill-description' + (broken ? ' skill-error' : '')} title={detail}>
        {detail}
      </div>
      <div className="session-icons">
        <button
          className="icon-btn secondary-btn"
          title="Open this skill's folder in a new window"
          onClick={() => vscode.postMessage({ type: 'open_skill', path: skill.path })}
        >
          📁
        </button>
        <button
          className="icon-btn secondary-btn"
          title="Delete this skill"
          onClick={() => vscode.postMessage({ type: 'delete_skill', name: skill.name })}
        >
          🗑
        </button>
      </div>
    </div>
  );
}

interface SkillsSectionProps {
  skills: SkillsState;
  onInstallClick: () => void;
}

export function SkillsSection({ skills, onInstallClick }: SkillsSectionProps) {
  return (
    <div>
      <h2>Skills</h2>
      <p className="intro-text">
        Skills are instruction packs agents follow for a particular kind of task, in the open{' '}
        <code>SKILL.md</code> format. Install one from a git repository below, or by hand by
        copying its folder into <code>{skills.root || '~/.kodo/skills'}</code> — either way it
        takes effect immediately, with no restart. Use the folder icon to open a skill in a new
        window, or the trash icon to delete it from disk.
      </p>
      <p>
        <button className="secondary-btn" onClick={onInstallClick}>Install from a repository…</button>{' '}
        <button
          className="secondary-btn"
          onClick={() => vscode.postMessage({ type: 'install_local_skill_pick' })}
        >
          Install from a local file…
        </button>
      </p>
      {skills.skills.length === 0 ? (
        <div id="empty-msg">No skills installed yet.</div>
      ) : (
        <div className="rule-table">
          <div className="skill-row skill-header">
            <div className="skill-name">Skill</div>
            <div className="skill-description">Description</div>
            <div className="session-icons" />
          </div>
          {skills.skills.map((s) => <SkillRow key={s.name} skill={s} />)}
        </div>
      )}
    </div>
  );
}
