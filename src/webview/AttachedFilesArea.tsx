import { styles } from './styles';
import type { AttachedFile } from './types';
/**
 * The space to the left of the footer buttons. Holds up to 9 attachment chips,
 * each a hollow yellow-bordered rounded rectangle showing the (truncated) file
 * name and a clickable 🗑 that removes it. File content is owned by the host.
 */
export function AttachedFilesArea({ files, onRemove }: { files: AttachedFile[]; onRemove: (id: string) => void }) {
  return (
    <div style={styles.attachArea}>
      {files.map((f) => (
        <div key={f.id} style={styles.attachChip} title={f.name}>
          <span style={styles.attachChipName}>{f.name}</span>
          <span
            style={styles.attachChipRemove}
            title="Remove attachment"
            role="button"
            onClick={() => onRemove(f.id)}
          >
            {'🗑'}
          </span>
        </div>
      ))}
    </div>
  );
}
