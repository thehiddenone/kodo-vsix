import { styles } from './styles';
interface ResumeBannerProps {
  onResume: () => void;
  onDismiss: () => void;
}

export function ResumeBanner({ onResume, onDismiss }: ResumeBannerProps) {
  return (
    <div style={styles.resumeBanner}>
      <span style={styles.resumeText}>
        An unfinished session was found. Resume where you left off?
      </span>
      <button style={styles.resumeBtn} onClick={onResume}>
        ↺ Resume
      </button>
      <button style={styles.resumeDismissBtn} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
