import { motion } from 'framer-motion';
import {
    Shield, Printer, Clock, Globe, CheckCircle, XCircle, AlertTriangle,
    ArrowRight, TrendingUp, Lightbulb, Activity, Camera, ExternalLink
} from 'lucide-react';

interface Report {
    url: string;
    sessionId: string;
    timestamp: string;
    duration: number;
    durationFormatted: string;
    reliabilityScore: number;
    riskLevel: string;
    siteType: string;
    summary: string;
    strengths: string[];
    recommendations: string[];
    execution: {
        totalTasks: number;
        tasksCompleted: number;
        totalActions: number;
        successfulActions: number;
        failedActions: number;
        pagesVisited: string[];
    };
    tasks: any[];
    timeline: any[];
    issues: any[];
    issuesSummary: {
        total: number;
        high: number;
        medium: number;
        low: number;
    };
    screenshots: string[];
}

interface Props {
    report: Report;
    sessionId: string;
}

function getScoreColor(score: number): string {
    if (score >= 80) return '#059669';
    if (score >= 60) return '#d97706';
    if (score >= 40) return '#ea580c';
    return '#dc2626';
}

function getRiskBadge(risk: string) {
    const styles: Record<string, string> = {
        low: 'badge-low',
        medium: 'badge-medium',
        high: 'badge-high',
        critical: 'badge-high',
    };
    return styles[risk] || styles.medium;
}

