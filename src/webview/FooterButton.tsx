import { useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { styles } from './styles';

interface FooterButtonProps {
  style: JSX.CSSProperties;
  onClick: () => void;
  disabled: boolean;
  title: string;
  children: ComponentChildren;
}

/**
 * One of the four bottom-bar buttons (send prompt, attach, stop, delete
 * session). Plain inline styles give VS Code webviews no `:active` pseudo-
 * class to lean on, so click feedback is faked here: the glyph inside the
 * button (not the button itself, which would shift layout) is nudged down
 * and to the side for as long as the pointer/touch is held down.
 */
export function FooterButton({ style, onClick, disabled, title, children }: FooterButtonProps) {
  const [pressed, setPressed] = useState(false);
  const press = () => setPressed(true);
  const release = () => setPressed(false);
  return (
    <button
      style={style}
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseDown={press}
      onMouseUp={release}
      onMouseLeave={release}
      onTouchStart={press}
      onTouchEnd={release}
      onTouchCancel={release}
    >
      <span style={pressed ? styles.footerBtnSymbolPressed : styles.footerBtnSymbol}>{children}</span>
    </button>
  );
}
