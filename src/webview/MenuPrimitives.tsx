import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { styles } from './styles';

/**
 * Popup open/close state and dismissal mechanics shared by every composer
 * button that opens an anchored menu (Agent, Session Parameters): tracks
 * whether the popup is open, measures how much room it has above the button
 * (it grows upward out of the bottom of the WebView), and closes it on an
 * outside click, Escape, focus moving elsewhere, or the session disconnecting.
 * Extracted from ModeControls.tsx when the Agent group moved into its own
 * button/popup, so both share identical dismissal behavior rather than two
 * copies drifting apart.
 */
export function useMenuPopup(connected: boolean) {
  const [open, setOpen] = useState(false);
  // Null until measured (the first paint of a freshly opened menu), which is
  // also what a `null` maxHeight renders as: uncapped.
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  // Wraps button + popup; every close rule below is "did this happen outside
  // *this* element?".
  const wrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setMaxHeight(null);
      return;
    }
    const el = wrapRef.current;
    if (el === null) {
      return;
    }
    // The popup's bottom edge sits on the button's top edge, so the room it has
    // is everything above that, less a small margin off the top of the view.
    setMaxHeight(Math.max(120, el.getBoundingClientRect().top - 12));
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const outside = (target: EventTarget | null): boolean =>
      wrapRef.current === null || !(target instanceof Node) || !wrapRef.current.contains(target);
    // mousedown, not click: the menu should be gone by the time the click lands
    // on whatever was pressed, and a press that drags out of the popup still
    // counts as dismissing it.
    const onMouseDown = (e: MouseEvent) => {
      if (outside(e.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    // Focus moving to any other widget (the prompt textarea, a footer button,
    // anything outside the popup) dismisses it too.
    const onFocusIn = (e: FocusEvent) => {
      if (outside(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  // A disconnected session can change nothing, so the button refuses to open —
  // and closes an open popup if the connection drops under it.
  useEffect(() => {
    if (!connected) {
      setOpen(false);
    }
  }, [connected]);

  const menuStyle =
    maxHeight === null ? styles.sessionMenu : { ...styles.sessionMenu, maxHeight: `${maxHeight}px` };

  return { open, setOpen, wrapRef, menuStyle };
}

/** The note printed under a frozen group's heading (Agent, Mode): both are
 *  frozen for the duration of a running turn, so while a turn is in flight and
 *  the user's selection differs from the value that turn is actually using,
 *  the change is queued for the next prompt. Empty string when selection and
 *  effect agree (or nothing is running), which is the overwhelmingly common
 *  case. */
export function frozenNote(pending: boolean, effectiveName: string): string {
  return pending ? `Queued for the next prompt — currently ${effectiveName}.` : '';
}

/** One single-choice group: its heading, an optional status/lock note, and the
 *  option rows. Groups are separated by a rule, drawn by the caller.
 *
 *  The note sits to the *right of the title, on the same line*. Notes come and
 *  go with session state — a turn starting freezes Agent/Mode, Autonomous locks
 *  Edit/Tool Control, a model switch can withdraw Thinking — so giving one its
 *  own line would grow and shrink the group by a line each time, shifting every
 *  row below it while the menu is open under the user's pointer. Sharing the
 *  heading's line makes appearing and disappearing free. */
export function MenuGroup({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ComponentChildren;
}) {
  return (
    <div role="group" aria-label={title}>
      <div style={styles.sessionGroupHeader}>
        <span style={styles.sessionGroupTitle}>{title}</span>
        {note !== '' && <span style={styles.sessionGroupNote}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * One radio row: the ◉/○ marker, the option's name, and its description
 * underneath. Disabled rows still render their marker, so a locked group shows
 * what is selected while refusing to change it.
 *
 * Hover highlighting is tracked in state rather than left to `:hover`, because
 * VS Code webviews style everything here inline — the same reason
 * FooterButton fakes `:active`.
 */
export function MenuOption({
  label,
  desc,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  desc: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  const style = {
    ...styles.sessionOption,
    ...(disabled ? styles.sessionOptionDisabled : {}),
    ...(hover && !disabled ? styles.sessionOptionHover : {}),
  };
  return (
    <button
      type="button"
      style={style}
      role="menuitemradio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span style={styles.sessionRadio} aria-hidden="true">
        {selected ? '◉' : '○'}
      </span>
      <span>
        <span style={styles.sessionOptionLabel}>{label}</span>
        {desc !== '' && <div style={styles.sessionOptionDesc}>{desc}</div>}
      </span>
    </button>
  );
}
