"use client";

// Console component demo page (Storybook-ish, route-only).
//
// Each component renders against fixture data in isolation so designers and
// PMs can review without spinning up the live console state.
// PRD §4.1 — every component listed here lives under
// `apps/web/src/components/console/`.

import { useState } from "react";
import type { HorizonMin, VerificationStatus } from "@ignislink/contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CommandPalette } from "@/components/console/CommandPalette";
import { IncidentDetailSheet } from "@/components/console/IncidentDetailSheet";
import { IncidentQueue } from "@/components/console/IncidentQueue";
import { MapPlaceholder } from "@/components/console/MapPlaceholder";
import { VerificationBadge } from "@/components/console/VerificationBadge";
import { WindRose } from "@/components/console/WindRose";
import { FIXTURE_INCIDENTS, FIXTURE_NOW } from "@/lib/fixtures";

const ALL_STATUSES: ReadonlyArray<VerificationStatus> = [
  "UNREPORTED",
  "EMERGING",
  "CREWS_ACTIVE",
  "KNOWN_PRESCRIBED",
  "LIKELY_INDUSTRIAL",
];

export default function ConsoleDemoPage() {
  const [selectedId, setSelectedId] = useState<string | null>(
    FIXTURE_INCIDENTS[0]?.event.incident_id ?? null,
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [horizonMin, setHorizonMin] = useState<HorizonMin>(360);
  const [muted, setMuted] = useState<ReadonlyArray<string>>([]);
  const [resolved, setResolved] = useState<ReadonlyArray<string>>([]);

  const selectedIncident =
    FIXTURE_INCIDENTS.find((i) => i.event.incident_id === selectedId) ?? null;

  return (
    <main className="container mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Console component demo</h1>
        <p className="text-sm text-muted-foreground">
          Each component renders against fixture data. Use this page to review
          visuals without standing up the live console state.
        </p>
      </header>

      <Section title="VerificationBadge" description="PRD §3.2 + §4.5 — color-blind safe.">
        <div className="flex flex-wrap items-center gap-3">
          {ALL_STATUSES.map((s) => (
            <div key={s} className="flex flex-col items-center gap-1">
              <VerificationBadge status={s} />
              <span className="text-[10px] text-muted-foreground">internal</span>
            </div>
          ))}
        </div>
        <Separator className="my-3" />
        <div className="flex flex-wrap items-center gap-3">
          {ALL_STATUSES.map((s) => (
            <div key={s} className="flex flex-col items-center gap-1">
              <VerificationBadge status={s} audience="public" />
              <span className="text-[10px] text-muted-foreground">public</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="WindRose"
        description="Custom SVG, animated by Framer. Meteorological 'from' convention."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <WindRose uMs={3} vMs={-1} gustMs={6.5} />
          <WindRose uMs={-4} vMs={2} gustMs={9.0} />
          <WindRose uMs={0.2} vMs={5} gustMs={8.1} />
        </div>
      </Section>

      <Section
        title="MapPlaceholder"
        description="Pure SVG; Mapbox GL drops in at Stage 1.5."
      >
        <div className="h-[360px]">
          <MapPlaceholder selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </Section>

      <Section title="IncidentQueue" description="Sortable, keyboard-friendly, animated rows.">
        <div className="h-[480px]">
          <IncidentQueue
            incidents={FIXTURE_INCIDENTS}
            selectedId={selectedId}
            mutedIds={muted}
            resolvedIds={resolved}
            onSelect={setSelectedId}
            onOpenDetail={(id) => {
              setSelectedId(id);
              setSheetOpen(true);
            }}
            onDispatch={(id) => alert(`(demo) Dispatch ${id}`)}
            now={FIXTURE_NOW}
          />
        </div>
      </Section>

      <Section
        title="IncidentDetailSheet"
        description="shadcn Sheet · open from the queue or via the buttons below."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setSheetOpen(true)} disabled={!selectedIncident}>
            Open detail sheet
          </Button>
          <Button variant="secondary" onClick={() => setPaletteOpen(true)}>
            Open command palette
          </Button>
          <span className="text-xs text-muted-foreground">
            Selected: {selectedIncident?.seed.county ?? "—"}
          </span>
        </div>
      </Section>

      <IncidentDetailSheet
        incident={selectedIncident}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        horizonMin={horizonMin}
        onHorizonChange={setHorizonMin}
        muted={selectedId ? muted.includes(selectedId) : false}
        resolved={selectedId ? resolved.includes(selectedId) : false}
        onMute={(id) => setMuted((prev) => (prev.includes(id) ? prev : [...prev, id]))}
        onResolve={(id) =>
          setResolved((prev) => (prev.includes(id) ? prev : [...prev, id]))
        }
        onDispatch={(id) => alert(`(demo) Dispatch ${id}`)}
        now={FIXTURE_NOW}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        incidents={FIXTURE_INCIDENTS}
        selectedId={selectedId}
        mutedIds={muted}
        onSelectIncident={setSelectedId}
        onOpenDetail={(id) => {
          setSelectedId(id);
          setSheetOpen(true);
        }}
        onDispatch={(id) => alert(`(demo) Dispatch ${id}`)}
        onMute={(id) => setMuted((prev) => (prev.includes(id) ? prev : [...prev, id]))}
        onShowShortcuts={() => alert("(demo) See ConsoleShell for the live shortcuts modal.")}
      />
    </main>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
