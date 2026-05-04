"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  Command as CommandIcon,
  Flame,
  Gauge,
  Layers3,
  MapPin,
  MessageSquare,
  Navigation,
  Newspaper,
  Radio,
  Radar,
  Route,
  Search,
  Send,
  ShieldAlert,
  ShieldOff,
  Sparkles,
  Truck,
  Wind,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  FIXTURE_INCIDENTS,
  statusColorClass,
  statusLabel,
  type FixtureIncident,
  type VerificationStatus,
} from "@/lib/fixtures";
import { cn } from "@/lib/utils";
import { LeafletMap } from "@/components/map/MapContainer";
import { IntelPanel } from "@/components/console/IntelPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// Render the static ageMinutes from the fixture rather than recomputing
// against Date.now(), so server and client render the same string and we
// don't trip a hydration mismatch.
function formatAge(mins: number): string {
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function hotspotColor(s: VerificationStatus): string {
  switch (s) {
    case "EMERGING":
      return "#ff6b35";
    case "CREWS_ACTIVE":
      return "#10b981";
    case "UNREPORTED":
      return "#a1a1aa";
    case "KNOWN_PRESCRIBED":
      return "#3b82f6";
    case "LIKELY_INDUSTRIAL":
      return "#a855f7";
  }
}

export default function ConsolePage() {
  const [selectedId, setSelectedId] = useState<string | null>(FIXTURE_INCIDENTS[0]?.id ?? null);
  const [filter, setFilter] = useState<"all" | "active" | "emerging">("active");
  const [search, setSearch] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    let list = FIXTURE_INCIDENTS;
    if (filter === "active") {
      list = list.filter(
        (i) =>
          i.verification === "EMERGING" ||
          i.verification === "CREWS_ACTIVE" ||
          i.verification === "UNREPORTED",
      );
    } else if (filter === "emerging") {
      list = list.filter((i) => i.verification === "EMERGING");
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.shortId.toLowerCase().includes(q) ||
          i.county.toLowerCase().includes(q) ||
          i.neighborhood.toLowerCase().includes(q),
      );
    }
    return list.sort((a, b) => a.ageMinutes - b.ageMinutes);
  }, [filter, search]);

  const selected = FIXTURE_INCIDENTS.find((i) => i.id === selectedId) ?? null;

  const activeCount = FIXTURE_INCIDENTS.filter(
    (i) => i.verification === "EMERGING" || i.verification === "CREWS_ACTIVE",
  ).length;
  const emergingCount = FIXTURE_INCIDENTS.filter((i) => i.verification === "EMERGING").length;

  return (
    <main className="sentry-forge-bg text-foreground h-screen overflow-hidden p-2 sm:p-5 lg:p-7">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.34, 1.56, 0.64, 1] }}
        className="sentry-window mx-auto flex h-full max-h-[1100px] min-h-0 w-full max-w-[1800px] flex-col"
      >
        <AppChrome activeCount={activeCount} emergingCount={emergingCount} />

        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize={34} minSize={25} maxSize={44}>
            <aside className="flex h-full min-h-0 flex-col border-r border-white/10">
              <QueueHeader
                filter={filter}
                onFilter={setFilter}
                search={search}
                onSearch={setSearch}
                count={filtered.length}
              />
              <Queue incidents={filtered} selectedId={selectedId} onSelect={setSelectedId} />
            </aside>
          </ResizablePanel>
          <ResizableHandle withHandle className="sentry-resize-handle border-0 bg-transparent" />
          <ResizablePanel defaultSize={66} minSize={56}>
            <MapPanel
              incidents={FIXTURE_INCIDENTS}
              selectedId={selectedId}
              selected={selected}
              onSelect={setSelectedId}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </motion.div>

      {selected && <DetailSheet incident={selected} onClose={() => setSelectedId(null)} />}
    </main>
  );
}

