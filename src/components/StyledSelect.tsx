import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
};

export function StyledSelect({
  value,
  onChange,
  options,
  ariaLabel: ariaLabelProp,
  "aria-label": htmlAriaLabel,
  placeholder,
  className,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel?: string;
  "aria-label"?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const ariaLabel = ariaLabelProp ?? htmlAriaLabel ?? placeholder ?? "options";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 whitespace-nowrap rounded-sm border border-input bg-card px-3 py-2 text-sm shadow-sm outline-none hover:bg-accent/30 focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              !selected && "text-muted-foreground",
            )}
          >
            {selected?.label ?? placeholder ?? "Select an option"}
          </span>
          <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-48 p-0">
        <Command>
          <CommandInput
            aria-label={`Search ${ariaLabel.toLowerCase()}`}
            placeholder={`Search ${ariaLabel.toLowerCase()}...`}
          />
          <CommandList>
            <CommandEmpty>No matching options.</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value || "__empty_select_option__"}
                value={`${option.label} ${option.value}`}
                onSelect={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <Check
                  aria-hidden="true"
                  className={cn("h-4 w-4", value === option.value ? "opacity-100" : "opacity-0")}
                />
                {option.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
