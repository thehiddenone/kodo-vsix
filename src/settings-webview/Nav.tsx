import { Fragment } from 'preact';
import { CLOUD_VENDOR_KEYS, NAV } from './types';

interface NavProps {
  selectedKey: string;
  onSelect: (key: string) => void;
}

export function Nav({ selectedKey, onSelect }: NavProps) {
  return (
    <div className="nav">
      {NAV.map(({ key, label }) => (
        <Fragment key={key}>
          {key === CLOUD_VENDOR_KEYS[0] && <hr className="nav-cloud-ai-divider" />}
          <div
            className={'nav-item' + (key === selectedKey ? ' active' : '')}
            onClick={() => onSelect(key)}
          >
            {label}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