function AppChrome({ activeCount, emergingCount }: { activeCount: number; emergingCount: number }) {
  return (
    <header className="flex h-[54px] shrink-0 items-center gap-4 border-b border-white/10 bg-black/[0.18] px-4 backdrop-blur-2xl">
      <MacTrafficLights />
      <div className="flex min-w-0 items-center gap-3">
        <span className="sentry-primary-gradient flex h-8 w-8 items-center justify-center rounded-[9px]">
          <Flame className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold leading-none">SENTRY Dispatcher</h1>
            <Badge className="hidden border-white/10 bg-white/[0.08] text-[10px] font-medium text-zinc-200 shadow-none sm:inline-flex">
              Forge handoff
            </Badge>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span className="sentry-live-dot h-1.5 w-1.5 rounded-full bg-[var(--forge-orange)]" />
            <span>live satellite, weather, routing and dispatch queue</span>
          </div>
        </div>
      </div>

      <div className="ml-auto hidden items-center gap-2 lg:flex">
        <Stat label="Active" value={activeCount} tone="emerald" icon={<Activity />} />
        <Stat label="Emerging" value={emergingCount} tone="orange" icon={<AlertTriangle />} />
        <Stat label="24h Total" value={FIXTURE_INCIDENTS.length} tone="zinc" icon={<Radar />} />
        <Badge className="ml-1 gap-1.5 border-white/10 bg-white/[0.08] px-2.5 py-1 text-[11px] font-medium text-zinc-300 shadow-none">
          <CommandIcon className="h-3.5 w-3.5" />/ command
        </Badge>
      </div>
    </header>
  );
}

