"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatNumber, formatPercent } from "@/lib/format";
import type { GoalRules, GoalType } from "@scopekit/contracts";
import { Trash2 } from "honestui/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export type GoalRow = {
  id: string;
  name: string;
  enabled: boolean;
  rules: GoalRules;
  completions: number;
  convertingSessions: number;
};

export function describeRule(rules: GoalRules): string {
  switch (rules.type) {
    case "page_visit":
      return `${rules.match === "exact" ? "visits" : "visits a path starting with"} ${rules.path}`;
    case "custom_event": {
      const props = Object.entries(rules.props ?? {});
      return `event ${rules.eventName}${props.length ? ` where ${props.map(([k, v]) => `${k} = ${v}`).join(", ")}` : ""}`;
    }
    case "outbound_click":
      return "any outbound link click";
    case "download":
      return "any file download";
  }
}

const TYPES: { value: GoalType; label: string }[] = [
  { value: "page_visit", label: "Page visit" },
  { value: "custom_event", label: "Custom event" },
  { value: "outbound_click", label: "Outbound click" },
  { value: "download", label: "Download" },
];

function AddGoalDialog({ siteId, retentionDays }: { siteId: string; retentionDays: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<GoalType>("page_visit");
  const [name, setName] = useState("");
  const [path, setPath] = useState("/");
  const [match, setMatch] = useState<"exact" | "starts_with">("exact");
  const [eventName, setEventName] = useState("");
  const [propKey, setPropKey] = useState("");
  const [propValue, setPropValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const rules: GoalRules =
      type === "page_visit"
        ? { type, match, path }
        : type === "custom_event"
          ? { type, eventName, props: propKey.trim() ? { [propKey.trim()]: propValue } : {} }
          : { type };
    const response = await fetch(`/api/sites/${siteId}/goals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, rules }),
    });
    setSaving(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message ?? "The goal could not be saved");
      return;
    }
    setOpen(false);
    setName("");
    setEventName("");
    setPropKey("");
    setPropValue("");
    router.refresh();
  }

  const label = "text-[13px] leading-5 text-ink";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Add goal</DialogTrigger>
      <DialogPopup className="w-[480px] max-w-[calc(100vw-32px)]">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add goal</DialogTitle>
            <DialogDescription>
              A session counts once per goal for conversion rate. History is backfilled from the last {retentionDays} days of raw events
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="goal-name" className={label}>Name</label>
              <Input id="goal-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Signup" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={label} id="goal-type">Counts when a session</span>
              <ToggleGroup aria-labelledby="goal-type" size="sm" value={[type]} onValueChange={(v) => v[0] && setType(v[0] as GoalType)} className="flex-wrap">
                {TYPES.map((t) => (
                  <ToggleGroupItem key={t.value} value={t.value} className="px-2.5 text-[13px]">
                    {t.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            {type === "page_visit" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="goal-path" className={label}>Path</label>
                  <Input id="goal-path" required pattern="/.*" value={path} onChange={(e) => setPath(e.target.value)} className="font-mono" />
                </div>
                <ToggleGroup aria-label="Path match" size="sm" value={[match]} onValueChange={(v) => v[0] && setMatch(v[0] as "exact" | "starts_with")}>
                  <ToggleGroupItem value="exact" className="px-2.5 text-[13px]">Exact path</ToggleGroupItem>
                  <ToggleGroupItem value="starts_with" className="px-2.5 text-[13px]">Starts with</ToggleGroupItem>
                </ToggleGroup>
              </>
            ) : null}
            {type === "custom_event" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="goal-event" className={label}>Event name</label>
                  <Input id="goal-event" required pattern="[A-Za-z0-9_.:\-]{1,64}" value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="signup_completed" className="font-mono" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="goal-prop-key" className={label}>Property, optional</label>
                    <Input id="goal-prop-key" value={propKey} onChange={(e) => setPropKey(e.target.value)} placeholder="plan" className="font-mono" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="goal-prop-value" className={label}>Equals</label>
                    <Input id="goal-prop-value" value={propValue} onChange={(e) => setPropValue(e.target.value)} placeholder="free" className="font-mono" />
                  </div>
                </div>
              </>
            ) : null}
            {type === "outbound_click" || type === "download" ? (
              <p className="text-[13px] leading-5 text-ink-2">
                Needs <span className="font-mono text-[12px]">{type === "download" ? "data-downloads" : "data-outbound"}</span> on the tracking snippet.
                These events are off by default
              </p>
            ) : null}
            {error ? <p role="alert" className="text-[13px] leading-5 text-negative">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={saving}>{saving ? "Saving" : "Add goal"}</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function GoalsManager({ siteId, goals, sessions, retentionDays }: { siteId: string; goals: GoalRow[]; sessions: number; retentionDays: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);

  const mutate = async (goalId: string, init: RequestInit) => {
    await fetch(`/api/sites/${siteId}/goals/${goalId}`, { ...init, headers: { "content-type": "application/json" } });
    setConfirming(null);
    startTransition(() => router.refresh());
  };

  return (
    <div data-pending={pending || undefined}>
      <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-[15px] leading-6 font-medium text-ink">Goals</h2>
          <p className="text-[13px] leading-5 text-ink-2">Conversion rate is converting sessions divided by all {formatNumber(sessions)} sessions in the range</p>
        </div>
        <AddGoalDialog siteId={siteId} retentionDays={retentionDays} />
      </div>
      {goals.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <thead>
              <tr className="border-y border-line text-[12px] text-ink-3">
                <th scope="col" className="h-10 pl-5 text-left font-normal">Goal</th>
                <th scope="col" className="h-10 px-3 text-right font-normal">Completions</th>
                <th scope="col" className="h-10 px-3 text-right font-normal whitespace-nowrap">Converting sessions</th>
                <th scope="col" className="h-10 px-3 text-right font-normal whitespace-nowrap">Conversion rate</th>
                <th scope="col" className="h-10 px-3 text-left font-normal">Enabled</th>
                <th scope="col" className="h-10 w-28 pr-5 text-right font-normal"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {goals.map((goal) => (
                <tr key={goal.id} className="border-b border-line last:border-0">
                  <th scope="row" className="h-12 pl-5 text-left font-normal">
                    <span className="block font-medium text-ink">{goal.name}</span>
                    <span className="block font-mono text-[11px] leading-4 text-ink-3">{describeRule(goal.rules)}</span>
                  </th>
                  <td className="tnum h-12 px-3 text-right text-ink">{formatNumber(goal.completions)}</td>
                  <td className="tnum h-12 px-3 text-right text-ink">{formatNumber(goal.convertingSessions)}</td>
                  <td className="tnum h-12 px-3 text-right text-ink">{sessions ? formatPercent(goal.convertingSessions / sessions, 2) : "–"}</td>
                  <td className="h-12 px-3">
                    <Switch
                      aria-label={`${goal.name} enabled`}
                      checked={goal.enabled}
                      onCheckedChange={(enabled) => mutate(goal.id, { method: "PATCH", body: JSON.stringify({ enabled }) })}
                    />
                  </td>
                  <td className="h-12 pr-5 text-right">
                    {confirming === goal.id ? (
                      <span className="inline-flex items-center gap-1">
                        <Button variant="destructive-outline" size="xs" onClick={() => mutate(goal.id, { method: "DELETE" })}>Delete</Button>
                        <Button variant="ghost" size="xs" onClick={() => setConfirming(null)}>Keep</Button>
                      </span>
                    ) : (
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${goal.name}`} onClick={() => setConfirming(goal.id)}>
                        <Trash2 size={16} strokeWidth={1.5} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 pb-5">
          <p className="text-[13px] leading-5 font-medium text-ink">No goals yet</p>
          <p className="max-w-[60ch] text-[13px] leading-5 text-ink-2">
            A goal marks the sessions that did something you care about, like reaching a page or firing an event
          </p>
        </div>
      )}
    </div>
  );
}
