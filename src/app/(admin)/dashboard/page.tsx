"use client";

import { useState } from "react";
import { useFetch } from "@/components/hooks";
import Link from "next/link";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";

interface ChartPoint {
  date: string;
  count: number | string;
}

interface SourceBreakdown {
  source: string;
  count: number | string;
}

interface PerChatbotStat {
  chatbot_id: number;
  chatbot_name: string;
  count: number | string;
  tokens_today: number | string;
}

interface DashboardStats {
  chatbots: number;
  conversations: number;
  messages: number;
  unique_visitors: number;
  total_tokens: number;
  chart_range: number;
  chart: ChartPoint[];
  source_breakdown: SourceBreakdown[];
  chatbot_stats: PerChatbotStat[];
}

// Chart.js tree-shaking: register only what the bar chart uses.
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const RANGES = [7, 30, 90] as const;

/** "Aug 5" — the PHP chart's label format for the YYYY-MM-DD bucket. */
function chartLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function DashboardPage() {
  const [range, setRange] = useState<number>(30);
  const { data, error, loading } = useFetch<DashboardStats>(
    `/api/admin/dashboard?range=${range}`,
  );

  const chartData = {
    labels: (data?.chart ?? []).map((p) => chartLabel(p.date)),
    datasets: [
      {
        label: "Messages",
        data: (data?.chart ?? []).map((p) => Number(p.count)),
        // PHP's bar colour: rgba(13, 110, 253, .65) with a darker hover.
        backgroundColor: "rgba(13, 110, 253, 0.65)",
        hoverBackgroundColor: "rgba(13, 110, 253, 0.9)",
        borderRadius: 4,
        maxBarThickness: 28,
      },
    ],
  };
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
      y: { beginAtZero: true, ticks: { precision: 0 } },
    },
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="subtitle">Activity across your chatbots.</p>
        </div>
        <Link className="btn btn-primary" href="/chatbots/new">
          New chatbot
        </Link>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading...</p>
      ) : (
        data && (
          <>
            <div className="stat-grid">
              <div className="stat">
                <div className="stat-label">Chatbots</div>
                <div className="stat-value">{data.chatbots}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Conversations</div>
                <div className="stat-value">{data.conversations}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Messages</div>
                <div className="stat-value">{data.messages}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Visitors</div>
                <div className="stat-value">{data.unique_visitors}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Tokens used</div>
                <div className="stat-value">{data.total_tokens.toLocaleString()}</div>
              </div>
            </div>

            <div className="card">
              <div className="card-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <h2>Messages (last {data.chart_range} days)</h2>
                <div style={{ display: "flex", gap: 6 }}>
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`btn btn-sm${r === data.chart_range ? " btn-active" : ""}`}
                      onClick={() => setRange(r)}
                    >
                      {r}d
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ position: "relative", height: 280 }}>
                <Bar data={chartData} options={chartOptions} aria-label="Messages per day bar chart" role="img" />
              </div>
            </div>

            <div className="card card-flush">
              <div className="card-head"><h2>Answers by source</h2></div>
              {data.source_breakdown.length === 0 ? (
                <p className="card-note muted">No assistant messages yet.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Messages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.source_breakdown.map((s) => (
                      <tr key={s.source}>
                        <td>{(s.source ?? "unknown").replace(/_/g, " ")}</td>
                        <td>{Number(s.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card card-flush">
              <div className="card-head"><h2>Conversations per chatbot</h2></div>
              {data.chatbot_stats.length === 0 ? (
                <p className="card-note muted">No conversations yet.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Chatbot</th>
                      <th>Conversations</th>
                      <th>Tokens today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.chatbot_stats.map((b) => (
                      <tr key={b.chatbot_id}>
                        <td>{b.chatbot_name ?? "Unknown"}</td>
                        <td>{Number(b.count)}</td>
                        <td>{Number(b.tokens_today).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )
      )}
    </>
  );
}