import { BookOpen, CircleAlert, CircleHelp } from "lucide-react";

import { useRules } from "@/api/trips";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { RuleId } from "@/types/hos";

interface RulePopoverProps {
  ruleId: RuleId;
  children: React.ReactNode;
}

/**
 * Explains the rule behind whatever it wraps — a gauge, a stop marker, a timeline row.
 *
 * The text comes from the backend rule catalog rather than from this file. That is the
 * point: the engine tags each segment with a rule id, and the explanation a driver reads
 * is looked up by that same id, so the interface cannot describe a rule the engine no
 * longer applies the way it is written here.
 */
export function RulePopover({ ruleId, children }: RulePopoverProps) {
  const { data: rules } = useRules();
  const rule = rules?.[ruleId];

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 text-left" align="center">
        {rule ? (
          <div className="flex flex-col gap-2.5">
            <div>
              <p className="text-sm font-semibold">{rule.title}</p>
              {rule.citation ? (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <BookOpen className="size-3" aria-hidden />
                  {rule.citation}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Planning assumption, not a federal rule</p>
              )}
            </div>

            <p className="text-sm leading-relaxed">{rule.summary}</p>

            {rule.countsAs && (
              <div className="rounded-md bg-muted p-2">
                <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <CircleHelp className="size-3" aria-hidden />
                  What counts
                </p>
                <p className="text-xs leading-relaxed">{rule.countsAs}</p>
              </div>
            )}

            {rule.consequence && (
              <div className="flex gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span>{rule.consequence}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading rule…</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
