import { styles } from './styles';
import { vscode } from './vscode';
import type { FileEventData } from './types';
interface FileEventListProps {
  events: FileEventData[];
}

export function FileEventList({ events }: FileEventListProps) {
  return (
    <div style={styles.fileEvents}>
      <div style={styles.fileEventsHeader}>Files written</div>
      {events.map((fe, i) => (
        <div key={i} style={styles.fileEvent}>
          <span style={styles.fileEventKind}>{fe.kind}</span>
          <span style={styles.fileEventPath}>{fe.path}</span>
          <button
            style={styles.openBtn}
            onClick={() => vscode.postMessage({ type: 'open_file', path: fe.path })}
          >
            Open
          </button>
        </div>
      ))}
    </div>
  );
}
