import { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity, AlertTriangle, CheckCircle, XCircle, Camera,
    Cpu, MousePointer, Navigation, Eye, Shield, Clock, Layers, Globe,
    Zap, BarChart3, ChevronDown, ChevronRight, TrendingUp, Lightbulb,
    ArrowRight, Printer, ExternalLink, Download, Copy, Check, Search,
    Filter, X, ZoomIn, Sparkles
} from 'lucide-react';
import TextShimmer from './TextShimmer.tsx';
import AnimatedCircularProgressBar from './AnimatedCircularProgressBar.tsx';
import TypewriterText from './TypewriterText.tsx';
import PegtopLoader from './PegtopLoader.tsx';

interface TestEvent {
    type: string;
    message: string;
    timestamp: number;
    [key: string]: any;
}

interface Issue {
    findingId?: string;
    type: string;
    severity: 'critical' | 'major' | 'minor' | 'suggestion' | string;
    title?: string;
    message?: string;
    description?: string;
    page?: string;
    expected?: string;
    actual?: string;
    businessImpact?: string;
    agentDomain?: string;
    agentId?: string;
    reproductionSteps?: string[];
    recommendation?: string;
    source?: string;
    screenshot?: string;
}

interface AgentContribution {
    id: string;
    name: string;
    role: string;
    model?: string;
    status?: string;
    bugs?: number;
    stepsCompleted?: number;
}

interface Report {
    url: string;
    sessionId: string;
    timestamp: string;
    duration: number;
    durationFormatted: string;
    reliabilityScore: number | null;
    riskLevel: string;
    siteType: string;
    siteName?: string;
    overallStatus?: string;
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
        aiCallsUsed?: number;
        tokensUsed?: number;
    };
    agents?: AgentContribution[];
    tasks: any[];
    timeline: any[];
    issues: Issue[];
    findingsByDomain?: Record<string, Issue[]>;
    issuesSummary: {
        total: number;
        critical?: number;
        major?: number;
        minor?: number;
        suggestion?: number;
        high?: number;
        medium?: number;
        low?: number;
    };
    screenshots: string[];
    screenshotsMeta?: Record<string, {
        name: string;
        agentId: string;
        caption: string;
        url: string;
        title: string;
        timestamp: number;
        hasError?: boolean;
        errorStatus?: string;
        finding?: {
            findingId?: string;
            title?: string;
            severity?: string;
            expected?: string;
            actual?: string;
            page?: string;
            agentDomain?: string;
            description?: string;
            businessImpact?: string;
        } | null;
    }>;
    coverageSummary?: {
        pagesVisited?: string[];
        pagesCount?: number;
        agentsCovered?: number;
        totalAgents?: number;
        coverageNotes?: string;
        limitations?: string[];
    };
}

interface Props {
    events: TestEvent[];
    report: Report | null;
    sessionId: string | null;
}

/* Group events by category */
interface EventGroup {
    label: string;
    icon: any;
    color: string;
    events: TestEvent[];
}

function groupEvents(events: TestEvent[]): EventGroup[] {
    const groups: Record<string, EventGroup> = {};

    const categoryMap: Record<string, { label: string; icon: any; color: string }> = {
        'status': { label: 'System', icon: Cpu, color: 'text-rn-primary' },
        'navigate': { label: 'Navigation', icon: Navigation, color: 'text-blue-500' },
        'screenshot': { label: 'Screenshots', icon: Camera, color: 'text-violet-500' },
        'extraction': { label: 'Extraction', icon: Eye, color: 'text-cyan-600' },
        'ai': { label: 'AI Analysis', icon: Shield, color: 'text-rn-accent' },
        'task-start': { label: 'Tasks', icon: Activity, color: 'text-rn-warning' },
        'task-end': { label: 'Tasks', icon: Activity, color: 'text-rn-warning' },
        'action': { label: 'Actions', icon: MousePointer, color: 'text-rn-primary' },
        'action-fail': { label: 'Failed', icon: XCircle, color: 'text-rn-danger' },
        'task-fail': { label: 'Failed', icon: XCircle, color: 'text-rn-danger' },
        'validation': { label: 'Validation', icon: AlertTriangle, color: 'text-rn-warning' },
        'warning': { label: 'Warnings', icon: AlertTriangle, color: 'text-rn-warning' },
        'error': { label: 'Errors', icon: XCircle, color: 'text-rn-danger' },
        'complete': { label: 'System', icon: CheckCircle, color: 'text-rn-success' },
    };

    for (const event of events) {
        const cat = categoryMap[event.type] || { label: 'Other', icon: Activity, color: 'text-rn-text-dim' };
        if (!groups[cat.label]) {
            groups[cat.label] = { label: cat.label, icon: cat.icon, color: cat.color, events: [] };
        }
        groups[cat.label].events.push(event);
    }

    return Object.values(groups);
}

function getScoreColor(score: number | null | undefined): string {
    if (typeof score !== 'number') return '#94a3b8';
    if (score >= 80) return '#059669';
    if (score >= 60) return '#d97706';
    if (score >= 40) return '#ea580c';
    return '#dc2626';
}

function getRiskBadge(risk: string) {
    const styles: Record<string, string> = {
        low: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        medium: 'bg-amber-50 text-amber-700 border border-amber-200',
        high: 'bg-orange-50 text-orange-700 border border-orange-200',
        critical: 'bg-red-50 text-red-700 border border-red-200',
    };
    return styles[risk] || styles.medium;
}

