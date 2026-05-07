import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from "recharts";
import { AlertCircle, Play, Pause, RotateCcw, Zap } from "lucide-react";

export default function Dashboard() {
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch bot status
  const { data: botStatus, refetch: refetchStatus } = trpc.bot.status.useQuery();
  const { data: equityHistory } = trpc.bot.equityHistory.useQuery({ hoursBack: 24 });
  const { data: recentTrades } = trpc.bot.recentTrades.useQuery({ limit: 10 });
  const { data: openOrders } = trpc.bot.openOrders.useQuery();

  // Mutations
  const startMutation = trpc.bot.start.useMutation();
  const stopMutation = trpc.bot.stop.useMutation();
  const pauseMutation = trpc.bot.pause.useMutation();
  const resumeMutation = trpc.bot.resume.useMutation();
  const setExecutionModeMutation = trpc.bot.setExecutionMode.useMutation();

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      refetchStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, refetchStatus]);

  const handleStart = async () => {
    await startMutation.mutateAsync();
    refetchStatus();
  };

  const handleStop = async () => {
    await stopMutation.mutateAsync();
    refetchStatus();
  };

  const handlePause = async () => {
    await pauseMutation.mutateAsync();
    refetchStatus();
  };

  const handleResume = async () => {
    await resumeMutation.mutateAsync();
    refetchStatus();
  };

  const handleToggleMode = async () => {
    const newMode = botStatus?.executionMode === "paper" ? "live" : "paper";
    await setExecutionModeMutation.mutateAsync({ mode: newMode });
    refetchStatus();
  };

  const drawdown = botStatus?.config?.drawdownLimit ? 0 : 0; // Placeholder
  const isEmergency = botStatus?.emergencyBrakeTriggered;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Polymarket Trading Bot</h1>
          <p className="text-muted-foreground">Real-time autonomous trading dashboard</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={botStatus?.isRunning ? "default" : "secondary"}>
            {botStatus?.isRunning ? "Running" : "Stopped"}
          </Badge>
          <Badge variant={botStatus?.isPaused ? "destructive" : "outline"}>
            {botStatus?.isPaused ? "Paused" : "Active"}
          </Badge>
          {isEmergency && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Emergency Brake
            </Badge>
          )}
        </div>
      </div>

      {/* Control Panel */}
      <Card>
        <CardHeader>
          <CardTitle>Bot Controls</CardTitle>
          <CardDescription>Manage bot execution and mode</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3 flex-wrap">
          <Button onClick={handleStart} disabled={botStatus?.isRunning} size="sm">
            <Play className="w-4 h-4 mr-2" />
            Start
          </Button>
          <Button onClick={handleStop} disabled={!botStatus?.isRunning} variant="destructive" size="sm">
            Stop
          </Button>
          <Button onClick={handlePause} disabled={botStatus?.isPaused || !botStatus?.isRunning} variant="outline" size="sm">
            <Pause className="w-4 h-4 mr-2" />
            Pause
          </Button>
          <Button onClick={handleResume} disabled={!botStatus?.isPaused} variant="outline" size="sm">
            <RotateCcw className="w-4 h-4 mr-2" />
            Resume
          </Button>
          <Button onClick={handleToggleMode} variant="secondary" size="sm">
            <Zap className="w-4 h-4 mr-2" />
            Mode: {botStatus?.executionMode === "paper" ? "Paper" : "Live"}
          </Button>
          <Button onClick={() => setAutoRefresh(!autoRefresh)} variant="outline" size="sm">
            {autoRefresh ? "Auto-refresh: ON" : "Auto-refresh: OFF"}
          </Button>
        </CardContent>
      </Card>

      {/* Equity & Risk Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Current Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$10,000</div>
            <p className="text-xs text-muted-foreground">USDC</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Drawdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{drawdown.toFixed(2)}%</div>
            <p className="text-xs text-muted-foreground">
              Limit: {botStatus?.config?.drawdownLimit}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Exposure</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0%</div>
            <p className="text-xs text-muted-foreground">
              Max: {botStatus?.config?.maxTotalExposure}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Equity Curve */}
      <Card>
        <CardHeader>
          <CardTitle>Equity Curve (24h)</CardTitle>
          <CardDescription>Balance over time</CardDescription>
        </CardHeader>
        <CardContent>
          {equityHistory && equityHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={equityHistory}>
                <defs>
                  <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="balance" stroke="#3b82f6" fillOpacity={1} fill="url(#colorBalance)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-muted-foreground">No equity history available</div>
          )}
        </CardContent>
      </Card>

      {/* Open Orders */}
      <Card>
        <CardHeader>
          <CardTitle>Open Orders</CardTitle>
          <CardDescription>{openOrders?.length || 0} active orders</CardDescription>
        </CardHeader>
        <CardContent>
          {openOrders && openOrders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Nonce</th>
                    <th className="text-left py-2">Market</th>
                    <th className="text-left py-2">Side</th>
                    <th className="text-left py-2">Price</th>
                    <th className="text-left py-2">Size</th>
                    <th className="text-left py-2">Edge</th>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.map((order) => (
                    <tr key={order.nonce} className="border-b hover:bg-muted/50">
                      <td className="py-2 font-mono text-xs">{order.nonce.slice(0, 12)}...</td>
                      <td className="py-2">{order.marketId.slice(0, 8)}...</td>
                      <td className="py-2">
                        <Badge variant={order.side === "buy" ? "default" : "secondary"}>{order.side}</Badge>
                      </td>
                      <td className="py-2">{Number(order.price).toFixed(4)}</td>
                      <td className="py-2">{Number(order.size).toFixed(2)}</td>
                      <td className="py-2">{Number(order.edgeAtPlacement || 0).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">No open orders</div>
          )}
        </CardContent>
      </Card>

      {/* Recent Trades */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Trades</CardTitle>
          <CardDescription>Last 10 executed trades</CardDescription>
        </CardHeader>
        <CardContent>
          {recentTrades && recentTrades.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Market</th>
                    <th className="text-left py-2">Side</th>
                    <th className="text-left py-2">Price</th>
                    <th className="text-left py-2">Size</th>
                    <th className="text-left py-2">Value</th>
                    <th className="text-left py-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrades.map((trade) => (
                    <tr key={trade.id} className="border-b hover:bg-muted/50">
                      <td className="py-2">{trade.marketId.slice(0, 8)}...</td>
                      <td className="py-2">
                        <Badge variant={trade.side === "buy" ? "default" : "secondary"}>{trade.side}</Badge>
                      </td>
                      <td className="py-2">{Number(trade.price).toFixed(4)}</td>
                      <td className="py-2">{Number(trade.size).toFixed(2)}</td>
                      <td className="py-2">${Number(trade.usdcValue).toFixed(2)}</td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {new Date(trade.filledAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">No trades yet</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
