import { Search, X } from 'lucide-react';

export default function SearchBar({ value, onChange, onSubmit, inputRef, className = '' }) {
  return (
    <form
      role="search"
      className={`search ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(value);
      }}
    >
      <Search className="search-icon" size={18} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search keyboards, audio, power…"
        aria-label="Search products"
        enterKeyHint="search"
      />
      {value && (
        <button type="button" className="search-clear" aria-label="Clear search" onClick={() => onChange('')}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </form>
  );
}
