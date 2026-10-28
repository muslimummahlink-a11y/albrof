import { CalendarDays, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function parseDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Choose a date",
  ariaLabel = "Choose date",
  className,
  clearable = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  clearable?: boolean;
  disabled?: boolean;
}) {
  const selected = parseDate(value);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={ariaLabel}
            disabled={disabled}
            className={cn(
              "h-10 min-w-0 flex-1 justify-start gap-2 border-input bg-card px-3 text-left font-normal shadow-none hover:bg-accent/50",
              !selected && "text-muted-foreground",
            )}
          >
            <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">
              {selected
                ? new Intl.DateTimeFormat("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  }).format(selected)
                : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(date) => date && onChange(formatDate(date))}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      {clearable && selected && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear date"
          disabled={disabled}
          onClick={() => onChange("")}
          className="h-9 w-9 shrink-0 text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
