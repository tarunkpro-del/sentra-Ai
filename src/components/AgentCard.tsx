import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Bot, Eye, Zap, CheckCircle, XCircle, AlertTriangle, Moon, Loader2 } from 'lucide-react';

interface AgentCardProps {
    id: string;
    name: string;
    role: string;
    status: string;
    message: string;
    icon?: any;
    domainColor?: string;
    isLarge?: boolean;
    issuesFound?: number;
    stepsCompleted?: number;
    totalSteps?: number;
    logs?: string[];
}

const statusConfig: Record<string, { color: string; bg: string; border: string; icon: any; label: string; pulse?: boolean }> = {
    idle: { color: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-200', icon: Bot, label: 'Standby' },
    sleeping: { color: 'text-gray-400', bg: 'bg-gray-50/80', border: 'border-gray-200', icon: Moon, label: 'Waiting', pulse: true },
    waking: { color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-200', icon: Zap, label: 'Waking', pulse: true },
    thinking: { color: 'text-violet-500', bg: 'bg-violet-50', border: 'border-violet-200', icon: Loader2, label: 'Thinking', pulse: true },
    executing: { color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200', icon: Zap, label: 'Running' },
    validating: { color: 'text-cyan-500', bg: 'bg-cyan-50', border: 'border-cyan-200', icon: Eye, label: 'Validating' },
    issues: { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-300', icon: AlertTriangle, label: 'Done · Issues' },
    done: { color: 'text-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: CheckCircle, label: 'Complete ✓' },
    error: { color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200', icon: XCircle, label: 'Error' },
};

function getLogColor(log: string): string {
    if (log.startsWith('🐛') || log.startsWith('❌') || log.startsWith('✗')) return 'text-red-500';
    if (log.startsWith('✅') || log.startsWith('✓')) return 'text-emerald-600';
    if (log.startsWith('🔒') || log.includes('[Security]')) return 'text-red-400';
    if (log.startsWith('⚡') || log.includes('[Perf]') || log.includes('slow')) return 'text-amber-500';
    if (log.startsWith('🧠') || log.startsWith('📋')) return 'text-violet-500';
    if (log.startsWith('▶') || log.startsWith('→')) return 'text-blue-500';
    if (log.startsWith('⚠')) return 'text-amber-600';
    if (log.startsWith('🚀')) return 'text-emerald-500';
    return 'text-rn-dark-2';
}

export default function AgentCard({ id, name, role, status, message, icon: DomainIcon, domainColor, isLarge, issuesFound, stepsCompleted, totalSteps, logs }: AgentCardProps) {
    const config = statusConfig[status] || statusConfig.idle;
    const StatusIcon = config.icon;
    const progress = totalSteps && totalSteps > 0 ? Math.min(100, Math.round((stepsCompleted || 0) / totalSteps * 100)) : 0;
    const logEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll logs to bottom
    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs?.length]);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className={`relative rounded-xl border ${config.border} overflow-hidden transition-all duration-300 flex flex-col
                backdrop-blur-lg bg-white/50
                ${isLarge ? 'p-4' : 'p-3'}
                ${status === 'sleeping' ? 'opacity-60' : 'opacity-100'}
                ${config.pulse ? 'animate-pulse-subtle' : ''}
                shadow-sm hover:shadow-md
            `}
        >
            {/* Status glow */}
            {status !== 'sleeping' && status !== 'idle' && (
                <div className={`absolute inset-0 ${config.bg} opacity-40 pointer-events-none`} />
            )}

            <div className="relative z-10 flex flex-col flex-1 min-h-0">
                {/* Header */}
                <div className="flex items-center gap-2 mb-1.5">
                    {/* Domain icon or Bot fallback */}
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${status === 'sleeping' ? 'bg-gray-200' : 'gradient-primary shadow-sm'}`}>
                        {DomainIcon
                            ? <DomainIcon className={`w-3 h-3 ${status === 'sleeping' ? 'text-gray-400' : 'text-white'}`} />
                            : <Bot className={`w-3 h-3 ${status === 'sleeping' ? 'text-gray-400' : 'text-white'}`} />
                        }
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-rn-dark truncate">{name}</span>
                            <span className={`text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${config.color} ${config.bg}`}>
                                {config.label}
                            </span>
                        </div>
                        <p className="text-[9px] text-rn-text-muted font-medium truncate">{role}</p>
                    </div>
                    <StatusIcon className={`w-4 h-4 flex-shrink-0 ${config.color} ${status === 'thinking' ? 'animate-spin' : ''
                        } ${status === 'sleeping' ? 'animate-bounce-slow' : ''}`} />
                </div>

                {/* Current message — shown when active */}
                {message && status !== 'sleeping' && status !== 'idle' && (
                    <p className="text-[8px] text-rn-text-dim font-medium mb-1 truncate italic">
                        {message}
                    </p>
                )}

                {/* Progress bar — only when active */}
                {status !== 'sleeping' && status !== 'idle' && (stepsCompleted || 0) > 0 && (
                    <div className="mb-1.5">
                        <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${progress}%` }}
                                transition={{ duration: 0.5 }}
                                className="h-full rounded-full gradient-primary"
                            />
                        </div>
                        <div className="flex justify-between mt-0.5">
                            <span className="text-[8px] text-rn-text-muted font-medium">{stepsCompleted || 0} steps</span>
                            {(issuesFound || 0) > 0 && (
                                <span className="text-[8px] text-rn-danger font-bold flex items-center gap-0.5">
                                    <AlertTriangle className="w-2.5 h-2.5" /> {issuesFound} found
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* Sleeping animation */}
                {status === 'sleeping' && (
                    <div className="flex items-center justify-center py-2 gap-1">
                        <span className="text-sm animate-bounce-slow opacity-50" style={{ animationDelay: '0s' }}>z</span>
                        <span className="text-xs animate-bounce-slow opacity-40" style={{ animationDelay: '0.3s' }}>z</span>
                        <span className="text-[10px] animate-bounce-slow opacity-30" style={{ animationDelay: '0.6s' }}>z</span>
                    </div>
                )}

                {/* ─── LIVE LOG ─── */}
                {logs && logs.length > 0 && status !== 'sleeping' && (
                    <div className="flex-1 min-h-0 mt-1 bg-white/60 rounded-lg border border-gray-100 overflow-hidden">
                        <div className="h-full overflow-auto px-2 py-1 max-h-[130px]" style={{ fontSize: '9px', lineHeight: '1.5' }}>
                            {(logs || []).map((log, i) => (
                                <div key={i} className={`font-medium ${getLogColor(log)}`}>
                                    {log}
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    );
}