const DOMAIN_INFO: Record<string, { label: string; icon: any; color: string; bg: string }> = {
    navigation_exploration: { label: 'Navigation & Page Exploration', icon: BarChart3, color: 'text-cyan-600', bg: 'bg-cyan-50 border-cyan-200' },
    ui_controls: { label: 'UI & Interactive Controls', icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
    forms_validation: { label: 'Forms & Input Validation', icon: Shield, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
    core_workflow: { label: 'Core Workflow & E-commerce', icon: Zap, color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200' },
    business_logic: { label: 'Business Logic & Domain Testing', icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
    defect_verification: { label: 'Defect Verification & Evidence', icon: Cpu, color: 'text-rose-600', bg: 'bg-rose-50 border-rose-200' },
    ui_responsiveness: { label: 'Navigation & Page Exploration', icon: BarChart3, color: 'text-cyan-600', bg: 'bg-cyan-50 border-cyan-200' },
    core_user_flow: { label: 'UI & Interactive Controls', icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
    security: { label: 'Forms & Input Validation', icon: Shield, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
    performance: { label: 'Core Workflow & E-commerce', icon: Zap, color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200' },
    edge_case: { label: 'Business Logic & Domain Testing', icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
    functional: { label: 'Defect Verification & Evidence', icon: Cpu, color: 'text-rose-600', bg: 'bg-rose-50 border-rose-200' },
};

function getSeverityBadge(severity: string) {
    const s = severity?.toLowerCase();
    switch (s) {
        case 'critical':
            return 'bg-red-100 text-red-800 border border-red-300 font-black';
        case 'major':
        case 'high':
            return 'bg-orange-100 text-orange-800 border border-orange-300 font-bold';
        case 'minor':
        case 'medium':
            return 'bg-amber-100 text-amber-800 border border-amber-300 font-bold';
        case 'suggestion':
        case 'low':
        default:
            return 'bg-blue-100 text-blue-800 border border-blue-300 font-semibold';
    }
}

export default function ReportView({ events, report, sessionId }: Props) {
    const logRef = useRef<HTMLDivElement>(null);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());
    const [severityFilter, setSeverityFilter] = useState<string>('all');
    const [domainFilter, setDomainFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [activeScreenshot, setActiveScreenshot] = useState<{ src: string; caption: string; agent?: string } | null>(null);
    const [copied, setCopied] = useState<boolean>(false);

    const eventGroups = groupEvents(events);

    // Auto-expand latest active event category
    useEffect(() => {
        if (events.length > 0) {
            const lastEvent = events[events.length - 1];
            const cat = {
                'status': 'System', 'navigate': 'Navigation', 'screenshot': 'Screenshots',
                'extraction': 'Extraction', 'ai': 'AI Analysis', 'task-start': 'Tasks',
                'task-end': 'Tasks', 'action': 'Actions', 'action-fail': 'Failed',
                'task-fail': 'Failed', 'validation': 'Validation', 'warning': 'Warnings',
                'error': 'Errors', 'complete': 'System'
            }[lastEvent.type] || 'Other';
            setExpandedGroups(prev => new Set([...prev, cat]));
        }
    }, [events.length]);

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [events]);

    // Handle Escape key to close screenshot modal
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setActiveScreenshot(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const toggleGroup = (label: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(label)) next.delete(label);
            else next.add(label);
            return next;
        });
    };

    const toggleIssue = (id: string) => {
        setExpandedIssues(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const expandAllIssues = () => {
        if (!report) return;
        const allIds = report.issues.map((issue, idx) => issue.findingId || `issue-${idx}`);
        setExpandedIssues(new Set(allIds));
    };

    const collapseAllIssues = () => {
        setExpandedIssues(new Set());
    };

    // Filtered issues calculation
    const filteredIssues = useMemo(() => {
        if (!report?.issues) return [];
        return report.issues.filter(issue => {
            const sev = (issue.severity || 'minor').toLowerCase();
            const dom = (issue.agentDomain || 'functional').toLowerCase();

            // Severity filter
            if (severityFilter !== 'all') {
                if (severityFilter === 'critical' && sev !== 'critical') return false;
                if (severityFilter === 'major' && sev !== 'major' && sev !== 'high') return false;
                if (severityFilter === 'minor' && sev !== 'minor' && sev !== 'medium') return false;
                if (severityFilter === 'suggestion' && sev !== 'suggestion' && sev !== 'low') return false;
            }

            // Domain filter
            if (domainFilter !== 'all' && dom !== domainFilter.toLowerCase()) {
                return false;
            }

            // Text search
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const title = (issue.title || issue.type || '').toLowerCase();
                const msg = (issue.message || issue.description || '').toLowerCase();
                const page = (issue.page || '').toLowerCase();
                const id = (issue.findingId || '').toLowerCase();
                return title.includes(q) || msg.includes(q) || page.includes(q) || id.includes(q);
            }

            return true;
        });
    }, [report?.issues, severityFilter, domainFilter, searchQuery]);

    // Download JSON report
    const handleDownloadJSON = () => {
        if (!report) return;
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(report, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute('href', dataStr);
        downloadAnchor.setAttribute('download', `sentra-report-${report.sessionId || Date.now()}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    };

    // Copy Markdown summary
    const handleCopyMarkdown = () => {
        if (!report) return;
        const lines = [
            `# Sentra QA Report — ${report.siteName || report.url}`,
            `**Target URL:** ${report.url}`,
            `**Reliability Score:** ${report.reliabilityScore}/100 (${report.riskLevel.toUpperCase()} RISK)`,
            `**Overall Status:** ${report.overallStatus?.toUpperCase() || 'COMPLETED'}`,
            `**Duration:** ${report.durationFormatted}`,
            `**Date:** ${new Date(report.timestamp).toLocaleString()}`,
            `**Team:** ZYPHER (Tarun Kumar, Team Lead)`,
            '',
            '## Executive Summary',
            report.summary,
            '',
            `## Issues Detected (${report.issuesSummary?.total || report.issues.length})`,
            `- **Critical:** ${report.issuesSummary?.critical || 0}`,
            `- **Major:** ${report.issuesSummary?.major || report.issuesSummary?.high || 0}`,
            `- **Minor:** ${report.issuesSummary?.minor || report.issuesSummary?.medium || 0}`,
            `- **Suggestions:** ${report.issuesSummary?.suggestion || report.issuesSummary?.low || 0}`,
            '',
            '### Findings Breakdown',
        ];

        report.issues.forEach((iss, i) => {
            lines.push(`#### ${i + 1}. [${(iss.severity || 'minor').toUpperCase()}] ${iss.title || iss.type}`);
            lines.push(`- **ID:** \`${iss.findingId || `SENTRA-${i + 1}`}\``);
            lines.push(`- **Location:** ${iss.page || report.url}`);
            lines.push(`- **Domain:** ${iss.agentDomain || 'General'}`);
            if (iss.expected) lines.push(`- **Expected:** ${iss.expected}`);
            if (iss.actual) lines.push(`- **Actual:** ${iss.actual}`);
            if (iss.businessImpact) lines.push(`- **Business Impact:** ${iss.businessImpact}`);
            if (iss.reproductionSteps && iss.reproductionSteps.length > 0) {
                lines.push(`- **Reproduction Steps:**`);
                iss.reproductionSteps.forEach((s, idx) => lines.push(`  ${idx + 1}. ${s}`));
            }
            if (iss.recommendation) lines.push(`- **Recommendation:** ${iss.recommendation}`);
            lines.push('');
        });

        if (report.strengths && report.strengths.length > 0) {
            lines.push('## Strengths');
            report.strengths.forEach(s => lines.push(`- ${s}`));
            lines.push('');
        }

        if (report.recommendations && report.recommendations.length > 0) {
            lines.push('## Priority Recommendations');
            report.recommendations.forEach(r => lines.push(`- ${r}`));
            lines.push('');
        }

        lines.push('---');
        lines.push('*Generated by SENTRA Autonomous AI QA Engine — Team ZYPHER*');

        navigator.clipboard.writeText(lines.join('\n'));
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    const taskStarts = events.filter(e => e.type === 'task-start');
    const taskEnds = events.filter(e => e.type === 'task-end');
    const actions = events.filter(e => e.type === 'action' || e.type === 'action-fail');
    const screenshots = events.filter(e => e.type === 'screenshot');
    const liveIssues = events.filter(e => e.type === 'validation' || e.type === 'action-fail' || e.type === 'warning' || e.type === 'worker-issue');
    const currentTask = taskStarts[taskStarts.length - 1];
    const progress = report
        ? 100
        : taskStarts.length > 0 ? Math.round((taskEnds.length / Math.max(taskStarts.length, 5)) * 100) : 0;

    return (
        <div className="h-full flex flex-col overflow-auto bg-transparent">
            {/* Screenshot Modal Lightbox */}
            <AnimatePresence>
                {activeScreenshot && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setActiveScreenshot(null)}
                        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-white rounded-2xl max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col border border-white/20"
                        >
                            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50/80">
                                <div className="flex items-center gap-2">
                                    <Camera className="w-4 h-4 text-violet-600" />
                                    <span className="text-xs font-bold text-gray-800">{activeScreenshot.caption}</span>
                                    {activeScreenshot.agent && (
                                        <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-violet-100 text-violet-700">
                                            {activeScreenshot.agent}
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => setActiveScreenshot(null)}
                                    className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-200 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="overflow-auto max-h-[75vh] p-2 flex items-center justify-center bg-gray-950">
                                <img
                                    src={activeScreenshot.src}
                                    alt={activeScreenshot.caption}
                                    className="max-w-full max-h-[72vh] object-contain rounded shadow"
                                />
                            </div>
                            <div className="px-5 py-2.5 bg-gray-50 text-[11px] text-gray-500 font-medium flex items-center justify-between border-t border-gray-200">
                                <span>Evidence Capture</span>
                                <span>Click anywhere outside or press ESC to close</span>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="flex-1 flex flex-col overflow-auto p-4 md:p-6 max-w-7xl mx-auto w-full">

                {/* ===== LIVE TESTING VIEW (BEFORE REPORT GENERATION) ===== */}
                {!report && (
                    <div className="space-y-4">
                        {/* Top Row: Progress + Stats */}
                        <div className="grid grid-cols-12 gap-4">
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="col-span-12 md:col-span-3 bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 p-5 flex flex-col items-center justify-center shadow-sm"
                            >
                                <AnimatedCircularProgressBar
                                    value={progress}
                                    gaugePrimaryColor="rgb(124, 58, 237)"
                                    gaugeSecondaryColor="rgba(124, 58, 237, 0.1)"
                                />
                                <span className="text-[10px] font-extrabold text-rn-text-muted uppercase tracking-widest mt-2">Test Progress</span>
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.05 }}
                                className="col-span-12 md:col-span-9 bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 p-5 shadow-sm"
                            >
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 h-full items-center">
                                    <StatCard label="Tasks" value={`${taskEnds.length}/${taskStarts.length || '?'}`} icon={Layers} color="text-rn-primary" />
                                    <StatCard label="Actions" value={actions.length.toString()} icon={MousePointer} color="text-blue-500" />
                                    <StatCard label="Screenshots" value={screenshots.length.toString()} icon={Camera} color="text-violet-500" />
                                    <StatCard
                                        label="Findings"
                                        value={liveIssues.length.toString()}
                                        icon={AlertTriangle}
                                        color={liveIssues.length > 0 ? 'text-amber-500' : 'text-emerald-500'}
                                    />
                                </div>
                            </motion.div>
                        </div>

                        {/* Current Running Task */}
                        {currentTask && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="rounded-2xl p-4 border-2 border-rn-primary/20 bg-white/70 backdrop-blur-xl flex items-center gap-3.5 shadow-sm"
                            >
                                <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-md shadow-rn-primary/20 shrink-0">
                                    <Zap className="w-5 h-5 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="text-[10px] font-extrabold text-rn-primary uppercase tracking-widest">Active Scenario</span>
                                    </div>
                                    <p className="text-sm font-bold text-rn-dark truncate">{currentTask.taskName || currentTask.message}</p>
                                </div>
                            </motion.div>
                        )}

                        {/* Task Breakdown & Pages Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                                className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 p-4 shadow-sm"
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <Layers className="w-4 h-4 text-rn-primary" />
                                    <span className="text-[11px] font-black text-rn-dark uppercase tracking-wider">Scenarios Queue</span>
                                </div>
                                <div className="space-y-1.5 max-h-56 overflow-auto pr-1">
                                    {taskStarts.length === 0 && (
                                        <p className="text-xs text-rn-text-muted italic py-6 text-center">Awaiting agent assignments from orchestrator...</p>
                                    )}
                                    {taskStarts.map((ts, i) => {
                                        const ended = taskEnds.find(te => te.taskId === ts.taskId);
                                        return (
                                            <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-rn-surface-2 border border-rn-border/50">
                                                <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                                                    ended ? ended.status === 'passed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700' : 'bg-rn-primary/10 text-rn-primary'
                                                }`}>
                                                    {ended ? (
                                                        ended.status === 'passed' ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />
                                                    ) : (
                                                        <div className="w-2 h-2 rounded-full bg-rn-primary animate-pulse" />
                                                    )}
                                                </div>
                                                <span className="text-xs font-semibold text-rn-dark truncate">{ts.taskName || ts.message}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.15 }}
                                className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 p-4 shadow-sm"
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <Globe className="w-4 h-4 text-blue-500" />
                                    <span className="text-[11px] font-black text-rn-dark uppercase tracking-wider">Discovered Pages</span>
                                </div>
                                <div className="space-y-1.5 max-h-56 overflow-auto pr-1">
                                    {events.filter(e => e.type === 'navigate').length === 0 && (
                                        <p className="text-xs text-rn-text-muted italic py-6 text-center">Navigating target domain...</p>
                                    )}
                                    {events.filter(e => e.type === 'navigate').map((nav, i) => (
                                        <div key={i} className="text-xs text-rn-dark font-mono bg-rn-surface-2 px-3 py-1.5 rounded-lg border border-rn-border/50 truncate flex items-center gap-2">
                                            <span className="text-[10px] text-blue-500 font-bold shrink-0">PAGE {i + 1}</span>
                                            <span className="truncate">{nav.message}</span>
                                        </div>
                                    ))}
                                </div>
                            </motion.div>
                        </div>

                        {events.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-20 text-center">
                                <div className="mb-4" style={{ width: 80, height: 80 }}>
                                    <PegtopLoader size={80} />
                                </div>
                                <TextShimmer className="text-lg font-bold text-rn-dark" duration={1.5}>
                                    Launching browser & discovery agent...
                                </TextShimmer>
                                <p className="text-rn-text-muted text-xs font-medium mt-1">Connecting to target website and orchestrating parallel test agents</p>
                            </div>
                        )}
                    </div>
                )}

                {/* ===== FINAL CONSOLIDATED QA REPORT ===== */}
                {report && (
                    <div className="print-container space-y-6" id="print-report">

                        {/* Top Header & Export Toolbar */}
                        <motion.div
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex flex-wrap items-center justify-between gap-4 p-5 bg-white/70 backdrop-blur-xl rounded-2xl border border-white/60 shadow-sm"
                        >
                            <div className="flex items-center gap-3.5">
                                <div className="w-11 h-11 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-rn-primary/25">
                                    <Shield className="w-6 h-6 text-white" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h1 className="text-xl font-black text-rn-dark tracking-tight">Sentra Consolidated QA Report</h1>
                                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Team ZYPHER</span>
                                    </div>
                                    <p className="text-xs text-rn-text-muted font-medium mt-0.5">
                                        Session: <span className="font-mono text-rn-dark">{report.sessionId}</span> · Generated on {new Date(report.timestamp).toLocaleString()}
                                    </p>
                                </div>
                            </div>

                            {/* Export Actions */}
                            <div className="flex items-center gap-2 no-print">
                                <button
                                    onClick={handleCopyMarkdown}
                                    className="h-9 px-3.5 text-xs font-bold rounded-xl bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 shadow-sm transition-all flex items-center gap-1.5"
                                    title="Copy Markdown report"
                                >
                                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-gray-500" />}
                                    <span>{copied ? 'Copied!' : 'Copy Markdown'}</span>
                                </button>
                                <button
                                    onClick={handleDownloadJSON}
                                    className="h-9 px-3.5 text-xs font-bold rounded-xl bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 shadow-sm transition-all flex items-center gap-1.5"
                                    title="Download JSON report"
                                >
                                    <Download className="w-4 h-4 text-gray-500" />
                                    <span>Download JSON</span>
                                </button>
                                <button
                                    onClick={() => window.print()}
                                    className="h-9 px-4 text-xs font-bold rounded-xl gradient-primary text-white shadow-md shadow-rn-primary/20 hover:shadow-lg hover:shadow-rn-primary/30 transition-all flex items-center gap-1.5"
                                >
                                    <Printer className="w-4 h-4" />
                                    <span>Print / PDF</span>
                                </button>
                            </div>
                        </motion.div>

                        {/* Target Website Metadata Card */}
                        <motion.div
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.05 }}
                            className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 p-5 shadow-sm"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                <div className="flex items-center gap-2.5">
                                    <Globe className="w-5 h-5 text-rn-primary" />
                                    <a
                                        href={report.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-base font-bold text-rn-primary hover:underline flex items-center gap-1.5"
                                    >
                                        {report.siteName || report.url} <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs px-3 py-1 rounded-lg bg-gray-100 font-bold text-gray-700 capitalize">
                                        Type: {report.siteType}
                                    </span>
                                    <span className={`text-xs px-3 py-1 rounded-lg font-black uppercase ${getRiskBadge(report.riskLevel)}`}>
                                        {report.riskLevel} Risk
                                    </span>
                                    <span className={`text-xs px-3 py-1 rounded-lg font-black uppercase ${
                                        report.overallStatus === 'pass' ? 'bg-emerald-100 text-emerald-800' :
                                        report.overallStatus === 'fail' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                                    }`}>
                                        Status: {report.overallStatus || 'Completed'}
                                    </span>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-6 text-xs text-rn-text-muted font-medium pt-2 border-t border-gray-100">
                                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-gray-400" /> Duration: <strong className="text-rn-dark">{report.durationFormatted}</strong></span>
                                <span className="flex items-center gap-1.5"><Layers className="w-4 h-4 text-gray-400" /> Pages Mapped: <strong className="text-rn-dark">{report.execution?.pagesVisited?.length || 1}</strong></span>
                                <span className="flex items-center gap-1.5"><Cpu className="w-4 h-4 text-gray-400" /> AI Engine: <strong className="text-rn-dark">Google Gemini 3.5 Flash</strong></span>
                                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-gray-400" /> Parallel Agents: <strong className="text-rn-dark">6 Specialized QA Roles</strong></span>
                            </div>
                        </motion.div>

                        {/* Executive Summary & Circular Score Gauge */}
                        <div className="grid grid-cols-12 gap-5">
                            {/* Score Ring */}
                            <motion.div
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                                className="col-span-12 md:col-span-4 bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 p-6 flex flex-col items-center justify-center shadow-sm text-center"
                            >
                                <svg width="130" height="130" viewBox="0 0 100 100" className="score-ring mb-3">
                                    <circle cx="50" cy="50" r="45" className="score-ring-bg" />
                                    {typeof report.reliabilityScore === 'number' ? (
                                        <>
                                            <circle
                                                cx="50"
                                                cy="50"
                                                r="45"
                                                className="score-ring-fill"
                                                stroke={getScoreColor(report.reliabilityScore)}
                                                style={{ '--score-offset': 283 - (283 * report.reliabilityScore / 100) } as any}
                                            />
                                            <text
                                                x="50"
                                                y="46"
                                                textAnchor="middle"
                                                dominantBaseline="central"
                                                fill={getScoreColor(report.reliabilityScore)}
                                                style={{ fontSize: '26px', fontWeight: 900 }}
                                            >
                                                {report.reliabilityScore}
                                            </text>
                                            <text
                                                x="50"
                                                y="66"
                                                textAnchor="middle"
                                                dominantBaseline="central"
                                                fill="#71717a"
                                                style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' }}
                                            >
                                                / 100
                                            </text>
                                        </>
                                    ) : (
                                        <>
                                            <circle
                                                cx="50"
                                                cy="50"
                                                r="45"
                                                stroke="#cbd5e1"
                                                strokeWidth="7"
                                                fill="transparent"
                                                strokeDasharray="4 4"
                                            />
                                            <text
                                                x="50"
                                                y="50"
                                                textAnchor="middle"
                                                dominantBaseline="central"
                                                fill="#64748b"
                                                style={{ fontSize: '18px', fontWeight: 900 }}
                                            >
                                                N/A
                                            </text>
                                        </>
                                    )}
                                </svg>
                                <p className="text-xs font-black text-rn-dark uppercase tracking-wider">
                                    {typeof report.reliabilityScore === 'number' ? 'Reliability Score' : 'Score Pending'}
                                </p>
                                <p className="text-[11px] text-rn-text-muted mt-0.5">
                                    {typeof report.reliabilityScore === 'number'
                                        ? 'Calculated from verified actions and confirmed defects'
                                        : 'Not enough evidence to calculate score'}
                                </p>
                            </motion.div>

                            {/* Executive Summary & Stat Tiles */}
                            <motion.div
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.15 }}
                                className="col-span-12 md:col-span-8 bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 p-6 shadow-sm flex flex-col justify-between"
                            >
                                <div>
                                    <h3 className="text-sm font-black text-rn-dark mb-2 flex items-center gap-2">
                                        <TrendingUp className="w-4 h-4 text-rn-primary" /> Executive Assessment
                                    </h3>
                                    <p className="text-xs text-rn-dark leading-relaxed font-medium mb-4">
                                        {report.summary}
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-gray-100">
                                    <MiniStat label="Scenarios" value={`${report.execution?.tasksCompleted ?? 0}/${report.execution?.totalTasks ?? 6}`} />
                                    <MiniStat label="Actions" value={String(report.execution?.totalActions ?? 0)} />
                                    <MiniStat label="Passed" value={String(report.execution?.successfulActions ?? 0)} color="text-emerald-600" />
                                    <MiniStat label="Findings" value={String(report.issuesSummary?.total ?? report.issues.length)} color={(report.issuesSummary?.total ?? 0) > 0 ? 'text-red-600' : 'text-emerald-600'} />
                                </div>
                            </motion.div>
                        </div>

                        {/* Detailed Findings Section with Interactive Filters */}
                        <motion.div
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 p-6 shadow-sm"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                                <div>
                                    <h2 className="text-base font-black text-rn-dark flex items-center gap-2">
                                        <AlertTriangle className="w-5 h-5 text-amber-500" />
                                        <span>Consolidated Findings ({report.issuesSummary?.total || report.issues.length})</span>
                                    </h2>
                                    <p className="text-xs text-rn-text-muted mt-0.5">
                                        Normalized, deduplicated defects categorized by severity and testing domain
                                    </p>
                                </div>

                                <div className="flex items-center gap-2 no-print">
                                    <button
                                        onClick={expandAllIssues}
                                        className="text-xs font-bold text-rn-primary hover:underline px-2 py-1 rounded hover:bg-rn-primary/5 transition-all"
                                    >
                                        Expand All
                                    </button>
                                    <span className="text-gray-300">|</span>
                                    <button
                                        onClick={collapseAllIssues}
                                        className="text-xs font-bold text-rn-text-muted hover:text-rn-dark px-2 py-1 rounded hover:bg-gray-100 transition-all"
                                    >
                                        Collapse All
                                    </button>
                                </div>
                            </div>

                            {/* Severity Filter Pills */}
                            <div className="flex flex-wrap items-center gap-2 mb-3 no-print">
                                <span className="text-[11px] font-bold text-gray-500 mr-1 flex items-center gap-1">
                                    <Filter className="w-3.5 h-3.5" /> Severity:
                                </span>
                                {[
                                    { id: 'all', label: 'All Severities', count: report.issues.length },
                                    { id: 'critical', label: 'Critical', count: report.issues.filter(i => (i.severity || '').toLowerCase() === 'critical').length, color: 'text-red-700 bg-red-50 border-red-200' },
                                    { id: 'major', label: 'Major', count: report.issues.filter(i => ['major', 'high'].includes((i.severity || '').toLowerCase())).length, color: 'text-orange-700 bg-orange-50 border-orange-200' },
                                    { id: 'minor', label: 'Minor', count: report.issues.filter(i => ['minor', 'medium'].includes((i.severity || '').toLowerCase())).length, color: 'text-amber-700 bg-amber-50 border-amber-200' },
                                    { id: 'suggestion', label: 'Suggestion', count: report.issues.filter(i => ['suggestion', 'low'].includes((i.severity || '').toLowerCase())).length, color: 'text-blue-700 bg-blue-50 border-blue-200' },
                                ].map(btn => (
                                    <button
                                        key={btn.id}
                                        onClick={() => setSeverityFilter(btn.id)}
                                        className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
                                            severityFilter === btn.id
                                                ? 'gradient-primary text-white border-transparent shadow-sm'
                                                : 'bg-white/80 border-gray-200 text-gray-700 hover:bg-white'
                                        }`}
                                    >
                                        <span>{btn.label}</span>
                                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${severityFilter === btn.id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-700'}`}>
                                            {btn.count}
                                        </span>
                                    </button>
                                ))}
                            </div>

                            {/* Domain Filter Pills */}
                            <div className="flex flex-wrap items-center gap-2 mb-4 no-print">
                                <span className="text-[11px] font-bold text-gray-500 mr-1 flex items-center gap-1">
                                    <Layers className="w-3.5 h-3.5" /> Domain:
                                </span>
                                <button
                                    onClick={() => setDomainFilter('all')}
                                    className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${
                                        domainFilter === 'all'
                                            ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                                            : 'bg-white/80 border-gray-200 text-gray-700 hover:bg-white'
                                    }`}
                                >
                                    All Domains ({report.issues.length})
                                </button>
                                {Object.entries(DOMAIN_INFO).map(([key, info]) => {
                                    const count = report.issues.filter(i => (i.agentDomain || '').toLowerCase() === key).length;
                                    const Icon = info.icon;
                                    return (
                                        <button
                                            key={key}
                                            onClick={() => setDomainFilter(key)}
                                            className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
                                                domainFilter === key
                                                    ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                                                    : 'bg-white/80 border-gray-200 text-gray-700 hover:bg-white'
                                            }`}
                                        >
                                            <Icon className={`w-3.5 h-3.5 ${domainFilter === key ? 'text-white' : info.color}`} />
                                            <span>{info.label.split('&')[0].trim()}</span>
                                            <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${domainFilter === key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-700'}`}>
                                                {count}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Search Filter Box */}
                            <div className="mb-4 no-print">
                                <div className="relative">
                                    <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search findings by title, description, or URL..."
                                        className="w-full h-10 pl-10 pr-4 text-xs font-medium bg-white/80 border border-gray-200 rounded-xl focus:outline-none focus:border-rn-primary focus:ring-2 focus:ring-rn-primary/10 transition-all"
                                    />
                                    {searchQuery && (
                                        <button
                                            onClick={() => setSearchQuery('')}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Findings List */}
                            {filteredIssues.length === 0 ? (
                                <div className="flex flex-col items-center justify-center p-8 rounded-xl bg-emerald-50/50 border border-emerald-200 text-center">
                                    <CheckCircle className="w-8 h-8 text-emerald-600 mb-2" />
                                    <p className="text-sm font-bold text-emerald-900">No issues matching the selected filters</p>
                                    <p className="text-xs text-emerald-700 mt-0.5">
                                        {report.issues.length === 0 ? 'All agent checks passed cleanly without defects!' : 'Try selecting "All Severities" or clearing your search.'}
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {filteredIssues.map((issue, i) => {
                                        const issueId = issue.findingId || `issue-${i}`;
                                        const isExpanded = expandedIssues.has(issueId);
                                        const domain = DOMAIN_INFO[issue.agentDomain || ''] || DOMAIN_INFO.functional;
                                        const DomainIcon = domain.icon;

                                        return (
                                            <div
                                                key={issueId}
                                                className="rounded-2xl border border-gray-200 bg-white/90 shadow-sm hover:border-rn-primary/30 transition-all overflow-hidden"
                                            >
                                                {/* Issue Clickable Header */}
                                                <div
                                                    onClick={() => toggleIssue(issueId)}
                                                    className="p-4 flex items-start gap-3.5 cursor-pointer hover:bg-gray-50/60 transition-colors select-none"
                                                >
                                                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider shrink-0 mt-0.5 ${getSeverityBadge(issue.severity)}`}>
                                                        {issue.severity}
                                                    </span>

                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                                            {issue.findingId && (
                                                                <span className="text-[10px] font-mono font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                                                                    {issue.findingId}
                                                                </span>
                                                            )}
                                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${domain.bg} ${domain.color}`}>
                                                                <DomainIcon className="w-3 h-3" />
                                                                {domain.label}
                                                            </span>
                                                            {issue.page && (
                                                                <span className="text-[10px] font-mono text-gray-400 truncate max-w-xs">
                                                                    {issue.page}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <h3 className="text-sm font-bold text-rn-dark leading-snug">
                                                            {issue.title || issue.type}
                                                        </h3>
                                                        <p className="text-xs text-rn-text-dim font-medium mt-1 line-clamp-2">
                                                            {issue.message || issue.description}
                                                        </p>
                                                    </div>

                                                    <div className="text-gray-400 hover:text-gray-600 shrink-0 mt-1">
                                                        {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                                                    </div>
                                                </div>

                                                {/* Expanded Issue Details */}
                                                <AnimatePresence>
                                                    {isExpanded && (
                                                        <motion.div
                                                            initial={{ opacity: 0, height: 0 }}
                                                            animate={{ opacity: 1, height: 'auto' }}
                                                            exit={{ opacity: 0, height: 0 }}
                                                            className="border-t border-gray-100 p-4 space-y-3 bg-gray-50/40 text-xs"
                                                        >
                                                            {/* Expected vs Actual Containers */}
                                                            {(issue.expected || issue.actual) && (
                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                    {issue.expected && (
                                                                        <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                                                                            <p className="text-[10px] font-black text-emerald-800 uppercase tracking-wider mb-1 flex items-center gap-1">
                                                                                <CheckCircle className="w-3 h-3" /> Expected Behavior
                                                                            </p>
                                                                            <p className="text-emerald-950 font-medium leading-relaxed">{issue.expected}</p>
                                                                        </div>
                                                                    )}
                                                                    {issue.actual && (
                                                                        <div className="p-3 rounded-xl bg-red-50/70 border border-red-200">
                                                                            <p className="text-[10px] font-black text-red-800 uppercase tracking-wider mb-1 flex items-center gap-1">
                                                                                <XCircle className="w-3 h-3" /> Observed Behavior
                                                                            </p>
                                                                            <p className="text-red-950 font-medium leading-relaxed">{issue.actual}</p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {/* Business Impact Box */}
                                                            {issue.businessImpact && (
                                                                <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200">
                                                                    <p className="text-[10px] font-black text-amber-800 uppercase tracking-wider mb-1 flex items-center gap-1">
                                                                        <TrendingUp className="w-3 h-3" /> Business & User Impact
                                                                    </p>
                                                                    <p className="text-amber-950 font-medium leading-relaxed">{issue.businessImpact}</p>
                                                                </div>
                                                            )}

                                                            {/* Step-by-Step Reproduction Steps */}
                                                            {issue.reproductionSteps && issue.reproductionSteps.length > 0 && (
                                                                <div className="p-3 rounded-xl bg-white border border-gray-200">
                                                                    <p className="text-[10px] font-black text-gray-700 uppercase tracking-wider mb-2">
                                                                        Step-by-Step Reproduction Instructions
                                                                    </p>
                                                                    <ol className="space-y-1.5 pl-1">
                                                                        {issue.reproductionSteps.map((step, si) => (
                                                                            <li key={si} className="text-xs text-gray-700 flex items-start gap-2">
                                                                                <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                                                                                    {si + 1}
                                                                                </span>
                                                                                <span className="leading-snug">{step}</span>
                                                                            </li>
                                                                        ))}
                                                                    </ol>
                                                                </div>
                                                            )}

                                                            {/* Screenshot Thumbnail (if attached to this bug) */}
                                                            {issue.screenshot && sessionId && (
                                                                <div className="p-3 rounded-xl bg-white border border-gray-200">
                                                                    <p className="text-[10px] font-black text-gray-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                                                                        <Camera className="w-3.5 h-3.5 text-violet-600" /> Evidence Capture
                                                                    </p>
                                                                    <div
                                                                        onClick={() => setActiveScreenshot({
                                                                            src: `/api/screenshot/${sessionId}/${issue.screenshot}`,
                                                                            caption: issue.title || issue.type,
                                                                            agent: domain.label
                                                                        })}
                                                                        className="relative group cursor-pointer max-w-md rounded-xl overflow-hidden border border-gray-200 hover:border-rn-primary/40 transition-all shadow-sm"
                                                                    >
                                                                        <img
                                                                            src={`/api/screenshot/${sessionId}/${issue.screenshot}`}
                                                                            alt={issue.title || 'Bug evidence'}
                                                                            className="w-full h-44 object-cover object-top group-hover:scale-105 transition-transform duration-300"
                                                                        />
                                                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1.5">
                                                                            <ZoomIn className="w-4 h-4" /> Click to Zoom Full Image
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Actionable Recommendation */}
                                                            {issue.recommendation && (
                                                                <div className="p-3 rounded-xl bg-violet-50/70 border border-violet-200">
                                                                    <p className="text-[10px] font-black text-violet-800 uppercase tracking-wider mb-1 flex items-center gap-1">
                                                                        <Lightbulb className="w-3 h-3 text-violet-700" /> Recommended Remediation
                                                                    </p>
                                                                    <p className="text-violet-950 font-medium leading-relaxed">{issue.recommendation}</p>
                                                                </div>
                                                            )}
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </motion.div>

                        {/* Evidence Screenshots Section (All Agent Captures) */}
                        {report.screenshots && report.screenshots.length > 0 && sessionId && (
                            <motion.div
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.25 }}
                                className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 p-6 shadow-sm"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <h2 className="text-base font-black text-rn-dark flex items-center gap-2">
                                            <Camera className="w-5 h-5 text-violet-600" />
                                            <span>Visual Evidence Gallery ({report.screenshots.length})</span>
                                        </h2>
                                        <p className="text-xs text-rn-text-muted mt-0.5">
                                            Captured in-situ across browser execution contexts
                                        </p>
                                    </div>
                                    <span className="text-xs font-bold text-gray-500">Click any image to expand</span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                    {report.screenshots.map((filename, idx) => {
                                        const meta = report.screenshotsMeta?.[filename];
                                        const cleanName = filename.replace(/\.[^.]+$/, '').replace(/_\d+$/, '');
                                        const parts = cleanName.split('_');
                                        const agentId = meta?.agentId?.toUpperCase() || parts[0]?.toUpperCase() || '?';
                                        const caption = meta?.caption || meta?.title || (parts.slice(1).join(' ') || 'Evidence Capture');
                                        const pageUrl = meta?.url || '';
                                        const ts = meta?.timestamp ? new Date(meta.timestamp).toLocaleTimeString() : '';

                                        // Robust finding association: check meta, filename match, URL match, or title match
                                        const matchedIssue = meta?.finding ||
                                            report.issues?.find(iss => iss.screenshot === filename);

                                        const hasError = meta?.hasError === true || (meta?.hasError !== false && (Boolean(matchedIssue) || Boolean(meta?.finding) || /bug|error|doubling|mismatch|broken|404|fail|issue|defect/i.test(caption)));
                                        const finding = meta?.finding || (matchedIssue ? {
                                            findingId: matchedIssue.findingId,
                                            title: matchedIssue.title,
                                            severity: matchedIssue.severity,
                                            expected: matchedIssue.expected,
                                            actual: matchedIssue.actual,
                                            description: matchedIssue.message,
                                        } : null);

                                        const sevColor = (sev: string | undefined) => {
                                            const s = (sev || '').toLowerCase();
                                            if (s === 'critical') return 'bg-red-100 text-red-800 border-red-300';
                                            if (s === 'major' || s === 'high') return 'bg-orange-100 text-orange-800 border-orange-300';
                                            if (s === 'minor' || s === 'medium') return 'bg-amber-100 text-amber-800 border-amber-300';
                                            return 'bg-blue-50 text-blue-700 border-blue-200';
                                        };

                                        return (
                                            <div
                                                key={idx}
                                                className={`group rounded-xl overflow-hidden border bg-white shadow-sm transition-all flex flex-col ${hasError ? 'border-red-200 hover:border-red-400' : 'border-gray-200 hover:border-rn-primary/40'} hover:shadow-lg`}
                                            >
                                                {/* Screenshot image */}
                                                <div
                                                    onClick={() => setActiveScreenshot({
                                                        src: `/api/screenshot/${sessionId}/${filename}`,
                                                        caption: pageUrl || caption,
                                                        agent: `Agent ${agentId}`
                                                    })}
                                                    className="relative overflow-hidden bg-gray-900 aspect-video cursor-pointer"
                                                >
                                                    <img
                                                        src={`/api/screenshot/${sessionId}/${filename}`}
                                                        alt={caption}
                                                        onError={(e) => {
                                                            e.currentTarget.style.display = 'none';
                                                            const parent = e.currentTarget.parentElement;
                                                            if (parent && !parent.querySelector('.img-fallback')) {
                                                                const fallback = document.createElement('div');
                                                                fallback.className = 'img-fallback absolute inset-0 flex flex-col items-center justify-center p-3 text-center bg-gray-900 text-gray-400 text-xs';
                                                                fallback.innerHTML = '<span class="font-bold text-gray-300">Evidence Checkpoint</span><span class="text-[10px] text-gray-500 mt-1 truncate max-w-full">' + (pageUrl || caption) + '</span>';
                                                                parent.appendChild(fallback);
                                                            }
                                                        }}
                                                        className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
                                                    />
                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1.5">
                                                        <ZoomIn className="w-4 h-4" /> Full Size
                                                    </div>
                                                    {/* Error badge on image */}
                                                    {hasError ? (
                                                        <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-600/90 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide">
                                                            <AlertTriangle className="w-2.5 h-2.5" /> Error Detected
                                                        </div>
                                                    ) : (
                                                        <div className="absolute top-2 left-2 flex items-center gap-1 bg-emerald-600/90 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide">
                                                            <CheckCircle className="w-2.5 h-2.5" /> No Errors
                                                        </div>
                                                    )}
                                                    {ts && (
                                                        <span className="absolute bottom-1 right-1 text-[9px] bg-black/60 text-white px-1.5 py-0.5 rounded font-mono">
                                                            {ts}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Card metadata */}
                                                <div className="p-3 border-t border-gray-100 flex-1 flex flex-col gap-2">
                                                    {/* Agent + URL */}
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-violet-100 text-violet-700">
                                                            Agent {agentId}
                                                        </span>
                                                        {pageUrl && (
                                                            <span className="text-[10px] text-blue-500 font-mono truncate max-w-[150px]" title={pageUrl}>
                                                                {pageUrl.replace(/^https?:\/\//, '').substring(0, 45)}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Action / checkpoint label */}
                                                    <p className="text-[11px] font-bold text-gray-800 capitalize leading-snug">{caption}</p>

                                                    {/* Error status line */}
                                                    {hasError && (finding || meta?.errorStatus) ? (
                                                        <div className={`mt-1 rounded-lg border p-2.5 ${sevColor(finding?.severity)}`}>
                                                            <div className="flex items-start gap-1.5 mb-1.5">
                                                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                                                <span className="text-[10px] font-black uppercase tracking-wide">
                                                                    {finding?.severity ? `${finding.severity}: ` : ''}{finding?.title || meta?.errorStatus || 'Defect Detected'}
                                                                </span>
                                                            </div>
                                                            {finding?.actual && (
                                                                <p className="text-[10px] leading-snug mb-0.5">
                                                                    <span className="font-bold">Error:</span> {finding.actual}
                                                                </p>
                                                            )}
                                                            {finding?.expected && (
                                                                <p className="text-[10px] leading-snug mb-0.5">
                                                                    <span className="font-bold">Expected:</span> {finding.expected}
                                                                </p>
                                                            )}
                                                            {finding?.description && finding.description !== finding.actual && (
                                                                <p className="text-[10px] leading-snug text-opacity-80 mt-1 border-t border-current/20 pt-1">
                                                                    {finding.description}
                                                                </p>
                                                            )}
                                                            {finding?.findingId && (
                                                                <p className="text-[9px] font-mono opacity-60 mt-1">ID: {finding.findingId}</p>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 font-bold">
                                                            <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                                                            No Errors
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                            </motion.div>
                        )}

                        {/* Agent Contributions Table */}
                        {report.agents && report.agents.length > 0 && (
                            <motion.div
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                                className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 p-6 shadow-sm"
                            >
                                <div className="mb-4">
                                    <h2 className="text-base font-black text-rn-dark flex items-center gap-2">
                                        <Cpu className="w-5 h-5 text-rn-primary" />
                                        <span>Agent Execution Matrix</span>
                                    </h2>
                                    <p className="text-xs text-rn-text-muted mt-0.5">
                                        Performance metrics for the 6 specialized AI testing roles
                                    </p>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-gray-200 text-left text-gray-500 font-black uppercase text-[10px] tracking-wider">
                                                <th className="pb-3 pl-2">Agent</th>
                                                <th className="pb-3">Domain Responsibility</th>
                                                <th className="pb-3 text-center">Model</th>
                                                <th className="pb-3 text-center">Actions</th>
                                                <th className="pb-3 text-center">Defects Found</th>
                                                <th className="pb-3 text-center pr-2">Outcome</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 font-medium text-gray-800">
                                            {report.agents.map((ag) => (
                                                <tr key={ag.id} className="hover:bg-gray-50/80 transition-colors">
                                                    <td className="py-3 pl-2 font-bold text-rn-dark flex items-center gap-2">
                                                        <span className="w-6 h-6 rounded-lg bg-gray-100 text-gray-700 font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                                                            {ag.id}
                                                        </span>
                                                        <span>{ag.name}</span>
                                                    </td>
                                                    <td className="py-3 text-gray-600">{ag.role}</td>
                                                    <td className="py-3 text-center font-mono text-gray-500 text-[11px]">{ag.model || 'Gemini 3.5 Flash'}</td>
                                                    <td className="py-3 text-center font-mono font-bold text-gray-700">{ag.stepsCompleted || 0}</td>
                                                    <td className="py-3 text-center">
                                                        <span className={`font-bold px-2 py-0.5 rounded text-[11px] ${(ag.bugs || 0) > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                                            {ag.bugs || 0}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 text-center pr-2">
                                                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                                                            ag.status === 'done' ? 'bg-emerald-100 text-emerald-700' :
                                                            ag.status === 'issues' ? 'bg-amber-100 text-amber-700' :
                                                            ag.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                                                        }`}>
                                                            {ag.status === 'issues' ? 'Done (Issues)' : ag.status || 'Complete'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </motion.div>
                        )}

                        {/* Strengths & Priority Recommendations */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            {/* Strengths */}
                            <motion.div
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.35 }}
                                className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 p-6 shadow-sm"
                            >
                                <h3 className="text-sm font-black text-rn-dark mb-3 flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4 text-emerald-600" /> Confirmed Application Strengths
                                </h3>
                                <ul className="space-y-2 text-xs font-medium text-gray-700">
                                    {report.strengths && report.strengths.length > 0 ? (
                                        report.strengths.map((str, idx) => (
                                            <li key={idx} className="flex items-start gap-2.5 p-2 rounded-xl bg-emerald-50/50 border border-emerald-100">
                                                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                                                <span className="leading-relaxed">{str}</span>
                                            </li>
                                        ))
                                    ) : (
                                        <li className="text-gray-400 italic">No specific strengths recorded during run.</li>
                                    )}
                                </ul>
                            </motion.div>

                            {/* Recommendations */}
                            <motion.div
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.4 }}
                                className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 p-6 shadow-sm"
                            >
                                <h3 className="text-sm font-black text-rn-dark mb-3 flex items-center gap-2">
                                    <Lightbulb className="w-4 h-4 text-amber-500" /> Prioritized Recommendations
                                </h3>
                                <ul className="space-y-2 text-xs font-medium text-gray-700">
                                    {report.recommendations && report.recommendations.length > 0 ? (
                                        report.recommendations.map((rec, idx) => (
                                            <li key={idx} className="flex items-start gap-2.5 p-2 rounded-xl bg-amber-50/50 border border-amber-100">
                                                <ArrowRight className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                                <span className="leading-relaxed">{rec}</span>
                                            </li>
                                        ))
                                    ) : (
                                        <li className="text-gray-400 italic">No recommendations needed.</li>
                                    )}
                                </ul>
                            </motion.div>
                        </div>

                        {/* Coverage Summary & Known Limitations */}
                        {report.coverageSummary && (
                            <motion.div
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.45 }}
                                className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/60 p-6 shadow-sm"
                            >
                                <div className="mb-3">
                                    <h3 className="text-sm font-black text-rn-dark flex items-center gap-2">
                                        <Globe className="w-4 h-4 text-blue-500" /> Coverage Scope & Limitations
                                    </h3>
                                    {report.coverageSummary.coverageNotes && (
                                        <p className="text-xs text-gray-600 font-medium mt-1">
                                            {report.coverageSummary.coverageNotes}
                                        </p>
                                    )}
                                </div>

                                {report.coverageSummary.limitations && report.coverageSummary.limitations.length > 0 && (
                                    <div className="mt-3 p-3 rounded-xl bg-gray-50 border border-gray-200">
                                        <p className="text-[10px] font-black uppercase text-gray-500 tracking-wider mb-1.5">
                                            Known Test Scope Limitations
                                        </p>
                                        <ul className="space-y-1 text-xs text-gray-600 font-medium">
                                            {report.coverageSummary.limitations.map((lim, i) => (
                                                <li key={i} className="flex items-start gap-2">
                                                    <span className="text-amber-500 font-bold">•</span>
                                                    <span>{lim}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </motion.div>
                        )}

                        {/* Footer */}
                        <div className="text-center py-8 border-t border-gray-200 mt-6">
                            <div className="flex items-center justify-center gap-2 mb-1">
                                <div className="w-5 h-5 rounded-md gradient-primary flex items-center justify-center">
                                    <Shield className="w-3 h-3 text-white" />
                                </div>
                                <span className="text-xs font-black text-rn-dark">SENTRA QA ENGINE</span>
                            </div>
                            <p className="text-[11px] text-rn-text-muted font-medium">
                                Autonomous Multi-Agent Website Reliability Platform · <strong>Team ZYPHER</strong> (Tarun Kumar, Team Lead)
                            </p>
                        </div>

                    </div>
                )}
            </div>
        </div>
    );
}

function StatCard({ label, value, icon: Icon, color = 'text-rn-primary' }: { label: string; value: string; icon: any; color?: string }) {
    return (
        <div className="flex flex-col items-center justify-center text-center p-2">
            <Icon className={`w-5 h-5 ${color} mb-1`} />
            <p className="text-2xl font-black text-rn-dark">{value}</p>
            <p className="text-[10px] font-extrabold text-rn-text-muted uppercase tracking-widest">{label}</p>
        </div>
    );
}

function MiniStat({ label, value, color = 'text-rn-dark' }: { label: string; value: string; color?: string }) {
    return (
        <div className="bg-rn-surface-2 rounded-xl p-2.5 text-center border border-rn-border/50">
            <p className={`text-xl font-black ${color}`}>{value}</p>
            <p className="text-[10px] font-extrabold text-rn-text-muted uppercase tracking-widest">{label}</p>
        </div>
    );
}
