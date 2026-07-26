interface SelectRowProps {
  labelText: string;
  options: [string, string][];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

export function SelectRow({ labelText, options, value, disabled, onChange }: SelectRowProps) {
  return (
    <div className="select-row">
      <label>{labelText}</label>
      <select
        className="settings-select"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      >
        {options.map(([optValue, optLabel]) => (
          <option key={optValue} value={optValue}>{optLabel}</option>
        ))}
      </select>
    </div>
  );
}
