import { useEffect, useId, useRef, useState } from "react";
import { MapPin, type LucideIcon } from "lucide-react";

import { useSuggestions } from "@/api/trips";
import { useDebounced } from "@/hooks/use-debounced";
import { cn } from "@/lib/utils";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

interface LocationFieldProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  icon?: LucideIcon;
  error?: string;
}

export function LocationField({ id, label, placeholder, value, onChange, icon, error }: LocationFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Suppresses the menu after a pick, so it does not immediately reopen on the new value.
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
  const Icon = icon ?? MapPin;

  return (
    <Field className="gap-1.5" data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id} className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </FieldLabel>

      {/* Ref covers both the control and the menu: the region an outside click must miss. */}
      <div className="relative" ref={containerRef}>
        <InputGroup className="h-11">
          <InputGroupAddon align="inline-start">
            <Icon aria-hidden />
          </InputGroupAddon>

          <InputGroupInput
            id={id}
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={showMenu}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-invalid={Boolean(error)}
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
            <InputGroupAddon align="inline-end">
              <Spinner />
            </InputGroupAddon>
          )}
        </InputGroup>

        {showMenu && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-lg"
          >
            {suggestions.map((suggestion, index) => (
              <li key={`${suggestion.label}-${suggestion.longitude}`}>
                {/* Spans, not Item: its title and description slots are block elements and
                    cannot nest inside a button. */}
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

      <FieldError>{error}</FieldError>
    </Field>
  );
}
