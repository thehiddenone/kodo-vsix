import { styles } from './styles';

interface ThrottleToastProps {
  retryIn: number | null;
  onClose: () => void;
}

export function ThrottleToast({ retryIn, onClose }: ThrottleToastProps) {
  const mins = Math.max(1, Math.round((retryIn ?? 60) / 60));
  return (
    <div style={styles.throttleToast}>
      <span style={styles.throttleToastText}>
        Rate-limited by the LLM provider — retrying in ~{mins} minute{mins === 1 ? '' : 's'}
      </span>
      <button style={styles.throttleToastCloseBtn} onClick={onClose} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
