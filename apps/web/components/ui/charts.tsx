"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";

// ── Request Volume Trend (real created vs resolved counts) ───────────────────
interface RequestTrendChartProps {
  data: Array<{ date: string; created: number; resolved: number }>;
}

export function RequestTrendChart({ data }: RequestTrendChartProps) {
  return (
    <div className="h-48 mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-primary, #0f766e)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--color-primary, #0f766e)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
          />
          <Area type="monotone" dataKey="created" name="Created" stroke="var(--color-primary, #0f766e)" strokeWidth={2.5} fill="url(#reqGrad)" dot={{ fill: "var(--color-primary, #0f766e)", r: 3 }} activeDot={{ r: 5 }} />
          <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#f59e0b" strokeWidth={2} fill="transparent" dot={{ fill: "#f59e0b", r: 2.5 }} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Revenue Bar Chart ────────────────────────────────────────────────────────
interface RevenueBarProps {
  data: Array<{ day: string; upgrades: number; lateCO: number; fnb: number }>;
}

export function RevenueBarChart({ data }: RevenueBarProps) {
  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
            formatter={(val) => [`₹${(val as number).toLocaleString()}`, ""]}
          />
          <Bar dataKey="upgrades" stackId="a" fill="var(--color-primary, #0f766e)" radius={[0, 0, 0, 0]} name="Upgrades" />
          <Bar dataKey="lateCO" stackId="a" fill="#14b8a6" name="Late C/O" />
          <Bar dataKey="fnb" stackId="a" fill="#f59e0b" radius={[3, 3, 0, 0]} name="F&B Offers" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Donut Chart (Guest Segment) ───────────────────────────────────────────────
interface DonutChartProps {
  data: Array<{ name: string; value: number; color: string }>;
  total: string;
  label?: string;
}

export function DonutChart({ data, total, label }: DonutChartProps) {
  return (
    <div className="relative h-44">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={52} outerRadius={72} dataKey="value" paddingAngle={2}>
            {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        {label && <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>}
        <div className="text-lg font-bold text-slate-800">{total}</div>
      </div>
    </div>
  );
}

// ── Sentiment Line Chart ──────────────────────────────────────────────────────
interface SentimentLineProps {
  data: Array<{ day: number; score: number; prev?: number }>;
}

export function SentimentLineChart({ data }: SentimentLineProps) {
  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
            tickFormatter={(v: number) => `DAY ${v}`}
            ticks={[1, 5, 10, 15, 20, 25, 30]}
          />
          <YAxis domain={[40, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
          <Line type="monotone" dataKey="score" stroke="var(--color-primary, #0f766e)" strokeWidth={2} dot={false} name="Current Period" />
          {data[0]?.prev !== undefined && (
            <Line type="monotone" dataKey="prev" stroke="#cbd5e1" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Previous Period" />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Efficiency Trend Line Chart ───────────────────────────────────────────────
interface EfficiencyChartProps {
  data: Array<{ day: string; minutes: number }>;
}

export function EfficiencyChart({ data }: EfficiencyChartProps) {
  return (
    <div className="h-36">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
          <defs>
            <linearGradient id="effGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-primary, #0f766e)" stopOpacity={0.2} />
              <stop offset="95%" stopColor="var(--color-primary, #0f766e)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
            formatter={(v) => [`${v as number}m`, "Avg Resolution"]}
          />
          <Area type="monotone" dataKey="minutes" stroke="var(--color-primary, #0f766e)" strokeWidth={2} fill="url(#effGrad)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Campaign Execution Bar ────────────────────────────────────────────────────
interface CampaignBarProps {
  data: Array<{ day: string; executions: number; conversions: number }>;
}

export function CampaignBarChart({ data }: CampaignBarProps) {
  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="executions" fill="var(--color-primary, #0f766e)" radius={[3, 3, 0, 0]} name="Executions" />
          <Bar dataKey="conversions" fill="#f59e0b" radius={[3, 3, 0, 0]} name="Conversions" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
