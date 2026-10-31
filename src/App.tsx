import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Sparkles, Search, Bug, FileText, Globe, Bot, BarChart3, Paperclip, X, Zap, Lock, Activity, Layers } from 'lucide-react';
import TopBar from './components/TopBar.tsx';
import StartButton from './components/StartButton.tsx';
import ReportView from './components/ReportView.tsx';
import AgentsPanel from './components/AgentsPanel.tsx';
import DarkVeil from './components/DarkVeil.tsx';

interface TestEvent {
    type: string;
    message: string;
    timestamp: number;
    [key: string]: any;
}

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
    workers?: any[];
    tasks: any[];
    timeline: any[];
    issues: any[];
    issuesSummary: {
        total: number;
        high: number;
        medium: number;
        low: number;
        critical?: number;
    };
    screenshots: string[];
}

interface AgentState {
    id: string;
    status: string;
    message: string;
    stepsCompleted?: number;
    totalSteps?: number;
    issuesFound?: number;
    logs?: string[];
}

interface RiskState {
    score: number;
    level: string;
    totalIssues: number;
    breakdown: { critical: number; high: number; medium: number; low: number };
}

type AppMode = 'home' | 'testing';
type TabMode = 'agents' | 'report';

/* Rotating hero words */
const heroWords = [
    'website instantly',
    'app thoroughly',
    'site autonomously',
    'pages reliably',
    'flows completely',
];

function TypingHero() {
    const [wordIndex, setWordIndex] = useState(0);
    const [charIndex, setCharIndex] = useState(0);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        const word = heroWords[wordIndex];
        const typeSpeed = isDeleting ? 30 : 60;

        if (!isDeleting && charIndex === word.length) {
            setTimeout(() => setIsDeleting(true), 1200);
            return;
        }
        if (isDeleting && charIndex === 0) {
            setIsDeleting(false);
            setWordIndex((prev) => (prev + 1) % heroWords.length);
            return;
        }

        const timeout = setTimeout(() => {
            setCharIndex((prev) => prev + (isDeleting ? -1 : 1));
        }, typeSpeed);

        return () => clearTimeout(timeout);
    }, [charIndex, isDeleting, wordIndex]);

    return (
        <span className="text-rn-primary">
            {heroWords[wordIndex].substring(0, charIndex)}
            <span className="animate-blink">|</span>
        </span>
    );
}

/* Animated gradient tile background */
function TilesBackground() {
    return (
        <div className="absolute inset-0 z-0 overflow-hidden">
            <div className="grid grid-cols-12 gap-px h-full w-full opacity-[0.03]">
                {Array.from({ length: 120 }).map((_, i) => (
                    <div key={i} className="bg-rn-primary rounded-sm"
                        style={{ animationDelay: `${(i * 0.15) % 5}s`, opacity: Math.random() * 0.4 + 0.1 }} />
                ))}
            </div>
        </div>
    );
}

const DEFAULT_AGENTS: Record<string, AgentState> = {
    A: { id: 'A', status: 'idle', message: '', logs: [] },
    B: { id: 'B', status: 'idle', message: '', logs: [] },
    C: { id: 'C', status: 'sleeping', message: '', logs: [] },
    D: { id: 'D', status: 'sleeping', message: '', logs: [] },
    E: { id: 'E', status: 'sleeping', message: '', logs: [] },
    F: { id: 'F', status: 'sleeping', message: '', logs: [] },
    G: { id: 'G', status: 'sleeping', message: '', logs: [] },
    H: { id: 'H', status: 'sleeping', message: '', logs: [] },
};

const DEFAULT_RISK: RiskState = {
    score: 0,
    level: 'low',
    totalIssues: 0,
    breakdown: { critical: 0, high: 0, medium: 0, low: 0 },
};

