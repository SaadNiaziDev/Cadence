import { useEffect, useId, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";

import { useSuggestions } from "@/api/trips";
import { useDebounced } from "@/hooks/use-debounced";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LocationFieldProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  icon?: React.ReactNode;
  error?: string;
}

export function LocationField({ id, label, placeholder, value, onChange, icon, error }: LocationFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Tracks whether the current value came from the list, so re-opening the menu after a
  // pick does not fight the user.
  const [justPicked, setJustPicked] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const debouncedQuery = useDebounced(value, 300);
  const { data: suggestions = [], isFetching } = useSuggestions(justPicked ? "" : debouncedQuery);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function pick(label: string) {
    onChange(label);
    setJustPicked(true);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      const chosen = suggestions[activeIndex];
      if (chosen) pick(chosen.label);
    } else if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  const showMenu = isOpen && !justPicked && suggestions.length > 0;

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <Label htmlFor={id} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>

      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {icon ?? <MapPin className="size-4" aria-hidden />}
        </span>

        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={showMenu}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={Boolean(error)}
          className={cn("h-11 pl-9 pr-9", error && "border-destructive")}
          onChange={(event) => {
            onChange(event.target.value);
            setJustPicked(false);
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
        />

        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
        )}

        {showMenu && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-lg"
          >
            {suggestions.map((suggestion, index) => (
              <li key={`${suggestion.label}-${suggestion.longitude}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(suggestion.label)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors",
                    index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                  )}
                >
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{suggestion.label}</span>
                    {suggestion.fullName && (
                      <span className="block truncate text-xs text-muted-foreground">{suggestion.fullName}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
