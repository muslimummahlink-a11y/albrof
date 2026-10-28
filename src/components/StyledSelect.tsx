import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
};

export function StyledSelect({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder,
  className,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const EMPTY_VALUE = "__empty_select_value__";

  return (
    <Select
      value={value === "" ? EMPTY_VALUE : value}
      onValueChange={(nextValue) => onChange(nextValue === EMPTY_VALUE ? "" : nextValue)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-10 rounded-sm border-input bg-card shadow-sm hover:bg-accent/30 focus:ring-2 focus:ring-ring/30",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="rounded-sm border-border shadow-lg">
        {options.map((option) => (
          <SelectItem
            key={option.value || EMPTY_VALUE}
            value={option.value || EMPTY_VALUE}
            className="min-h-9 cursor-pointer rounded-sm px-3 focus:bg-secondary"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
