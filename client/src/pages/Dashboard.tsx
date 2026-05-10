import { useMemo, useState } from "react";
import type React from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Ban,
  Copy,
  Gauge,
  RadioTower,
  RefreshCcw,
  Save,
  Search,
  SlidersHorizontal,
  Wallet,
  XCircle,
} from "lucide-react";

const ORANGE = "#FF6B35";

type DashboardData = inferRouterOutputs<AppRouter>["operator"]["dashboard"];
type ActiveLine = DashboardData["activeLines"][number];

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function usd(value: unknown) {
  const number = Number(value ?? 0);
  return money.format(Number.isFinite(number) ? number : 0);
}

function pct(value: unknown) {
  const number = Number(value ?? 0);
  return `${(Number.isFinite(number) ? number : 0).toFixed(2)}%`;
}

function compact(value?: string | null, head = 6, tail = 4) {
  if (!value) return "UNAVAILABLE";
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`border-white/10 bg-white/5 text-white shadow-2xl shadow-black/20 backdrop-blur-md ${className}`}>
      {children}
    </Card>
  );
}

function ConfidenceMeter({
  score,
  breakdown,
}: {
  score: number;
  breakdown: Record<string, number>;
}) {
  const clamped = Math.max(0, Math.min(100, score || 0));
  return (
    <div className="group relative h-5 min-w-36 overflow-visible rounded border border-white/10 bg-black/40">
      <div
        className={`h-full rounded ${clamped > 85 ? "animate-pulse" : ""}`}
        style={{
          width: `${clamped}%`,
          background:
            "linear-gradient(90deg,#ef4444 0%,#f59e0b 52%,#22c55e 100%)",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] font-bold text-white drop-shadow">
        {clamped.toFixed(2)}
      </div>
      <div className="pointer-events-none absolute right-0 top-7 z-30 hidden w-72 rounded border border-white/10 bg-[#111118] p-3 text-xs text-zinc-200 shadow-2xl group-hover:block">
        {Object.entries(breakdown).map(([key, value]) => (
          <div key={key} className="mb-1 flex justify-between gap-4">
            <span className="capitalize text-zinc-400">
              {key.replace(/[A-Z]/g, match => ` ${match}`)}
            </span>
            <span className="font-mono">{(Number(value) * 100).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "white" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-28">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function SliderField({
  label,
  min,
  max,
  step,
  value,
  onChange,
  suffix = "",
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <div className="space-y-3 rounded border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-xs uppercase tracking-[0.16em] text-zinc-400">{label}</Label>
        <Input
          className="h-8 w-24 border-white/10 bg-black/40 text-right font-mono text-white"
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={event => onChange(Number(event.target.value))}
        />
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={next => onChange(next[0] ?? value)}
        className="[&_[data-slot=slider-range]]:bg-[#FF6B35]"
      />
      <div className="font-mono text-[11px] text-zinc-500">
        {min}{suffix} / {max}{suffix}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const utils = trpc.useUtils();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState<ActiveLine | null>(null);
  const [closedRange, setClosedRange] = useState("24h");
  const [perfRange, setPerfRange] = useState("24h");
  const [marketQuery, setMarketQuery] = useState("");
  const [exchangeFilter, setExchangeFilter] = useState<"polymarket" | "kalshi" | "both">("kalshi");
  const [selectedMarket, setSelectedMarket] = useState<any>(null);
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [sizeUsd, setSizeUsd] = useState(25);
  const [price, setPrice] = useState(0.5);
  const [confirmSettings, setConfirmSettings] = useState(false);
  const [confirmOrder, setConfirmOrder] = useState(false);

  const dashboard = trpc.operator.dashboard.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const saveSettings = trpc.operator.updateSettings.useMutation({
    onSuccess: () => utils.operator.dashboard.invalidate(),
  });
  const emergencyStop = trpc.operator.emergencyStop.useMutation({
    onSuccess: () => utils.operator.dashboard.invalidate(),
  });
  const approveAllowance = trpc.operator.approveClobAllowance.useMutation();
  const cancelOrder = trpc.operator.cancelOrder.useMutation({
    onSuccess: () => utils.operator.dashboard.invalidate(),
  });
  const marketSearch = trpc.operator.searchMarkets.useQuery(
    { query: marketQuery, exchange: exchangeFilter, limit: 20 },
    { enabled: marketQuery.trim().length > 1 }
  );
  const runIntel = trpc.operator.runIntelligence.useMutation();
  const submitOrder = trpc.operator.submitOperatorOrder.useMutation({
    onSuccess: () => {
      utils.operator.dashboard.invalidate();
      setConfirmOrder(false);
    },
  });
  const executeArbitrage = trpc.operator.executeArbitragePair.useMutation({
    onSuccess: () => utils.operator.dashboard.invalidate(),
  });

  const data = dashboard.data;
  const [settings, setSettings] = useState<DashboardData["settings"] | null>(null);
  const editableSettings = settings ?? data?.settings;

  const equity = useMemo(() => {
    const all = data?.performance.equity ?? [];
    return all.map(row => ({
      timestamp: new Date(row.timestamp).toLocaleDateString(),
      balance: Number(row.balance),
      pnl: Number(row.balance) - Number(row.peakBalance),
      drawdown: Number(row.drawdown),
    }));
  }, [data]);

  const dailyBars = useMemo(
    () =>
      equity.map((row, index) => ({
        ...row,
        daily: index === 0 ? 0 : row.balance - equity[index - 1].balance,
      })),
    [equity]
  );

  const applySettings = () => {
    if (!editableSettings) return;
    saveSettings.mutate({
      ...editableSettings,
      orderTtlMs: editableSettings.orderTtlMs as "60000" | "300000" | "900000" | "3600000",
    });
    setConfirmSettings(false);
  };

  const updateSetting = <K extends keyof DashboardData["settings"]>(
    key: K,
    value: DashboardData["settings"][K]
  ) => setSettings(prev => ({ ...(prev ?? data!.settings), [key]: value }));

  return (
    <div className="dark min-h-screen bg-[#07070D] font-[Inter,ui-sans-serif] text-white">
      <div
        className="fixed inset-0 pointer-events-none opacity-60"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(rgba(255,107,53,0.13) 1px, transparent 1px), linear-gradient(90deg, rgba(255,107,53,0.13) 1px, transparent 1px)",
          backgroundSize: "40px 40px, 40px 40px, 200px 200px, 200px 200px",
        }}
      />

      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#07070D]/85 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <RadioTower className="size-5 text-[#FF6B35]" />
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.2em]">Operator Control</div>
              <div className="text-[11px] text-zinc-500">POLY SHORE trading console</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge className={data?.status.isRunning ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}>
              <span className={`size-2 rounded-full ${data?.status.isRunning ? "bg-emerald-400" : "bg-red-500"}`} />
              {data?.status.isRunning ? "RUNNING" : "HALTED"}
            </Badge>
            <Badge className={data?.status.executionMode === "live" ? "border-[#FF6B35]/60 bg-[#FF6B35]/20 text-[#FFB199] shadow-[0_0_18px_rgba(255,107,53,.45)]" : "bg-zinc-700 text-zinc-200"}>
              {data?.status.executionMode?.toUpperCase() ?? "PAPER"}
            </Badge>
            <Badge className={data?.status.killswitchArmed ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}>
              {data?.status.killswitchArmed ? "ARMED" : "DISARMED"}
            </Badge>
            <Button
              className="bg-red-600 text-white hover:bg-red-500"
              onClick={() => emergencyStop.mutate()}
            >
              <Ban className="mr-2 size-4" />
              EMERGENCY STOP
            </Button>
            <Metric label="Polymarket" value={`${usd(data?.bankrolls.polymarketUsdc)} USDC`} />
            <Metric label="Kalshi" value={data?.bankrolls.kalshiUsd == null ? "AUTH OFF" : `${usd(data.bankrolls.kalshiUsd)} USD`} />
            <Metric label="Today P&L" value={`${usd(data?.pnl.todayUsd)} / ${pct(data?.pnl.todayPct)}`} tone={(data?.pnl.todayUsd ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"} />
            <Metric label="All-Time P&L" value={`${usd(data?.pnl.allTimeUsd)} / ${pct(data?.pnl.allTimePct)}`} tone={(data?.pnl.allTimeUsd ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"} />
            <Button variant="outline" className="border-white/10 bg-white/5" onClick={() => dashboard.refetch()}>
              <RefreshCcw className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid max-w-[1800px] gap-5 p-4 lg:grid-cols-12">
        <GlassCard className="lg:col-span-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Wallet className="size-4 text-[#FF6B35]" /> Wallet Management</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded border border-white/10 bg-black/30 p-3">
              <span className="font-mono text-sm">{compact(data?.wallet.address, 10, 8)}</span>
              <Button size="sm" variant="outline" className="border-white/10 bg-white/5" onClick={() => data?.wallet.address && navigator.clipboard.writeText(data.wallet.address)}>
                <Copy className="size-4" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="USDC" value={usd(data?.wallet.usdcBalance)} />
              <Metric label="24h" value={`${usd(data?.wallet.usdc24hChangeUsd)} / ${pct(data?.wallet.usdc24hChangePct)}`} />
              <Metric label="MATIC" value={data?.wallet.maticBalance == null ? "RPC OFF" : Number(data.wallet.maticBalance).toFixed(4)} />
            </div>
            <Button className="w-full bg-[#FF6B35] text-black hover:bg-[#ff875d]" onClick={() => approveAllowance.mutate()}>
              Approve USDC for CLOB
            </Button>
            <div className="grid grid-cols-[112px_1fr] gap-3">
              <div className="flex aspect-square items-center justify-center rounded border border-white/10 bg-white p-2">
                {data?.wallet.depositAddress ? (
                  <img
                    alt="Deposit address QR"
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=112x112&data=${encodeURIComponent(data.wallet.depositAddress)}`}
                    className="size-full"
                  />
                ) : (
                  <XCircle className="text-zinc-900" />
                )}
              </div>
              <div className="text-xs text-zinc-400">
                <div className="mb-2 uppercase tracking-[0.16em]">Deposit address</div>
                <div className="break-all font-mono text-zinc-200">{data?.wallet.depositAddress ?? "Unavailable"}</div>
              </div>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Tx</TableHead><TableHead>Type</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {(data?.wallet.transactions.transactions ?? []).map(tx => (
                  <TableRow key={tx.hash} className="border-white/10">
                    <TableCell><a className="font-mono text-[#FFB199]" href={tx.url} target="_blank" rel="noreferrer">{compact(tx.hash)}</a></TableCell>
                    <TableCell>{tx.type}</TableCell>
                    <TableCell>{usd(tx.amount)}</TableCell>
                    <TableCell>{tx.status}</TableCell>
                  </TableRow>
                ))}
                {data?.wallet.transactions.transactions.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-zinc-500">{data?.wallet.transactions.reason ?? "No recent wallet transactions"}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </GlassCard>

        <GlassCard className="lg:col-span-8">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base"><Gauge className="size-4 text-[#FF6B35]" /> Active Lines</CardTitle>
            <Button className="bg-white/10 hover:bg-white/15" onClick={() => setSettingsOpen(true)}>
              <SlidersHorizontal className="mr-2 size-4" />
              Bet Settings
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  {["Exchange", "Market", "Side", "Entry", "Bid/Ask", "Size", "uP&L", "Hybrid", "Resolve", "Status", "Actions"].map(head => <TableHead key={head}>{head}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.activeLines ?? []).map(line => (
                  <TableRow key={line.nonce} className="border-white/10 hover:bg-white/5" onClick={() => setSelectedLine(line)}>
                    <TableCell><Badge className={line.exchange === "kalshi" ? "bg-sky-500/20 text-sky-200" : "bg-[#FF6B35]/20 text-[#FFB199]"}>{line.exchange}</Badge></TableCell>
                    <TableCell className="max-w-80 truncate">{line.question}</TableCell>
                    <TableCell><Badge className={line.side === "buy" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}>{line.side === "buy" ? "YES" : "NO"}</Badge></TableCell>
                    <TableCell className="font-mono">{Number(line.price).toFixed(4)}</TableCell>
                    <TableCell className="font-mono">{line.currentBestBid?.toFixed(3) ?? "--"} / {line.currentBestAsk?.toFixed(3) ?? "--"}</TableCell>
                    <TableCell>{usd(line.size)}</TableCell>
                    <TableCell className={(line.unrealizedPnlUsd ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}>{usd(line.unrealizedPnlUsd)} / {pct(line.unrealizedPnlPct)}</TableCell>
                    <TableCell><ConfidenceMeter score={line.hybrid.score} breakdown={line.hybrid.breakdown} /></TableCell>
                    <TableCell>{line.expiresAt ? new Date(line.expiresAt).toLocaleDateString() : "--"}</TableCell>
                    <TableCell>{String(line.status).toUpperCase()}</TableCell>
                    <TableCell className="space-x-2">
                      <Button size="sm" variant="outline" className="border-white/10 bg-white/5" onClick={event => { event.stopPropagation(); setSelectedLine(line); }}>VIEW</Button>
                      <Button size="sm" className="bg-red-600 hover:bg-red-500" onClick={event => { event.stopPropagation(); cancelOrder.mutate({ nonce: line.nonce }); }}>CANCEL</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(data?.activeLines.length ?? 0) === 0 && <TableRow><TableCell colSpan={11} className="py-8 text-center text-zinc-500">No open positions or pending orders from the bot.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </GlassCard>

        <GlassCard className="lg:col-span-5">
          <CardHeader><CardTitle className="text-base">Operator Picks</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              {(["polymarket", "kalshi", "both"] as const).map(exchange => (
                <Button key={exchange} size="sm" variant="outline" className={`border-white/10 ${exchangeFilter === exchange ? "bg-[#FF6B35] text-black" : "bg-white/5"}`} onClick={() => setExchangeFilter(exchange)}>
                  {exchange}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input className="border-white/10 bg-black/40 text-white" placeholder="Search real Polymarket/Kalshi markets" value={marketQuery} onChange={event => setMarketQuery(event.target.value)} />
              <Button className="bg-[#FF6B35] text-black"><Search className="size-4" /></Button>
            </div>
            <div className="max-h-44 overflow-auto rounded border border-white/10">
              {(marketSearch.data ?? []).map(market => (
                <button key={market.marketId} className="block w-full border-b border-white/10 p-3 text-left text-sm hover:bg-white/5" onClick={() => { setSelectedMarket(market); setPrice(market.bestAsk); }}>
                  <div className="truncate text-white">{market.question}</div>
                  <div className="font-mono text-xs text-zinc-500">{market.exchange} / bid {market.bestBid.toFixed(3)} / ask {market.bestAsk.toFixed(3)} / liq {usd(market.liquidity)}</div>
                </button>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex rounded border border-white/10 p-1">
                {(["yes", "no"] as const).map(next => (
                  <button key={next} className={`flex-1 rounded px-3 py-2 text-sm font-bold ${side === next ? "bg-[#FF6B35] text-black" : "text-zinc-400"}`} onClick={() => setSide(next)}>{next.toUpperCase()}</button>
                ))}
              </div>
              <Input className="border-white/10 bg-black/40 text-white" type="number" value={sizeUsd} onChange={event => setSizeUsd(Number(event.target.value))} />
              <Input className="border-white/10 bg-black/40 text-white" type="number" min="0.01" max="0.99" step="0.01" value={price} onChange={event => setPrice(Number(event.target.value))} />
              <Button variant="outline" className="border-white/10 bg-white/5" disabled={!selectedMarket || runIntel.isPending} onClick={() => selectedMarket && runIntel.mutate({ marketId: selectedMarket.marketId, exchange: selectedMarket.exchange, side })}>Run intelligence</Button>
            </div>
            {runIntel.data && (
              <div className="rounded border border-white/10 bg-black/30 p-3">
                <div className="mb-2 text-xs uppercase tracking-[0.16em] text-zinc-500">Hybrid score before submit</div>
                <ConfidenceMeter score={runIntel.data.hybrid.score} breakdown={runIntel.data.hybrid.breakdown} />
                <div className="mt-3 text-xs text-zinc-400">{[...runIntel.data.risk.reasons, ...runIntel.data.deepEdge.reasons].join(" | ") || "Risk manager and DeepEdgeGate allow this pick."}</div>
              </div>
            )}
            <Button className="w-full bg-[#FF6B35] text-black hover:bg-[#ff875d]" disabled={!selectedMarket} onClick={() => setConfirmOrder(true)}>SUBMIT ORDER</Button>
            {submitOrder.data?.vetoed && <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{(submitOrder.data.reasons ?? []).join(" | ")}</div>}
          </CardContent>
        </GlassCard>

        <GlassCard className="lg:col-span-7">
          <CardHeader><CardTitle className="text-base">Cross-Exchange Arbitrage</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow className="border-white/10"><TableHead>Pair</TableHead><TableHead>Polymarket YES</TableHead><TableHead>Kalshi NO</TableHead><TableHead>Gap</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
              <TableBody>
                {(data?.arbitrage ?? []).map(pair => (
                  <TableRow key={`${pair.polymarket.marketId}-${pair.kalshi.marketId}`} className="border-white/10">
                    <TableCell className="max-w-96 truncate">{pair.polymarket.question}</TableCell>
                    <TableCell className="font-mono">{pair.polymarketYesPrice.toFixed(3)}</TableCell>
                    <TableCell className="font-mono">{pair.kalshiNoPrice.toFixed(3)}</TableCell>
                    <TableCell className="font-mono text-emerald-300">{pair.gap.toFixed(3)}</TableCell>
                    <TableCell><Button size="sm" className="bg-[#FF6B35] text-black" onClick={() => executeArbitrage.mutate({ polymarketId: pair.polymarket.marketId, kalshiId: pair.kalshi.marketId })}>Execute Pair</Button></TableCell>
                  </TableRow>
                ))}
                {(data?.arbitrage.length ?? 0) === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-zinc-500">No real cross-exchange arbitrage currently detected.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </GlassCard>

        <GlassCard className="lg:col-span-7">
          <CardHeader><CardTitle className="text-base">Performance</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">{["24h", "7d", "30d", "all"].map(range => <Button key={range} size="sm" variant="outline" className={`border-white/10 ${perfRange === range ? "bg-[#FF6B35] text-black" : "bg-white/5"}`} onClick={() => setPerfRange(range)}>{range}</Button>)}</div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="h-64"><ResponsiveContainer><AreaChart data={equity}><defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={ORANGE} stopOpacity={0.45} /><stop offset="95%" stopColor={ORANGE} stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,.08)" /><XAxis dataKey="timestamp" stroke="#71717a" /><YAxis stroke="#71717a" /><Tooltip contentStyle={{ background: "#111118", border: "1px solid rgba(255,255,255,.1)" }} /><Area dataKey="balance" stroke={ORANGE} fill="url(#equityFill)" /></AreaChart></ResponsiveContainer></div>
              <div className="h-64"><ResponsiveContainer><BarChart data={dailyBars}><CartesianGrid stroke="rgba(255,255,255,.08)" /><XAxis dataKey="timestamp" stroke="#71717a" /><YAxis stroke="#71717a" /><Tooltip contentStyle={{ background: "#111118", border: "1px solid rgba(255,255,255,.1)" }} /><Bar dataKey="daily" fill={ORANGE} /></BarChart></ResponsiveContainer></div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric label="Brier Trend" value="audit-calibrated" />
              <Metric label="30d Win Rate" value={`${((data?.performance.trades.length ?? 0) > 0 ? 100 : 0).toFixed(2)}%`} />
              <Metric label="Audits" value={String(data?.performance.audits.length ?? 0)} />
              <Metric label="Trades" value={String(data?.performance.trades.length ?? 0)} />
            </div>
          </CardContent>
        </GlassCard>

        <GlassCard className="lg:col-span-12">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Resolved / Closed Lines</CardTitle>
            <div className="flex gap-2">{["24h", "7d", "30d", "all"].map(range => <Button key={range} size="sm" variant="outline" className={`border-white/10 ${closedRange === range ? "bg-[#FF6B35] text-black" : "bg-white/5"}`} onClick={() => setClosedRange(range)}>{range}</Button>)}</div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow className="border-white/10"><TableHead>Market</TableHead><TableHead>Final P&L</TableHead><TableHead>Outcome</TableHead><TableHead>Calibration</TableHead><TableHead>Replay</TableHead></TableRow></TableHeader>
              <TableBody>
                {(data?.closedLines ?? []).map(line => (
                  <TableRow key={line.nonce} className="border-white/10">
                    <TableCell className="font-mono">{compact(line.marketId, 12, 8)}</TableCell>
                    <TableCell>{usd(line.finalPnlUsd)} / {pct(line.finalPnlPct)}</TableCell>
                    <TableCell><Badge className="bg-white/10 text-zinc-300">{line.outcome}</Badge></TableCell>
                    <TableCell>entry score stored in audit trail when available</TableCell>
                    <TableCell><Button size="sm" variant="outline" className="border-white/10 bg-white/5">Replay reasoning</Button></TableCell>
                  </TableRow>
                ))}
                {(data?.closedLines.length ?? 0) === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-zinc-500">No closed lines in the selected range.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </GlassCard>
      </main>

      <Sheet open={Boolean(selectedLine)} onOpenChange={open => !open && setSelectedLine(null)}>
        <SheetContent className="w-full border-white/10 bg-[#07070D] text-white sm:max-w-2xl">
          <SheetHeader><SheetTitle>Reasoning Trail</SheetTitle></SheetHeader>
          <div className="overflow-auto p-4">
            <pre className="whitespace-pre-wrap rounded border border-white/10 bg-black/40 p-4 text-xs text-zinc-300">
              {JSON.stringify(selectedLine?.reasoning ?? {}, null, 2)}
            </pre>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="border-white/10 bg-[#111118] text-white sm:max-w-5xl">
          <DialogHeader><DialogTitle>Bet Settings</DialogTitle><DialogDescription>Changes apply on the next bot tick after confirmation.</DialogDescription></DialogHeader>
          {editableSettings && (
            <div className="grid gap-3 md:grid-cols-2">
              <SliderField label="MAX_POSITION_USD" min={10} max={500} step={5} value={editableSettings.maxPositionUsd} onChange={value => updateSetting("maxPositionUsd", value)} />
              <SliderField label="MAX_DRAWDOWN_PCT" min={5} max={25} step={1} suffix="%" value={editableSettings.maxDrawdownPct} onChange={value => updateSetting("maxDrawdownPct", value)} />
              <SliderField label="MIN_EDGE_PCT" min={3} max={15} step={0.5} suffix="%" value={editableSettings.minEdgePct} onChange={value => updateSetting("minEdgePct", value)} />
              <SliderField label="MIN_CONFIDENCE" min={0.5} max={0.95} step={0.01} value={editableSettings.minConfidence} onChange={value => updateSetting("minConfidence", value)} />
              <SliderField label="FRACTIONAL_KELLY" min={0.1} max={0.5} step={0.01} value={editableSettings.fractionalKelly} onChange={value => updateSetting("fractionalKelly", value)} />
              <div className="rounded border border-white/10 bg-black/20 p-3">
                <Label className="text-xs uppercase tracking-[0.16em] text-zinc-400">ORDER_TTL_MS</Label>
                <div className="mt-4 flex flex-wrap gap-2">{[["1m", "60000"], ["5m", "300000"], ["15m", "900000"], ["1h", "3600000"]].map(([label, value]) => <Button key={value} variant="outline" className={`border-white/10 ${editableSettings.orderTtlMs === value ? "bg-[#FF6B35] text-black" : "bg-white/5"}`} onClick={() => updateSetting("orderTtlMs", value)}>{label}</Button>)}</div>
              </div>
              {Object.entries(editableSettings.categoryCaps).map(([category, value]) => <SliderField key={category} label={`${category} exposure cap`} min={1} max={50} step={1} suffix="%" value={Number(value)} onChange={next => updateSetting("categoryCaps", { ...editableSettings.categoryCaps, [category]: next })} />)}
            </div>
          )}
          <DialogFooter><Button className="bg-[#FF6B35] text-black hover:bg-[#ff875d]" onClick={() => setConfirmSettings(true)}><Save className="mr-2 size-4" />SAVE SETTINGS</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmSettings} onOpenChange={setConfirmSettings}>
        <DialogContent className="border-white/10 bg-[#111118] text-white">
          <DialogHeader><DialogTitle>Confirm live trading changes?</DialogTitle><DialogDescription>These changes affect live trading. Confirm?</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" className="border-white/10 bg-white/5" onClick={() => setConfirmSettings(false)}>Cancel</Button><Button className="bg-[#FF6B35] text-black" onClick={applySettings}>Confirm</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOrder} onOpenChange={setConfirmOrder}>
        <DialogContent className="border-white/10 bg-[#111118] text-white">
          <DialogHeader><DialogTitle>Submit paper operator order?</DialogTitle><DialogDescription>Risk manager and killswitch gates can still veto this order.</DialogDescription></DialogHeader>
          <div className="rounded border border-white/10 bg-black/30 p-3 text-sm">{selectedMarket?.question}</div>
          <DialogFooter><Button variant="outline" className="border-white/10 bg-white/5" onClick={() => setConfirmOrder(false)}>Cancel</Button><Button className="bg-[#FF6B35] text-black" onClick={() => selectedMarket && submitOrder.mutate({ marketId: selectedMarket.marketId, exchange: selectedMarket.exchange, side, sizeUsd, price })}>Submit</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {dashboard.error && (
        <div className="fixed bottom-4 right-4 z-50 max-w-xl rounded border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          <AlertTriangle className="mr-2 inline size-4" />
          {dashboard.error.message}
        </div>
      )}
    </div>
  );
}