export default function FinalReport({ report, sessionId }: Props) {
    const scoreOffset = 283 - (283 * report.reliabilityScore / 100);
    const scoreColor = getScoreColor(report.reliabilityScore);

    return (
        <div className="print-container max-w-5xl mx-auto px-6 py-8">
            {/* Header */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
                className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-rn-primary/25">
                        <Shield className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-rn-dark">Sentra QA Report</h1>
                        <p className="text-xs text-rn-text-muted font-medium mt-0.5">{new Date(report.timestamp).toLocaleString()}</p>
                    </div>
                </div>
                <button onClick={() => window.print()}
                    style={{ '--speed': '3s', '--bg': 'rgba(124, 58, 237, 1)' } as React.CSSProperties}
                    className="no-print group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap border border-white/10 h-10 px-5 text-white [background:var(--bg)] rounded-lg transform-gpu transition-transform duration-200 active:translate-y-px shadow-md shadow-rn-primary/20 hover:shadow-lg hover:shadow-rn-primary/30">
                    <div className="-z-30 blur-[2px] absolute inset-0 overflow-visible [container-type:size]">
                        <div className="absolute inset-0 h-[100cqh] animate-shimmer-slide [aspect-ratio:1]">
                            <div className="animate-spin-around absolute -inset-full w-auto rotate-0 [background:conic-gradient(from_calc(270deg-45deg),transparent_0,#ffffff_90deg,transparent_90deg)]" />
                        </div>
                    </div>
                    <span className="relative flex items-center gap-2 text-sm font-bold">
                        <Printer className="w-4 h-4" /> Print Report
                    </span>
                    <div className="absolute -z-20 [background:var(--bg)] rounded-lg [inset:0.05em]" />
                </button>
            </motion.div>

            {/* URL + Meta */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}
                className="bg-white rounded-xl border border-rn-border p-5 mb-5 shadow-sm">
                <div className="flex items-center gap-3 mb-2.5">
                    <Globe className="w-4.5 h-4.5 text-rn-primary" />
                    <a href={report.url} target="_blank" rel="noopener" className="text-sm font-bold text-rn-primary hover:underline flex items-center gap-1.5">
                        {report.url}
                        <ExternalLink className="w-3 h-3" />
                    </a>
                </div>
                <div className="flex items-center gap-5 text-xs text-rn-text-muted font-medium">
                    <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {report.durationFormatted}</span>
                    <span>Type: <strong className="text-rn-dark capitalize">{report.siteType}</strong></span>
                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase ${getRiskBadge(report.riskLevel)}`}>
                        {report.riskLevel} risk
                    </span>
                </div>
            </motion.div>

            {/* Score + Summary */}
            <div className="grid grid-cols-12 gap-5 mb-5">
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}
                    className="col-span-4 bg-white rounded-xl border border-rn-border p-6 flex flex-col items-center justify-center shadow-sm">
                    <svg width="130" height="130" viewBox="0 0 100 100" className="score-ring mb-3">
                        <circle cx="50" cy="50" r="45" className="score-ring-bg" />
                        <circle cx="50" cy="50" r="45" className="score-ring-fill" stroke={scoreColor}
                            style={{ '--score-offset': scoreOffset } as any} />
                    </svg>
                    <p className="text-4xl font-black" style={{ color: scoreColor }}>{report.reliabilityScore}</p>
                    <p className="text-[10px] font-extrabold text-rn-text-muted uppercase tracking-widest mt-1">Reliability Score</p>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }}
                    className="col-span-8 bg-white rounded-xl border border-rn-border p-6 shadow-sm">
                    <h2 className="text-sm font-bold text-rn-dark mb-2.5 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-rn-primary" /> Test Summary
                    </h2>
                    <p className="text-xs text-rn-dark-2 leading-relaxed mb-4 font-medium">{report.summary}</p>
                    <div className="grid grid-cols-4 gap-2.5">
                        <MiniStat label="Tasks" value={`${report.execution.tasksCompleted}/${report.execution.totalTasks}`} />
                        <MiniStat label="Actions" value={report.execution.totalActions.toString()} />
                        <MiniStat label="Passed" value={report.execution.successfulActions.toString()} color="text-rn-success" />
                        <MiniStat label="Failed" value={report.execution.failedActions.toString()} color={report.execution.failedActions > 0 ? 'text-rn-danger' : 'text-rn-success'} />
                    </div>
                </motion.div>
            </div>

            {/* Issues */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}
                className="bg-white rounded-xl border border-rn-border p-6 mb-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-bold text-rn-dark flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-rn-warning" /> Issues ({report.issuesSummary.total})
                    </h2>
                    <div className="flex items-center gap-2 text-[10px] font-extrabold">
                        {report.issuesSummary.high > 0 && <span className="badge-high px-2 py-0.5 rounded-md">{report.issuesSummary.high} High</span>}
                        {report.issuesSummary.medium > 0 && <span className="badge-medium px-2 py-0.5 rounded-md">{report.issuesSummary.medium} Medium</span>}
                        {report.issuesSummary.low > 0 && <span className="badge-low px-2 py-0.5 rounded-md">{report.issuesSummary.low} Low</span>}
                    </div>
                </div>

                {report.issues.length === 0 ? (
                    <div className="flex items-center gap-3 p-3.5 rounded-lg bg-rn-success/5 border border-rn-success/10">
                        <CheckCircle className="w-4.5 h-4.5 text-rn-success" />
                        <span className="text-xs text-rn-success font-bold">No issues detected — great job!</span>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {report.issues.map((issue, i) => (
                            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-rn-surface-2 border border-rn-border hover:border-rn-border-bright transition-colors">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase badge-${issue.severity} shrink-0 mt-0.5`}>
                                    {issue.severity}
                                </span>
                                <div className="min-w-0">
                                    <span className="text-[10px] font-extrabold text-rn-text-muted uppercase tracking-widest">{issue.type}</span>
                                    <p className="text-xs text-rn-dark-2 mt-0.5 font-medium">{issue.message}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </motion.div>

            {/* Tasks */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.25 }}
                className="bg-white rounded-xl border border-rn-border p-6 mb-5 shadow-sm">
                <h2 className="text-sm font-bold text-rn-dark mb-4 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-rn-primary" /> Task Results
                </h2>
                <div className="space-y-2">
                    {report.tasks.map((task, i) => (
                        <div key={i} className="flex items-center gap-3.5 p-3 rounded-lg bg-rn-surface-2 border border-rn-border">
                            <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${task.status === 'passed' ? 'bg-rn-success/10' : task.status === 'partial' ? 'bg-rn-warning/10' : 'bg-rn-danger/10'
                                }`}>
                                {task.status === 'passed' ? <CheckCircle className="w-3.5 h-3.5 text-rn-success" /> :
                                    task.status === 'partial' ? <AlertTriangle className="w-3.5 h-3.5 text-rn-warning" /> :
                                        <XCircle className="w-3.5 h-3.5 text-rn-danger" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-rn-dark">{task.name}</p>
                                <p className="text-[10px] text-rn-text-muted font-medium">{task.actionsCompleted} actions</p>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${task.status === 'passed' ? 'badge-low' : task.status === 'partial' ? 'badge-medium' : 'badge-high'
                                }`}>
                                {task.status}
                            </span>
                        </div>
                    ))}
                </div>
            </motion.div>

            {/* Strengths + Recommendations */}
            <div className="grid grid-cols-2 gap-5 mb-5">
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }}
                    className="bg-white rounded-xl border border-rn-border p-6 shadow-sm">
                    <h2 className="text-sm font-bold text-rn-dark mb-3 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-rn-success" /> Strengths
                    </h2>
                    <ul className="space-y-2">
                        {report.strengths.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-rn-dark-2 font-medium">
                                <ArrowRight className="w-3.5 h-3.5 text-rn-success shrink-0 mt-0.5" /> {s}
                            </li>
                        ))}
                    </ul>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.35 }}
                    className="bg-white rounded-xl border border-rn-border p-6 shadow-sm">
                    <h2 className="text-sm font-bold text-rn-dark mb-3 flex items-center gap-2">
                        <Lightbulb className="w-4 h-4 text-rn-warning" /> Recommendations
                    </h2>
                    <ul className="space-y-2">
                        {report.recommendations.map((r, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-rn-dark-2 font-medium">
                                <ArrowRight className="w-3.5 h-3.5 text-rn-warning shrink-0 mt-0.5" /> {r}
                            </li>
                        ))}
                    </ul>
                </motion.div>
            </div>

            {/* Timeline Table */}
            {report.timeline.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.4 }}
                    className="bg-white rounded-xl border border-rn-border p-6 mb-5 shadow-sm">
                    <h2 className="text-sm font-bold text-rn-dark mb-4 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-rn-primary" /> Timeline
                    </h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-rn-border">
                                    <th className="text-left py-2 px-3 text-rn-text-muted font-extrabold uppercase tracking-widest text-[10px]">Time</th>
                                    <th className="text-left py-2 px-3 text-rn-text-muted font-extrabold uppercase tracking-widest text-[10px]">Action</th>
                                    <th className="text-left py-2 px-3 text-rn-text-muted font-extrabold uppercase tracking-widest text-[10px]">Target</th>
                                    <th className="text-left py-2 px-3 text-rn-text-muted font-extrabold uppercase tracking-widest text-[10px]">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.timeline.map((entry, i) => (
                                    <tr key={i} className="border-b border-rn-border/50 hover:bg-rn-surface-2 transition-colors">
                                        <td className="py-2 px-3 text-rn-text-muted font-mono">{new Date(entry.timestamp).toLocaleTimeString()}</td>
                                        <td className="py-2 px-3 text-rn-dark font-bold capitalize">{entry.action}</td>
                                        <td className="py-2 px-3 text-rn-text-dim max-w-[200px] truncate font-medium">{entry.target || '—'}</td>
                                        <td className="py-2 px-3">
                                            {entry.success ?
                                                <span className="text-rn-success font-bold">✓ Pass</span> :
                                                <span className="text-rn-danger font-bold">✗ Fail</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </motion.div>
            )}

            {/* Screenshots */}
            {report.screenshots.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.45 }}
                    className="bg-white rounded-xl border border-rn-border p-6 mb-5 shadow-sm">
                    <h2 className="text-sm font-bold text-rn-dark mb-4 flex items-center gap-2">
                        <Camera className="w-4 h-4 text-violet-500" /> Screenshots ({report.screenshots.length})
                    </h2>
                    <div className="grid grid-cols-3 gap-3">
                        {report.screenshots.map((name, i) => (
                            <div key={i} className="group rounded-lg overflow-hidden border border-rn-border hover:border-rn-primary/25 hover:shadow-md transition-all">
                                <img src={`/api/screenshot/${sessionId}/${name}`} alt={name}
                                    className="w-full h-36 object-cover object-top group-hover:scale-105 transition-transform duration-300" />
                                <div className="px-3 py-1.5 bg-rn-surface-2">
                                    <p className="text-[10px] text-rn-text-muted font-mono truncate">{name}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </motion.div>
            )}

            {/* Footer */}
            <div className="text-center pb-8 mt-4">
                <p className="text-xs text-rn-text-muted font-medium">
                    Generated by <span className="font-bold text-rn-primary">Sentra</span> — AI-Powered Website Testing
                </p>
            </div>
        </div>
    );
}

function MiniStat({ label, value, color = 'text-rn-dark' }: { label: string; value: string; color?: string }) {
    return (
        <div className="bg-rn-surface-2 rounded-lg p-2.5 text-center">
            <p className={`text-lg font-black ${color}`}>{value}</p>
            <p className="text-[10px] text-rn-text-muted font-extrabold uppercase tracking-widest">{label}</p>
        </div>
    );
}
