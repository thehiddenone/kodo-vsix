import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { styles } from './styles';

/**
 * Popup open/close state and dismissal mechanics shared by every composer
 * button that opens an anchored menu (Agent, Session): tracks whether the
 * popup is open, measures how much room it has above the button (it grows
 * upward out of the bottom of the WebView) and to the right of the button's
 * left edge (where it is anchored), and closes it on an
 * outside click, Escape, focus moving elsewhere, or the session disconnecting.
 * Extracted from ModeControls.tsx when the Agent group moved into its own
 * button/popup, so both share identical dismissal behavior rather than two
 * copies drifting apart.
 */
export function useMenuPopup(connected: boolean) {
  const [open, setOpen] = useState(false);
  // Null until measured (the first layout of a freshly opened menu), which
  // renders as the stylesheet's own caps: none on height, a viewport-wide one
  // on width.
  const [room, setRoom] = useState<{ maxHeight: number; maxWidth: number } | null>(null);
  // Wraps button + popup; every close rule below is "did this happen outside
  // *this* element?".
  const wrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setRoom(null);
      return;
    }
    const el = wrapRef.current;
    if (el === null) {
      return;
    }
    // The popup's bottom edge sits on the button's top edge, so the room it has
    // is everything above that, less a small margin off the top of the view.
    // Its left edge sits on the button's left edge — wherever composerRow's
    // centring has put it — so its width is capped at the room right of that,
    // less the same margin.
    const rect = el.getBoundingClientRect();
    setRoom({
      maxHeight: Math.max(120, rect.top - 12),
      maxWidth: Math.max(rect.width, document.documentElement.clientWidth - rect.left - 12),
    });
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
    room === null
      ? styles.sessionMenu
      : { ...styles.sessionMenu, maxHeight: `${room.maxHeight}px`, maxWidth: `${room.maxWidth}px` };

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
 * One radio row: the ◉/○ marker, an optional glyph, the option's name, and its
 * description underneath. Disabled rows still render their marker, so a locked group shows
 * what is selected while refusing to change it. The selected row's name and
 * description are also bold, with their size reserved up front (see
 * {@link BoldReserved}) so the switch moves nothing.
 *
 * Hover highlighting is tracked in state rather than left to `:hover`, because
 * VS Code webviews style everything here inline — the same reason
 * FooterButton fakes `:active`.
 */
export function MenuOption({
  glyph = '',
  label,
  desc,
  selected,
  disabled,
  onSelect,
}: {
  /** Colored emoji shown before the label; '' (the default) renders none. */
  glyph?: string;
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
      {glyph !== '' && (
        <span style={styles.sessionGlyph} aria-hidden="true">
          {glyph}
        </span>
      )}
      <span>
        <BoldReserved text={label} bold={selected} boxStyle={styles.sessionOptionLabel} />
        {desc !== '' && <BoldReserved text={desc} bold={selected} boxStyle={styles.sessionOptionDesc} />}
      </span>
    </button>
  );
}

/**
 * Text that can switch between normal and bold weight without changing size.
 * It sits in a one-cell grid with an invisible, always-bold copy of itself
 * stacked in the same cell, so the box is always as large as the bold
 * rendering: as wide, and, for text that wraps, as many lines tall. Selecting a
 * row (which bolds it) therefore cannot move or re-wrap anything in the popup.
 * `boxStyle` sets the cell's `display` (`inline-grid` or `grid`) and its font.
 */
function BoldReserved({
  text,
  bold,
  boxStyle,
}: {
  text: string;
  bold: boolean;
  boxStyle: Record<string, string | number>;
}) {
  return (
    <span style={boxStyle}>
      <span style={bold ? styles.boldReservedBold : styles.boldReservedText}>{text}</span>
      <span style={styles.boldReservedGhost} aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
