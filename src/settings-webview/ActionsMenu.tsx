import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/** One entry of an {@link ActionsMenu}: a glyph, the action's name on the first
 * line and what it does on the second. */
export interface MenuAction {
  glyph: string;
  label: string;
  description: string;
  onSelect: () => void;
}

/** Room kept between the menu and the button, and between the menu and the
 * window's edges. */
const GAP_PX = 4;
const EDGE_PX = 8;

/** An **Actions…** button that opens a modal popup menu of `actions`, anchored
 * under the button and right-aligned to it (above it when there is no room
 * below). A transparent full-window layer makes it modal: a click anywhere
 * outside the menu, any keypress, or the window resizing (which would leave it
 * detached from its button) closes it, and so does choosing an action.
 *
 * The caller passes only the actions that apply — an action that cannot be
 * performed is left out rather than shown disabled. */
export function ActionsMenu({ actions }: { actions: MenuAction[] }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  // Null until the menu has been measured, and the menu stays invisible until
  // then, so it never flashes at the wrong spot on the frame it opens.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function close(refocus: boolean) {
    setAnchor(null);
    setPos(null);
    if (refocus) {
      buttonRef.current?.focus();
    }
  }

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (anchor === null || menu === null) {
      return;
    }
    const { width, height } = menu.getBoundingClientRect();
    const below = anchor.bottom + GAP_PX;
    const top = below + height <= window.innerHeight - EDGE_PX
      ? below
      : Math.max(EDGE_PX, anchor.top - GAP_PX - height);
    const left = Math.min(
      Math.max(EDGE_PX, anchor.right - width),
      window.innerWidth - EDGE_PX - width,
    );
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    if (anchor === null) {
      return;
    }
    // Capture phase, so the keypress is seen before anything else reacts to it.
    // A plain key is swallowed as well: otherwise Enter or Space on a focused
    // button would carry on to "click" it, reopening the menu or running the
    // action. A shortcut with a modifier is let through to VS Code.
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
      }
      close(true);
    };
    const onResize = () => close(false);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onResize);
    };
  }, [anchor]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="secondary-btn actions-btn"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(e) => setAnchor((e.currentTarget as HTMLButtonElement).getBoundingClientRect())}
      >
        Actions…
      </button>
      {anchor !== null && (
        <div
          className="actions-menu-overlay"
          // mousedown, not click: a press outside the menu dismisses it even if
          // it is released somewhere else.
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              close(true);
            }
          }}
          // The page must not scroll out from under a menu pinned to its button
          // (the menu is never tall enough to scroll itself).
          onWheel={(e) => e.preventDefault()}
        >
          <div
            ref={menuRef}
            className="actions-menu"
            role="menu"
            style={pos === null
              ? { visibility: 'hidden', top: '0px', left: '0px' }
              : { top: `${pos.top}px`, left: `${pos.left}px` }}
          >
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                className="actions-menu-item"
                onClick={() => {
                  close(false);
                  a.onSelect();
                }}
              >
                <span className="actions-menu-glyph" aria-hidden="true">{a.glyph}</span>
                <span className="actions-menu-label">{a.label}</span>
                <span className="actions-menu-desc">{a.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
