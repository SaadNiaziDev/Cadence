import { Card, CardContent } from "@/components/ui/card";
import { CLOCKS, readClock } from "@/lib/hos";
import type { ClockSnapshot, RuleId } from "@/types/hos";

import { ClockGauge } from "./ClockGauge";
import { RulePopover } from "./RulePopover";

interface ClocksHudProps {
  clocks: ClockSnapshot;
  bindingRuleId?: RuleId | null;
}

export function ClocksHud({ clocks, bindingRuleId }: ClocksHudProps) {
  return (
    <Card className="shrink-0 gap-0 rounded-xl py-3 shadow-none">
      <CardContent className="grid grid-cols-2 gap-2 px-3 sm:grid-cols-4">
        {CLOCKS.map((clock) => {
          const { used } = readClock(clocks, clock.key);
          return (
            <RulePopover key={clock.key} ruleId={clock.ruleId as RuleId}>
              <ClockGauge
                label={clock.label}
                caption={clock.caption}
                usedMinutes={used}
                limitHours={clock.limitHours}
                isBinding={bindingRuleId === clock.ruleId}
              />
            </RulePopover>
          );
        })}
      </CardContent>
    </Card>
  );
}
