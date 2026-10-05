import { Minus, Plus } from 'lucide-react';

export default function QuantityStepper({ name, value, max, onChange }) {
  return (
    <div className="stepper">
      <button type="button" aria-label={`Decrease quantity of ${name}`} disabled={value <= 1} onClick={() => onChange(value - 1)}>
        <Minus size={14} aria-hidden="true" />
      </button>
      <input
        type="number"
        min="1"
        max={max}
        value={value}
        aria-label={`Quantity of ${name}`}
        onChange={(e) => onChange(Number(e.target.value) || 1)}
      />
      <button type="button" aria-label={`Increase quantity of ${name}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
