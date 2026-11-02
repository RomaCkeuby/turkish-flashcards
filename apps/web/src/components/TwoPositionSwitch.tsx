export function TwoPositionSwitch({ label, left, right, checked, onChange, disabled = false }: {
  label: string; left: string; right: string; checked: boolean;
  onChange: (checked: boolean) => void; disabled?: boolean;
}) {
  return <button className="twoPositionSwitch" type="button" role="switch" aria-label={label}
    aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
    onKeyDown={event => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); onChange(event.key === "ArrowRight");
      }
    }}>
    <span className={!checked ? "activeSwitchLabel" : ""}>{left}</span>
    <span className="switchTrack" aria-hidden="true"><span className="switchThumb" /></span>
    <span className={checked ? "activeSwitchLabel" : ""}>{right}</span>
  </button>;
}
