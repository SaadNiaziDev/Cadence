import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, Fuel, Moon } from "lucide-react";

import { fetchHealth } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const DUTY_STATUSES = [
  { key: "off", label: "Off Duty", swatch: "bg-status-off", icon: Moon },
  { key: "sleeper", label: "Sleeper Berth", swatch: "bg-status-sleeper", icon: Moon },
  { key: "driving", label: "Driving", swatch: "bg-status-driving", icon: Activity },
  { key: "onduty", label: "On Duty (Not Driving)", swatch: "bg-status-onduty", icon: Fuel },
] as const;

export default function App() {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Clock className="size-5 text-primary" aria-hidden />
            <div>
              <h1 className="text-base font-semibold tracking-tight">HOS Trip Planner</h1>
              <p className="text-xs text-muted-foreground">FMCSA Part 395 route and daily log builder</p>
            </div>
          </div>
          <Badge variant={health.isSuccess ? "secondary" : "outline"} className="tabular">
            {health.isPending ? "connecting" : health.isSuccess ? "api online" : "api offline"}
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Duty status palette</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {DUTY_STATUSES.map(({ key, label, swatch, icon: Icon }) => (
              <div key={key} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                <span className={`size-3 rounded-full ${swatch}`} aria-hidden />
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                <span className="text-sm">{label}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