function MacTrafficLights() {
  return (
    <div className="flex shrink-0 items-center gap-2" aria-hidden>
      <span className="h-3 w-3 rounded-full bg-[#ff5f57] shadow-[inset_0_-1px_0_rgba(0,0,0,0.24)]" />
      <span className="h-3 w-3 rounded-full bg-[#ffbd2e] shadow-[inset_0_-1px_0_rgba(0,0,0,0.24)]" />
      <span className="h-3 w-3 rounded-full bg-[#28c840] shadow-[inset_0_-1px_0_rgba(0,0,0,0.24)]" />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "emerald" | "orange" | "zinc";
  icon: React.ReactNode;
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "orange"
        ? "text-[var(--forge-orange-light)]"
        : "text-zinc-300";
  return (
    <div className="sentry-glass flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-xs">
      <span className={cn("flex [&_svg]:h-3.5 [&_svg]:w-3.5", toneClass)}>{icon}</span>
      <span className="font-semibold">{value}</span>
      <span className="text-zinc-400">{label}</span>
    </div>
  );
}

function QueueHeader({
  filter,
  onFilter,
  search,
  onSearch,
  count,
}: {
  filter: "all" | "active" | "emerging";
  onFilter: (f: "all" | "active" | "emerging") => void;
  search: string;
  onSearch: (s: string) => void;
  count: number;
}) {
  return (
    <div className="shrink-0 space-y-4 border-b border-white/10 bg-black/[0.12] p-4 backdrop-blur-2xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Badge className="mb-2 gap-1.5 border-white/10 bg-white/[0.08] px-2 py-1 text-[11px] font-medium text-zinc-300 shadow-none">
            <Sparkles className="h-3.5 w-3.5 text-[var(--forge-orange-light)]" />
            fire-spread.onnx
          </Badge>
          <h2 className="text-xl font-semibold leading-tight">Incident queue</h2>
          <p className="mt-1 text-xs text-zinc-400">
            {count} visible from FIRMS, local intel and routing workers
          </p>
        </div>
        <Badge className="gap-1.5 border-orange-300/20 bg-orange-500/[0.12] text-xs font-medium text-orange-100 shadow-none">
          <span className="sentry-live-dot h-1.5 w-1.5 rounded-full bg-[var(--forge-orange)]" />
          Live
        </Badge>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search ID, county, neighborhood..."
          className="h-10 rounded-[12px] border-white/10 bg-white/[0.07] pl-9 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-[var(--forge-orange)]"
          aria-label="Search incidents"
        />
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-[12px] border border-white/10 bg-black/[0.18] p-1">
        {(["active", "emerging", "all"] as const).map((f) => (
          <Button
            key={f}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onFilter(f)}
            className={cn(
              "h-8 rounded-[9px] text-xs capitalize text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100",
              filter === f && "sentry-primary-gradient text-white hover:text-white",
            )}
          >
            {f}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Queue({
  incidents,
  selectedId,
  onSelect,
}: {
  incidents: FixtureIncident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul className="space-y-2.5 p-3">
        {incidents.map((incident, index) => (
          <QueueItem
            key={incident.id}
            incident={incident}
            selected={selectedId === incident.id}
            index={index}
            onSelect={onSelect}
          />
        ))}
        {incidents.length === 0 && (
          <li className="sentry-glass rounded-[14px] px-4 py-12 text-center text-sm text-zinc-400">
            No incidents match this filter.
          </li>
        )}
      </ul>
    </ScrollArea>
  );
}

function QueueItem({
  incident,
  selected,
  index,
  onSelect,
}: {
  incident: FixtureIncident;
  selected: boolean;
  index: number;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <Button
        asChild
        variant="ghost"
        className={cn(
          "sentry-file-in sentry-pressable h-auto w-full whitespace-normal rounded-[14px] border border-white/10 bg-white/[0.055] p-0 text-left text-zinc-100 hover:border-white/20 hover:bg-white/[0.085]",
          selected &&
            "border-orange-300/[0.35] bg-orange-500/[0.14] shadow-[0_0_0_1px_rgba(255,107,53,0.12),0_14px_42px_rgba(255,107,53,0.11)]",
        )}
        style={{ animationDelay: `${index * 42}ms` }}
      >
        <motion.button
          type="button"
          onClick={() => onSelect(incident.id)}
          whileTap={{ scale: 0.992 }}
          aria-pressed={selected}
        >
          <span className="block w-full p-3.5">
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="font-mono text-xs font-semibold text-zinc-100">
                  {incident.shortId}
                </span>
                <span className="mt-1 block truncate text-sm font-medium text-zinc-100">
                  {incident.neighborhood}, {incident.county} {incident.state}
                </span>
              </span>
              <Badge
                className={cn(
                  "shrink-0 rounded-[8px] px-2 py-0.5 text-[10px] font-semibold uppercase shadow-none",
                  statusColorClass(incident.verification),
                )}
              >
                {statusLabel(incident.verification)}
              </Badge>
            </span>

            <span className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                {formatAge(incident.ageMinutes)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Wind className="h-3 w-3" />
                {incident.windSpeedMs.toFixed(1)} m/s @ {Math.round(incident.windDirDeg)}°
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Gauge className="h-3 w-3" />
                FRP {incident.fireRadiativePower.toFixed(0)} MW
              </span>
              <span className="inline-flex items-center gap-1.5 capitalize">
                <Radar className="h-3 w-3" />
                {incident.firmsConfidence}
              </span>
            </span>

            <span className="mt-3 flex items-center justify-between gap-3 text-[11px] text-zinc-400">
              <span className="min-w-0 truncate">
                {incident.stations[0] ? (
                  <>
                    nearest{" "}
                    <span className="text-zinc-100">
                      {incident.stations[0].name.split(" ").slice(0, 3).join(" ")}
                    </span>{" "}
                    · {incident.stations[0].etaMinutes} min
                  </>
                ) : (
                  <span className="italic">no stations in range</span>
                )}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            </span>
          </span>
        </motion.button>
      </Button>
    </li>
  );
}

function MapPanel({
  incidents,
  selectedId,
  selected,
  onSelect,
}: {
  incidents: FixtureIncident[];
  selectedId: string | null;
  selected: FixtureIncident | null;
  onSelect: (id: string) => void;
}) {
  const [spotlight, setSpotlight] = useState({ x: 68, y: 28 });

  return (
    <section
      className="sentry-map-stage relative h-full min-h-0 overflow-hidden bg-[#060609]"
      aria-label="Live wildfire map"
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setSpotlight({
          x: ((event.clientX - rect.left) / rect.width) * 100,
          y: ((event.clientY - rect.top) / rect.height) * 100,
        });
      }}
    >
      <LeafletMap
        incidents={incidents.map((i) => ({
          id: i.id,
          shortId: i.shortId,
          lat: i.lat,
          lon: i.lon,
          status: i.verification,
          windDirDeg: i.windDirDeg,
          windSpeedMs: i.windSpeedMs,
          predictedSpread: i.predictedSpread.map((p) => ({
            horizonMin: p.horizonMin,
            areaAcres: p.areaAcres,
            bearingDeg: p.bearingDeg,
          })),
          stations: i.stations
            .map((s) => ({
              id: s.id,
              name: s.name,
              etaMinutes: s.etaMinutes,
              lat: s.lat ?? 0,
              lon: s.lon ?? 0,
            }))
            .filter((s) => s.lat !== 0),
          selected: i.id === selectedId,
        }))}
        onIncidentClick={onSelect}
        height="100%"
        className="absolute inset-0 h-full w-full"
      />

      <div
        className="pointer-events-none absolute inset-0 z-[402] opacity-70 mix-blend-screen"
        style={{
          background: `radial-gradient(circle at ${spotlight.x}% ${spotlight.y}%, rgba(255, 107, 53, 0.18), transparent 24%)`,
        }}
        aria-hidden
      />

      <div className="pointer-events-none absolute left-4 right-4 top-4 z-[403] flex items-start justify-between gap-3">
        <div className="sentry-glass rounded-[14px] px-3.5 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
            <Layers3 className="h-4 w-4 text-[var(--forge-orange-light)]" />
            Wildfire propagation canvas
          </div>
          <div className="mt-1 text-[11px] text-zinc-400">
            ML contours, ember particles, nearest station routes
          </div>
        </div>
        <div className="hidden items-center gap-2 xl:flex">
          <GlassPill icon={<Navigation />} label="HRRR wind" value="60m fresh" />
          <GlassPill icon={<Route />} label="Mapbox ETA" value="3 stations" />
          <GlassPill icon={<Activity />} label="Socket bridge" value="online" />
        </div>
      </div>

      <MapLegend />

      {selected && <SelectedMapCard incident={selected} />}
    </section>
  );
}

function GlassPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="sentry-glass flex items-center gap-2 rounded-[999px] px-3 py-2 text-xs">
      <span className="text-[var(--forge-orange-light)] [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
      <span className="text-zinc-300">{label}</span>
      <span className="text-zinc-500">{value}</span>
    </div>
  );
}

function MapLegend() {
  return (
    <div className="sentry-glass pointer-events-none absolute bottom-4 left-4 z-[403] rounded-[14px] p-3">
      <div className="text-[10px] font-medium uppercase text-zinc-500">Hotspots</div>
      <div className="mt-2 grid gap-1.5 text-xs">
        {(
          [
            ["EMERGING", "Emerging"],
            ["CREWS_ACTIVE", "Crews active"],
            ["UNREPORTED", "Unreported"],
            ["KNOWN_PRESCRIBED", "Prescribed"],
            ["LIKELY_INDUSTRIAL", "Industrial"],
          ] as [VerificationStatus, string][]
        ).map(([k, label]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hotspotColor(k) }} />
            <span className="text-zinc-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SelectedMapCard({ incident }: { incident: FixtureIncident }) {
  return (
    <motion.div
      key={incident.id}
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.42, ease: [0.34, 1.56, 0.64, 1] }}
      className="sentry-glass-strong absolute bottom-4 right-4 z-[403] w-[min(390px,calc(100%-2rem))] rounded-[16px] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs font-semibold text-zinc-200">{incident.shortId}</div>
          <div className="mt-1 text-base font-semibold leading-tight text-zinc-50">
            {incident.neighborhood}
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            {incident.county} {incident.state} · {formatAge(incident.ageMinutes)}
          </div>
        </div>
        <Badge
          className={cn(
            "rounded-[8px] text-[10px] uppercase shadow-none",
            statusColorClass(incident.verification),
          )}
        >
          {statusLabel(incident.verification)}
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniMetric label="FRP" value={`${incident.fireRadiativePower.toFixed(0)} MW`} />
        <MiniMetric label="Wind" value={`${incident.windSpeedMs.toFixed(1)} m/s`} />
        <MiniMetric
          label="ETA"
          value={incident.stations[0] ? `${incident.stations[0].etaMinutes} min` : "n/a"}
        />
      </div>
    </motion.div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-white/10 bg-white/[0.06] px-2.5 py-2">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

function DetailSheet({ incident, onClose }: { incident: FixtureIncident; onClose: () => void }) {
  const dispatchable =
    incident.verification === "EMERGING" || incident.verification === "UNREPORTED";

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        overlayClassName="bg-black/10 backdrop-blur-[1px]"
        className="sentry-glass-strong inset-y-6 right-6 flex h-[calc(100vh-3rem)] w-[min(520px,calc(100vw-3rem))] max-w-none flex-col rounded-[16px] border-white/[0.15] p-0 shadow-2xl sm:max-w-none"
        aria-label={`Incident ${incident.shortId} detail`}
      >
        <SheetHeader className="space-y-2 border-b border-white/10 px-5 py-4 pr-12 text-left">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle className="font-mono text-sm font-semibold text-zinc-100">
                {incident.shortId}
              </SheetTitle>
              <SheetDescription className="mt-1 text-xs text-zinc-400">
                {incident.neighborhood}, {incident.county} {incident.state} ·{" "}
                {formatAge(incident.ageMinutes)}
              </SheetDescription>
            </div>
            <Badge
              className={cn(
                "rounded-[8px] px-2 text-[10px] uppercase shadow-none",
                statusColorClass(incident.verification),
              )}
            >
              {statusLabel(incident.verification)}
            </Badge>
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-5">
            <Section
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
              title="Intelligence"
              subtitle="Live cross-check"
            >
              <IntelPanel incidentId={incident.id} />
            </Section>

            <Section
              icon={<MapPin className="h-3.5 w-3.5" />}
              title="Hotspot"
              subtitle="Satellite thermal anomaly"
            >
              <div className="grid grid-cols-2 gap-3 text-xs">
                <Field label="Lat" value={incident.lat.toFixed(4)} />
                <Field label="Lon" value={incident.lon.toFixed(4)} />
                <Field label="FIRMS confidence" value={incident.firmsConfidence} capitalize />
                <Field label="Bright TI4" value={`${incident.brightTi4.toFixed(1)} K`} />
                <Field label="FRP" value={`${incident.fireRadiativePower.toFixed(0)} MW`} />
                <Field label="Age" value={`${incident.ageMinutes} min`} />
              </div>
            </Section>

            <Section
              icon={<Wind className="h-3.5 w-3.5" />}
              title="Wind and spread"
              subtitle="ML contour horizons"
            >
              <div className="flex items-center gap-4">
                <WindRose dirDeg={incident.windDirDeg} speedMs={incident.windSpeedMs} />
                <div className="text-xs">
                  <div className="font-medium text-zinc-100">
                    {incident.windSpeedMs.toFixed(1)} m/s @ {Math.round(incident.windDirDeg)}° from
                  </div>
                  <div className="mt-1 text-zinc-400">
                    HRRR cycle · 60 min freshness · spread cache hot
                  </div>
                </div>
              </div>
              {incident.predictedSpread.length > 0 ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {incident.predictedSpread.map((p) => (
                    <div
                      key={p.horizonMin}
                      className="rounded-[10px] border border-white/10 bg-white/[0.06] px-2.5 py-2 text-xs"
                    >
                      <div className="text-[10px] uppercase text-zinc-500">
                        +{p.horizonMin === 60 ? "1h" : p.horizonMin === 360 ? "6h" : "24h"}
                      </div>
                      <div className="mt-1 font-semibold text-zinc-100">
                        {p.areaAcres.toLocaleString()} acres
                      </div>
                      <div className="text-[10px] text-zinc-500">bearing {p.bearingDeg}°</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-[10px] border border-dashed border-white/[0.15] px-3 py-2 text-xs text-zinc-400">
                  Spread suppressed because this verification status does not warrant prediction.
                </div>
              )}
            </Section>

            <Section
              icon={
                incident.verificationSources[0]?.kind === "registry" ? (
                  <ShieldOff className="h-3.5 w-3.5" />
                ) : (
                  <Newspaper className="h-3.5 w-3.5" />
                )
              }
              title="Verification sources"
              subtitle="News, social, scanner and registry"
            >
              {incident.verificationSources.length === 0 ? (
                <div className="rounded-[10px] border border-dashed border-white/[0.15] px-3 py-3 text-xs text-zinc-400">
                  No corroborating signals in the last 60 minutes.
                </div>
              ) : (
                <ul className="space-y-2">
                  {incident.verificationSources.map((s, idx) => (
                    <li
                      key={idx}
                      className="rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-3 text-[10px] uppercase text-zinc-500">
                        <span className="inline-flex items-center gap-1.5">
                          {sourceIcon(s.kind)} {s.kind} · {s.source}
                        </span>
                        <span>{s.ageMinutes} min ago</span>
                      </div>
                      <div className="mt-1 font-medium text-zinc-100">{s.title}</div>
                      <div className="mt-0.5 text-zinc-400">{s.snippet}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section
              icon={<Truck className="h-3.5 w-3.5" />}
              title="Nearest stations"
              subtitle="ETA ranked"
            >
              {incident.stations.length === 0 ? (
                <div className="rounded-[10px] border border-dashed border-white/[0.15] px-3 py-3 text-xs text-zinc-400">
                  No stations within range.
                </div>
              ) : (
                <ul className="space-y-2">
                  {incident.stations.map((s, idx) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-3 rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs"
                    >
                      <div>
                        <div className="font-medium text-zinc-100">
                          {idx === 0 && <span className="mr-1.5 text-emerald-300">●</span>}
                          {s.name}
                        </div>
                        <div className="text-[11px] text-zinc-500">{s.agency}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-zinc-100">{s.etaMinutes} min</div>
                        <div className="text-[11px] text-zinc-500">
                          {s.distanceKm.toFixed(1)} km
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </ScrollArea>

        <SheetFooter className="border-t border-white/10 bg-black/[0.14] px-5 py-4 sm:flex-col sm:space-x-0">
          <Button
            disabled={!dispatchable}
            className={cn(
              "h-11 w-full rounded-[12px] text-sm font-semibold",
              dispatchable
                ? "sentry-primary-gradient hover:opacity-95"
                : "cursor-not-allowed border border-white/10 bg-white/[0.08] text-zinc-500",
            )}
          >
            <Send className="h-4 w-4" />
            {dispatchable
              ? `Dispatch ${
                  incident.stations[0]?.name.split(" ").slice(0, 3).join(" ") ?? "nearest"
                }`
              : "Dispatch suppressed for this verification status"}
          </Button>
          <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3" />
              human-in-the-loop · audit logged
            </span>
            <span>Esc closes detail</span>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="sentry-glass rounded-[14px] p-3.5">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-orange-500/[0.12] text-[var(--forge-orange-light)]">
          {icon}
        </span>
        <div>
          <div className="font-semibold text-zinc-100">{title}</div>
          <div className="text-[11px] text-zinc-500">{subtitle}</div>
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-2">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={cn("mt-0.5 font-semibold text-zinc-100", capitalize && "capitalize")}>
        {value}
      </div>
    </div>
  );
}

function WindRose({ dirDeg, speedMs }: { dirDeg: number; speedMs: number }) {
  const angle = ((dirDeg - 90) * Math.PI) / 180;
  const r = 28;
  const x = 36 + r * Math.cos(angle);
  const y = 36 + r * Math.sin(angle);
  const opp = ((dirDeg + 90) * Math.PI) / 180;
  const tx = 36 + r * Math.cos(opp);
  const ty = 36 + r * Math.sin(opp);

  return (
    <svg width={72} height={72} viewBox="0 0 72 72" className="shrink-0">
      <circle cx={36} cy={36} r={32} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
      <circle
        cx={36}
        cy={36}
        r={20}
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="0.6"
        strokeDasharray="2 2"
      />
      {["N", "E", "S", "W"].map((n, i) => {
        const a = ((i * 90 - 90) * Math.PI) / 180;
        return (
          <text
            key={n}
            x={36 + 30 * Math.cos(a)}
            y={36 + 30 * Math.sin(a) + 3}
            fontSize="8"
            textAnchor="middle"
            fill="rgb(113 113 122)"
          >
            {n}
          </text>
        );
      })}
      <line
        x1={36}
        y1={36}
        x2={x}
        y2={y}
        stroke="var(--forge-orange-light)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <line
        x1={36}
        y1={36}
        x2={tx}
        y2={ty}
        stroke="rgba(255,255,255,0.24)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx={36} cy={36} r="2.7" fill="var(--forge-orange-light)" />
      <text x={36} y={68} fontSize="7" textAnchor="middle" fill="rgb(161 161 170)">
        {speedMs.toFixed(1)} m/s
      </text>
    </svg>
  );
}

function sourceIcon(kind: "news" | "social" | "scanner" | "registry") {
  switch (kind) {
    case "news":
      return <Newspaper className="h-3 w-3" />;
    case "social":
      return <MessageSquare className="h-3 w-3" />;
    case "scanner":
      return <Radio className="h-3 w-3" />;
    case "registry":
      return <Building2 className="h-3 w-3" />;
  }
}
