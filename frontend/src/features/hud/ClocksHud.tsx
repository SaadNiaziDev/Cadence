import { Card, CardContent } from "@/components/ui/card";
import { CLOCKS, readClock } from "@/lib/hos";
import type { ClockSnapshot, RuleId } from "@/types/hos";

import { ClockGauge } from "./ClockGauge";
import { RulePopover } from "./RulePopover";

interface ClocksHudProps {
  clocks: ClockSnapshot;
  /** The rule that causes the next stop, so its gauge can be picked out. */
  bindingRuleId?: RuleId | null;
}

/**
 * The four legal clocks a driver carries at once.
 *
 * This is the interface's central claim: Hours of Service is not one rule but four
 * simultaneous countdowns, and whichever runs out first stops the truck. Every value
 * shown here comes from the engine's own snapshot for the scrubbed moment, so the gauges
 * cannot disagree with the plan they describe.
 */
export function ClocksHud({ clocks, bindingRuleId }: ClocksHudProps) {
  return (
    // No CardHeader: the four gauges are self-labelling and the panel is height-critical,
    // so a title row would cost more than it explains.
    <Card className="shrink-0 gap-0 rounded-lg py-1.5 shadow-none">
      <CardContent className="grid grid-cols-4 gap-1 px-2">
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
