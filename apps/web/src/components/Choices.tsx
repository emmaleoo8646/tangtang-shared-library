import { useId } from "react";
import type { ChoiceOption } from "../choicePresentation";
import { LibraryIcon } from "./LibraryIcon";

type ChoiceProps = {
  label: string;
  value: string;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  message?: string;
};

export function InlineChoice({ label, value, options, onChange, disabled = false, message }: ChoiceProps) {
  const id = useId();
  return <fieldset className="choice-field choice-group" disabled={disabled} aria-describedby={message ? `${id}-message` : undefined} aria-invalid={!!message}>
    <legend>{label}</legend>
    <div className="choice-chips">
      {options.map(option => <label className="choice-chip" key={option.value}>
        <input type="radio" name={id} value={option.value} checked={value === option.value} disabled={option.disabled}
          onChange={() => onChange(option.value)} />
        <span><span>{option.label}</span>{value === option.value && <LibraryIcon name="check" />}</span>
      </label>)}
    </div>
    {message && <p className="choice-message" id={`${id}-message`} role="status">{message}</p>}
  </fieldset>;
}

export function NativeSelect({ label, value, options, onChange, disabled = false, message, hideLabel = false }: ChoiceProps & { hideLabel?: boolean }) {
  const id = useId();
  const hasValue = options.some(option => option.value === value);
  const missing = `${id}-missing`;
  return <div className="choice-field">
    <label htmlFor={id} className={hideLabel ? "visually-hidden" : undefined}>{label}</label>
    <div className="native-choice-control">
      <select id={id} className="native-choice" value={hasValue ? value : missing} disabled={disabled}
        aria-invalid={!!message} aria-describedby={message ? `${id}-message` : undefined} onChange={event => onChange(event.target.value)}>
        {!hasValue && <option value={missing} disabled>请选择</option>}
        {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      <LibraryIcon name="chevron" />
    </div>
    {message && <p className="choice-message choice-message--invalid" id={`${id}-message`} role="status">{message}</p>}
  </div>;
}