export default function App() {
    const [mode, setMode] = useState<AppMode>('home');
    const [tab, setTab] = useState<TabMode>('agents');
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [events, setEvents] = useState<TestEvent[]>([]);
    const [report, setReport] = useState<Report | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [urlValue, setUrlValue] = useState('');
    const [agents, setAgents] = useState<Record<string, AgentState>>({ ...DEFAULT_AGENTS });
    const [risk, setRisk] = useState<RiskState>({ ...DEFAULT_RISK });
    const eventSourceRef = useRef<EventSource | null>(null);
    const [prdText, setPrdText] = useState('');
    const [userInstructions, setUserInstructions] = useState('');
    const [prdFileName, setPrdFileName] = useState('');

    useEffect(() => {
        return () => { eventSourceRef.current?.close(); };
    }, []);

    const handleStart = useCallback(async (url: string) => {
        if (!url.trim()) return;
        setError(null);
        setEvents([]);
        setReport(null);
        setMode('testing');
        setTab('agents');
        setAgents({ ...DEFAULT_AGENTS });
        setRisk({ ...DEFAULT_RISK });

        try {
            const res = await fetch('/api/start-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url.trim(), prdText, userInstructions }),
            });
            const text = await res.text();
            let data;
            try { data = JSON.parse(text); } catch { throw new Error('Server returned an invalid response. Make sure the backend is running.'); }
            if (!res.ok) throw new Error(data.error || 'Failed to start test');

            setSessionId(data.sessionId);

            const sse = new EventSource(`/api/events/${data.sessionId}`);
            eventSourceRef.current = sse;

            sse.onmessage = (e) => {
                try {
                    const event: TestEvent = JSON.parse(e.data);

                    if (event.type === 'complete') {
                        sse.close();
                        fetchReport(data.sessionId);
                        return;
                    }

                    // Update agent states
                    if (event.type === 'agent-status' && event.agents) {
                        setAgents(prev => {
                            const next = { ...prev };
                            for (const [id, state] of Object.entries(event.agents as Record<string, AgentState>)) {
                                next[id] = { ...next[id], ...state };
                            }
                            return next;
                        });
                    }

                    // Update risk
                    if (event.type === 'risk-update' && event.risk) {
                        setRisk(event.risk);
                    }

                    // Track worker issues for step counts
                    if (event.type === 'worker-issue' && event.workerId) {
                        setAgents(prev => {
                            const next = { ...prev };
                            const w = next[event.workerId];
                            if (w) {
                                next[event.workerId] = { ...w, issuesFound: (w.issuesFound || 0) + 1 };
                            }
                            return next;
                        });
                    }

                    // Track per-agent logs
                    if (event.type === 'agent-log' && event.agentId && event.log) {
                        setAgents(prev => {
                            const next = { ...prev };
                            const agent = next[event.agentId];
                            if (agent) {
                                const currentLogs = agent.logs || [];
                                next[event.agentId] = { ...agent, logs: [...currentLogs, event.log] };
                            }
                            return next;
                        });
                    }

                    setEvents(prev => [...prev, event]);
                } catch { }
            };

            sse.onerror = () => {
                sse.close();
                fetchReport(data.sessionId);
            };

        } catch (err: any) {
            setError(err.message);
            setMode('home');
        }
    }, [prdText, userInstructions]);

    const fetchReport = useCallback(async (sid: string) => {
        // Retry up to 12 times with 2-second intervals (24 seconds total) to wait for report generation
        for (let attempt = 0; attempt < 12; attempt++) {
            try {
                const res = await fetch(`/api/report/${sid}`);
                const text = await res.text();
                let data;
                try { data = JSON.parse(text); } catch { return; }
                if (data.report) {
                    setReport(data.report);
                    setTab('report'); // Auto-switch to report tab
                    return;
                }
                // Report not ready yet — wait 2s before retry
                if (attempt < 11) await new Promise(r => setTimeout(r, 2000));
            } catch { }
        }
    }, []);

    const handleReset = useCallback(() => {
        eventSourceRef.current?.close();
        setMode('home');
        setSessionId(null);
        setEvents([]);
        setReport(null);
        setError(null);
        setAgents({ ...DEFAULT_AGENTS });
        setRisk({ ...DEFAULT_RISK });
    }, []);

    // ===================== HOME / LANDING =====================
    if (mode === 'home') {
        return (
            <div className="h-screen w-screen overflow-y-auto bg-white relative">
                {/* DarkVeil WebGL — full animated background, light purple */}
                <div className="absolute inset-0 z-0" style={{ filter: 'invert(1) hue-rotate(220deg) saturate(0.4) brightness(1.05)' }}>
                    <DarkVeil
                        hueShift={260}
                        noiseIntensity={0}
                        scanlineIntensity={0}
                        speed={0.6}
                        scanlineFrequency={0}
                        warpAmount={0}
                    />
                </div>

                <div className="relative z-10">
                    {/* Sentra — just text, fully black */}
                    <div className="pt-14 pb-2 text-center">
                        <span className="font-black text-5xl tracking-tight text-black">Sentra</span>
                    </div>

                    {/* Hero */}
                    <div className="max-w-3xl mx-auto px-6 pt-8 pb-8 text-center">
                        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md bg-white/30 backdrop-blur-md border border-white/40 text-rn-primary text-xs font-bold mb-5 shadow-sm">
                                <Sparkles className="w-3.5 h-3.5" /> Team ZYPHER · Autonomous AI QA Platform
                            </div>
                        </motion.div>

                        <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.08 }}
                            className="text-5xl sm:text-[3.5rem] font-black tracking-tight leading-[1.1] mb-4"
                            style={{ minHeight: '7.5rem' }}>
                            <span className="text-rn-dark">Test any</span><br />
                            <TypingHero />
                        </motion.h1>

                        <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.16 }}
                            className="text-rn-text-dim text-lg font-medium max-w-md mx-auto mb-8 leading-relaxed">
                            Submit any website URL and SENTRA autonomously deploys 6 specialized AI agents to test UI, user flows, security, performance, edge cases, and business logic — then consolidates findings into one actionable QA report.
                        </motion.p>

                        {/* URL Input + Start Button */}
                        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.24 }}
                            className="max-w-xl mx-auto mb-4">
                            <div className="flex items-center gap-3">
                                <input
                                    type="text"
                                    value={urlValue}
                                    onChange={(e) => setUrlValue(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && urlValue.trim() && handleStart(urlValue.trim())}
                                    placeholder="https://example.com"
                                    className="flex-1 h-11 rounded-lg bg-white/50 backdrop-blur-lg border border-white/50 px-4 text-sm font-medium text-rn-dark placeholder-rn-text-muted focus:outline-none focus:border-rn-primary/40 focus:ring-2 focus:ring-rn-primary/10 transition-all shadow-lg shadow-black/5"
                                />
                                <StartButton onClick={() => urlValue.trim() && handleStart(urlValue.trim())} text="Start Test" small />
                            </div>
                        </motion.div>

                        {/* Instructions + PRD File */}
                        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.28 }}
                            className="max-w-xl mx-auto mb-8">
                            <div className="rounded-2xl bg-white/50 backdrop-blur-lg border border-white/50 p-3 shadow-lg shadow-black/5">
                                <textarea
                                    value={userInstructions}
                                    onChange={(e) => setUserInstructions(e.target.value)}
                                    placeholder="Optional: Add instructions, credentials, or context for the AI agents..."
                                    rows={2}
                                    className="w-full bg-transparent text-rn-dark text-sm placeholder-rn-text-muted resize-none focus:outline-none px-2 py-1.5 min-h-[44px]"
                                    style={{ scrollbarWidth: 'thin' }}
                                />
                                <div className="flex items-center justify-between pt-1 border-t border-zinc-200/50">
                                    <div className="flex items-center gap-2">
                                        <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rn-text-dim hover:text-rn-primary hover:bg-rn-primary/5 cursor-pointer transition-all">
                                            <Paperclip className="w-4 h-4" />
                                            <span>{prdFileName || 'Attach PRD (.docx / .md / .txt)'}</span>
                                            <input
                                                type="file"
                                                accept=".docx,.md,.txt"
                                                className="hidden"
                                                onChange={async (e) => {
                                                    const file = e.target.files?.[0];
                                                    if (!file) return;
                                                    setPrdFileName(file.name);
                                                    try {
                                                        if (file.name.endsWith('.md') || file.name.endsWith('.txt')) {
                                                            const text = await file.text();
                                                            setPrdText(text);
                                                        } else if (file.name.endsWith('.docx')) {
                                                            const arrayBuffer = await file.arrayBuffer();
                                                            const mammoth = await import('mammoth');
                                                            const result = await mammoth.extractRawText({ arrayBuffer });
                                                            setPrdText(result.value);
                                                        }
                                                    } catch (err) {
                                                        console.error('PRD parse error:', err);
                                                        setPrdText('');
                                                        setPrdFileName('');
                                                    }
                                                    e.target.value = '';
                                                }}
                                            />
                                        </label>
                                        {prdFileName && (
                                            <button onClick={() => { setPrdText(''); setPrdFileName(''); }}
                                                className="flex items-center gap-1 px-2 py-1 rounded-md bg-rn-primary/15 text-rn-primary text-[10px] font-bold hover:bg-rn-primary/25 transition-all">
                                                {prdFileName} <X className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-rn-text-muted font-medium">
                                        {prdText ? `${(prdText.length / 1000).toFixed(1)}k chars` : 'optional'}
                                    </div>
                                </div>
                            </div>
                        </motion.div>

                        {error && (
                            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                                className="max-w-xl mx-auto mb-6 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm font-medium flex items-center gap-2">
                                <span className="font-bold">Error:</span> {error}
                                <button onClick={() => setError(null)} className="ml-auto hover:text-red-800 font-bold text-lg">×</button>
                            </motion.div>
                        )}

                        {/* Feature cards */}
                        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.32 }}
                            className="flex flex-wrap justify-center gap-2 mb-6">
                            {[
                                { icon: Search, text: 'Discovery Agent', desc: 'Maps site features' },
                                { icon: Shield, text: 'Security Agent', desc: 'Auth & validation' },
                                { icon: Zap, text: 'Performance Agent', desc: 'Speed & load times' },
                                { icon: Activity, text: 'User Flow Agent', desc: 'End-to-end journeys' },
                                { icon: Bug, text: 'Edge Case Agent', desc: 'Boundary inputs' },
                                { icon: Layers, text: 'Business Logic', desc: 'Rules & calculations' },
                            ].map(({ icon: Icon, text, desc }) => (
                                <div key={text} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/40 backdrop-blur-lg border border-white/50 text-sm font-semibold text-rn-dark shadow-lg shadow-black/5 hover:shadow-xl hover:bg-white/60 hover:border-rn-primary/20 transition-all">
                                    <Icon className="w-3.5 h-3.5 text-rn-primary flex-shrink-0" />
                                    <div>
                                        <div className="text-xs font-bold text-rn-dark leading-none">{text}</div>
                                        <div className="text-[9px] text-rn-text-muted font-medium">{desc}</div>
                                    </div>
                                </div>
                            ))}
                        </motion.div>

                        {/* Workflow line */}
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.38 }}
                            className="flex items-center justify-center gap-1.5 mb-14 text-[10px] font-bold text-rn-text-muted flex-wrap">
                            {['URL Input', '→', 'Discovery', '→', 'Orchestration', '→', '6 Parallel Agents', '→', 'QA Report'].map((step, i) => (
                                <span key={i} className={step === '→' ? 'text-rn-primary/40' : 'px-2 py-1 rounded bg-white/50 border border-white/60 text-rn-dark'}>{step}</span>
                            ))}
                        </motion.div>
                    </div>

                    <div className="text-center pb-8">
                        <p className="text-xs text-rn-text-muted font-medium">
                            Team <span className="font-bold text-rn-primary">ZYPHER</span> · Tarun Kumar (Team Lead)
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // ===================== TESTING VIEW — Agents/Report Tabs =====================
    const hasWorkerActivity = Object.values(agents).some(a => a.status !== 'idle' && a.status !== 'sleeping');

    return (
        <div className="h-screen w-screen flex flex-col overflow-hidden relative">
            {/* DarkVeil animated background — same as homepage */}
            <div className="absolute inset-0 z-0" style={{ filter: 'invert(1) hue-rotate(220deg) saturate(0.4) brightness(1.05)' }}>
                <DarkVeil hueShift={260} speed={0.4} />
            </div>
            <div className="relative z-10 flex flex-col h-full">
                <TopBar onBack={handleReset} mode={report ? 'report' : 'testing'} />

                {/* Tab Bar — glass */}
                <div className="h-10 px-5 flex items-center justify-center gap-1 border-b border-white/20 bg-white/30 backdrop-blur-lg shrink-0">
                    <button
                        onClick={() => setTab('agents')}
                        className={`h-8 px-4 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all ${tab === 'agents'
                            ? 'gradient-primary text-white shadow-sm'
                            : 'text-rn-text-muted hover:text-rn-dark hover:bg-rn-surface-2'
                            }`}
                    >
                        <Bot className="w-3.5 h-3.5" /> Agents
                    </button>
                    <button
                        onClick={() => setTab('report')}
                        className={`h-8 px-4 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all ${tab === 'report'
                            ? 'gradient-primary text-white shadow-sm'
                            : 'text-rn-text-muted hover:text-rn-dark hover:bg-rn-surface-2'
                            }`}
                    >
                        <BarChart3 className="w-3.5 h-3.5" /> {report ? 'QA Report' : 'Live Timeline'}
                        {!report && <span className="w-1.5 h-1.5 rounded-full bg-rn-primary animate-pulse ml-0.5" />}
                    </button>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-hidden">
                    {tab === 'agents' ? (
                        <AgentsPanel agents={agents} risk={risk} />
                    ) : (
                        <div className="h-full overflow-auto">
                            <ReportView events={events} report={report} sessionId={sessionId} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
