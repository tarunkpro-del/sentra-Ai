import { motion } from 'framer-motion';
import { Shield, Activity, AlertTriangle, TrendingDown, Search, Zap, Bug, Lock, BarChart2, Layers } from 'lucide-react';
import AgentCard from './AgentCard';

interface Agent {
    id: string;
    status: string;
    message: string;
    stepsCompleted?: number;
    totalSteps?: number;
    issuesFound?: number;
    logs?: string[];
}

interface RiskData {
    score: number;
    level: string;
    totalIssues: number;
    breakdown: { critical: number; high: number; medium: number; low: number };
}

interface Props {
    agents: Record<string, Agent>;
    risk: RiskData;
}

const AGENT_NAMES: Record<string, { name: string; role: string; icon?: any; color?: string }> = {
    A: { name: 'Discovery Agent', role: 'Explores site, maps features & user journeys', icon: Search, color: 'text-violet-500' },
    B: { name: 'Orchestrator', role: 'Creates test strategy, dispatches agent missions', icon: Layers, color: 'text-blue-500' },
    C: { name: 'Navigation & Exploration', role: 'Routes, menus, redirects & page discovery', icon: BarChart2, color: 'text-cyan-500' },
    D: { name: 'UI & Interactive Controls', role: 'Buttons, tabs, dropdowns & state changes', icon: Activity, color: 'text-blue-500' },
    E: { name: 'Forms & Input Validation', role: 'Input fields, auth & boundary validation', icon: Lock, color: 'text-emerald-500' },
    F: { name: 'Core Workflow & E-Commerce', role: 'End-to-end cart, checkout & user journeys', icon: Zap, color: 'text-purple-500' },
    G: { name: 'Business Logic & Domain Testing', role: 'Seat selection, calculations & rules', icon: Shield, color: 'text-amber-500' },
    H: { name: 'Defect Verification & Evidence', role: 'Assertion checks, bug reproduction & evidence capture', icon: Bug, color: 'text-rose-500' },
};

function getRiskColor(level: string) {
    switch (level) {
        case 'low': return '#059669';
        case 'medium': return '#d97706';
        case 'high': return '#ea580c';
        case 'critical': return '#dc2626';
        default: return '#6b7280';
    }
}

function getReliabilityColor(score: number, totalIssues: number) {
    if (totalIssues === 0 || score >= 90) return '#059669';
    if (score >= 70) return '#d97706';
    return '#dc2626';
}

