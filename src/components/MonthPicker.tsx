import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const months = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(2020, index, 1)),
);

export function MonthPicker({
  value,
  onChange,
  ariaLabel = "Choose month",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedYear = /^\d{4}-\d{2}$/.test(value)
    ? Number(value.slice(0, 4))
    : new Date().getFullYear();
  const [viewYear, setViewYear] = useState(selectedYear);
  const selectedMonth = /^\d{4}-\d{2}$/.test(value) ? Number(value.slice(5, 7)) - 1 : -1;
  const displayValue =
    selectedMonth >= 0 && selectedMonth < 12
      ? `${months[selectedMonth]} ${selectedYear}`
      : "Choose payroll month";

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setViewYear(selectedYear);
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          className={cn(
            "h-10 justify-start gap-2 border-input bg-card px-3 text-left font-normal shadow-none hover:bg-accent/50",
            selectedMonth < 0 && "text-muted-foreground",
            className,
          )}
        >
          <CalendarDays className="h-4 w-4 text-primary" />
          {displayValue}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="mb-3 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous year"
            onClick={() => setViewYear((year) => year - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="font-semibold">{viewYear}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next year"
            onClick={() => setViewYear((year) => year + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {months.map((month, index) => (
            <Button
              key={month}
              type="button"
              variant={viewYear === selectedYear && index === selectedMonth ? "default" : "outline"}
              className="h-9 px-2 text-xs"
              onClick={() => {
                onChange(`${viewYear}-${String(index + 1).padStart(2, "0")}`);
                setOpen(false);
              }}
            >
              {month}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
