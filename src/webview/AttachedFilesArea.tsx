import { styles } from './styles';
import type { AttachedFile } from './types';
/**
 * The single row under the prompt box in the composer's centre column. Holds
 * up to 9 attachment chips, each a hollow yellow-bordered rounded rectangle
 * showing the (truncated) file name and a clickable 🗑 that removes it; the
 * chips shrink to share the row rather than wrapping onto a second one. File
 * content is owned by the host.
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