export default function AgentsPanel({ agents, risk }: Props) {
    const agentA = agents['A'] || { id: 'A', status: 'idle', message: '' };
    const agentB = agents['B'] || { id: 'B', status: 'idle', message: '' };
    const workers = ['C', 'D', 'E', 'F', 'G', 'H'].map(id =>
        agents[id] || { id, status: 'sleeping', message: '' }
    );

    const activeWorkers = workers.filter(w => !['sleeping', 'idle', 'done', 'error', 'issues'].includes(w.status)).length;
    const doneWorkers = workers.filter(w => w.status === 'done' || w.status === 'issues').length;
    const totalIssues = Object.values(agents).reduce((sum, a) => sum + ((a as any).issuesFound || 0), 0);
    const hasStarted = agentA.status !== 'idle' && agentA.status !== 'sleeping';
    // Display live reliability score
    const reliabilityDisplay = risk.totalIssues > 0 ? risk.score : 100;

    return (
        <div className="h-full flex flex-col overflow-auto p-4">

            {/* Top bar: Reliability Meter + Stats — always visible */}
            <div className="flex items-center justify-center gap-4 mb-4 px-1">
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 px-4 py-2.5 bg-white/50 backdrop-blur-lg rounded-xl border border-white/40 shadow-sm"
                >
                    <Shield className="w-5 h-5" style={{ color: getReliabilityColor(reliabilityDisplay, risk.totalIssues) }} />
                    <div>
                        <p className="text-lg font-black leading-none" style={{ color: getReliabilityColor(reliabilityDisplay, risk.totalIssues) }}>{reliabilityDisplay}</p>
                        <p className="text-[9px] text-rn-text-muted font-bold uppercase">Reliability</p>
                    </div>
                </motion.div>

                <div className="flex items-center gap-3 px-4 py-2.5 bg-white/50 backdrop-blur-lg rounded-xl border border-white/40 shadow-sm">
                    <Activity className="w-4 h-4 text-blue-500" />
                    <div>
                        <p className="text-sm font-bold text-rn-dark leading-none">{activeWorkers}</p>
                        <p className="text-[9px] text-rn-text-muted font-medium">Active</p>
                    </div>
                </div>

                <div className="flex items-center gap-3 px-4 py-2.5 bg-white/50 backdrop-blur-lg rounded-xl border border-white/40 shadow-sm">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <div>
                        <p className="text-sm font-bold text-rn-dark leading-none">{totalIssues}</p>
                        <p className="text-[9px] text-rn-text-muted font-medium">Issues</p>
                    </div>
                </div>

                <div className="flex items-center gap-3 px-4 py-2.5 bg-white/50 backdrop-blur-lg rounded-xl border border-white/40 shadow-sm">
                    <TrendingDown className="w-4 h-4 text-emerald-500" />
                    <div>
                        <p className="text-sm font-bold text-rn-dark leading-none">{doneWorkers}/6</p>
                        <p className="text-[9px] text-rn-text-muted font-medium">Done</p>
                    </div>
                </div>
            </div>

            {/* Main layout: Left (A+B) + Right (Workers grid) */}
            <div className="flex gap-4 flex-1 min-h-0">

                {/* Left Column — Agent A + Agent B */}
                <div className="w-56 shrink-0 flex flex-col gap-3">
                    <AgentCard
                        id="A"
                        name={AGENT_NAMES.A.name}
                        role={AGENT_NAMES.A.role}
                        icon={AGENT_NAMES.A.icon}
                        status={agentA.status}
                        message={agentA.message}
                        logs={agentA.logs}
                        isLarge
                    />
                    <AgentCard
                        id="B"
                        name={AGENT_NAMES.B.name}
                        role={AGENT_NAMES.B.role}
                        icon={AGENT_NAMES.B.icon}
                        status={agentB.status}
                        message={agentB.message}
                        logs={agentB.logs}
                        isLarge
                    />

                    {/* Live Issue Feed */}
                    {risk.totalIssues > 0 && (
                        <div className="flex-1 bg-white rounded-xl border border-rn-border p-3 overflow-auto">
                            <p className="text-[10px] font-bold text-rn-dark mb-2 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-amber-500" /> Live Issues
                            </p>
                            <div className="space-y-1">
                                {risk.breakdown.critical > 0 && <IssueBadge label="Critical" count={risk.breakdown.critical} color="text-red-600 bg-red-50" />}
                                {risk.breakdown.high > 0 && <IssueBadge label="High" count={risk.breakdown.high} color="text-orange-600 bg-orange-50" />}
                                {risk.breakdown.medium > 0 && <IssueBadge label="Medium" count={risk.breakdown.medium} color="text-amber-600 bg-amber-50" />}
                                {risk.breakdown.low > 0 && <IssueBadge label="Low" count={risk.breakdown.low} color="text-gray-500 bg-gray-50" />}
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Grid — 6 Workers (2 rows x 3 cols) */}
                <div className="flex-1 grid grid-cols-3 grid-rows-2 gap-3 min-h-0">
                    {workers.map((w, i) => {
                        const wId = ['C', 'D', 'E', 'F', 'G', 'H'][i];
                        const info = AGENT_NAMES[wId];
                        return (
                            <AgentCard
                                key={wId}
                                id={wId}
                                name={info.name}
                                role={info.role}
                                icon={info.icon}
                                domainColor={info.color}
                                status={w.status}
                                message={w.message}
                                stepsCompleted={w.stepsCompleted}
                                totalSteps={w.totalSteps || 40}
                                issuesFound={w.issuesFound}
                                logs={w.logs}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function IssueBadge({ label, count, color }: { label: string; count: number; color: string }) {
    return (
        <div className={`flex items-center justify-between px-2 py-1 rounded-lg text-[9px] font-bold ${color}`}>
            <span>{label}</span>
            <span>{count}</span>
        </div>
    );
}
