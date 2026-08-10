"""The Part 395 rules this planner enforces, as data.

Every segment the engine emits is tagged with the id of the rule that caused it, and the
frontend looks the explanation up here. Keeping the text beside the ids — rather than in
the React components — is what stops the interface from explaining a rule the engine no
longer applies the way it is described.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Final

RULE_DRIVING_LIMIT: Final = "drive-11"
RULE_DUTY_WINDOW: Final = "window-14"
RULE_BREAK: Final = "break-30"
RULE_CYCLE: Final = "cycle-70"
RULE_RESTART: Final = "restart-34"
RULE_FUEL: Final = "fuel-1000"
RULE_PICKUP: Final = "pickup"
RULE_DROPOFF: Final = "dropoff"
RULE_INSPECTION: Final = "inspection"
RULE_DRIVING: Final = "driving"
RULE_OFF_DUTY: Final = "off-duty"


@dataclass(frozen=True)
class Rule:
    """A single rule, written for a driver rather than for a compliance officer."""

    id: str
    title: str
    #: Empty for the operating assumptions that are not themselves regulations.
    citation: str
    #: Why this stop or limit exists, in one sentence.
    summary: str
    #: What satisfies the rule, where that is the part people get wrong.
    counts_as: str = ""
    #: What happens if a driver drives through it anyway.
    consequence: str = ""
    #: True for the assessment's operating assumptions rather than federal regulation.
    is_assumption: bool = False


CATALOG: Final[dict[str, Rule]] = {
    rule.id: rule
    for rule in [
        Rule(
            id=RULE_DRIVING_LIMIT,
            title="11-hour driving limit",
            citation="49 CFR 395.3(a)(3)(i)",
            summary="You may drive at most 11 hours before taking 10 consecutive hours off duty.",
            counts_as="Only time behind the wheel counts. Loading, fuelling and paperwork do not.",
            consequence="Driving past 11 hours is a violation and can put you out of service at a roadside inspection.",
        ),
        Rule(
            id=RULE_DUTY_WINDOW,
            title="14-hour driving window",
            citation="49 CFR 395.3(a)(2)",
            summary="You may not drive after the 14th hour since you came on duty, even if you have driving hours left.",
            counts_as=(
                "The window starts at the first minute of any work, including a pre-trip inspection, "
                "and keeps running through breaks and meals. Only 10 consecutive hours off duty resets it."
            ),
            consequence="You may still work after 14 hours — you simply cannot drive until you have taken 10 hours off.",
        ),
        Rule(
            id=RULE_BREAK,
            title="30-minute break",
            citation="49 CFR 395.3(a)(3)(ii)",
            summary="After 8 cumulative hours of driving you must take a 30-minute break before driving again.",
            counts_as=(
                "Any 30 consecutive minutes not driving qualifies — off duty, sleeper berth, or "
                "on-duty-not-driving. A one-hour loading stop or a fuel stop already satisfies it."
            ),
            consequence="Driving past 8 hours without a qualifying break is a violation.",
        ),
        Rule(
            id=RULE_CYCLE,
            title="70-hour / 8-day cycle",
            citation="49 CFR 395.3(b)(2)",
            summary="You may not drive once you have 70 hours of on-duty time in any 8 consecutive days.",
            counts_as="All on-duty time counts, not just driving — fuelling, loading, inspections and paperwork all add up.",
            consequence="Hours drop off the back of the 8-day window day by day, or a 34-hour restart clears the cycle entirely.",
        ),
        Rule(
            id=RULE_RESTART,
            title="34-hour restart",
            citation="49 CFR 395.3(c)",
            summary="34 consecutive hours off duty resets your 70-hour cycle back to zero.",
            counts_as="The 34 hours must be continuous off-duty or sleeper-berth time.",
            consequence="Without it you must wait for hours to age out of the 8-day window before you can drive again.",
        ),
        Rule(
            id=RULE_FUEL,
            title="Fuel stop",
            citation="",
            summary="This plan schedules a fuelling stop at least every 1,000 miles.",
            counts_as="Logged as on-duty not driving. At 30 minutes it also satisfies the 30-minute break rule.",
            is_assumption=True,
        ),
        Rule(
            id=RULE_PICKUP,
            title="Pickup",
            citation="",
            summary="One hour on duty (not driving) is allowed for loading at the pickup.",
            counts_as="Being on duty rather than off duty, it burns cycle hours and keeps the 14-hour window running.",
            is_assumption=True,
        ),
        Rule(
            id=RULE_DROPOFF,
            title="Dropoff",
            citation="",
            summary="One hour on duty (not driving) is allowed for unloading at the dropoff.",
            counts_as="Being on duty rather than off duty, it burns cycle hours and keeps the 14-hour window running.",
            is_assumption=True,
        ),
        Rule(
            id=RULE_INSPECTION,
            title="Pre-trip and post-trip inspection",
            citation="49 CFR 396.11 and 396.13",
            summary="15 minutes on duty at each end of the trip for the required vehicle inspection.",
            counts_as="The pre-trip inspection is what starts your 14-hour window, before you have driven a single mile.",
        ),
        Rule(
            id=RULE_DRIVING,
            title="Driving",
            citation="",
            summary="Time behind the wheel, counted against the 11-hour, 14-hour, 8-hour and 70-hour clocks at once.",
            is_assumption=True,
        ),
        Rule(
            id=RULE_OFF_DUTY,
            title="Off duty",
            citation="",
            summary="Time neither driving nor on duty. Ten consecutive hours resets the daily clocks.",
            is_assumption=True,
        ),
    ]
}


def describe(rule_id: str) -> Rule | None:
    """Look a rule up by id, or None when the id is unknown."""
    return CATALOG.get(rule_id)


def as_dicts() -> list[dict]:
    """Serialise the catalog for the API."""
    return [
        {
            "id": rule.id,
            "title": rule.title,
            "citation": rule.citation,
            "summary": rule.summary,
            "countsAs": rule.counts_as,
            "consequence": rule.consequence,
            "isAssumption": rule.is_assumption,
        }
        for rule in CATALOG.values()
    ]


__all__ = [
    "CATALOG",
    "Rule",
    "RULE_BREAK",
    "RULE_CYCLE",
    "RULE_DRIVING_LIMIT",
    "RULE_DROPOFF",
    "RULE_DUTY_WINDOW",
    "RULE_FUEL",
    "RULE_INSPECTION",
    "RULE_PICKUP",
    "RULE_RESTART",
    "RULE_DRIVING",
    "RULE_OFF_DUTY",
    "as_dicts",
    "describe",
]
