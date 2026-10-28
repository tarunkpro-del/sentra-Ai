import { ChevronLeft, Shield } from 'lucide-react';
import TextShimmer from './TextShimmer.tsx';

interface TopBarProps {
    onBack: () => void;
    mode: 'testing' | 'report';
}

export default function TopBar({ onBack, mode }: TopBarProps) {
    return (
        <nav className="h-12 flex items-center px-3 z-50 bg-white/30 backdrop-blur-lg border-b border-white/20 shrink-0">
            {/* Left — back button & brand */}
            <div className="flex items-center gap-3 mr-3 shrink-0">
                <button onClick={onBack}
                    className="flex items-center gap-1 text-xs font-bold text-rn-text-dim hover:text-rn-primary transition-colors h-8 px-2.5 rounded-lg hover:bg-rn-surface-2 border border-transparent hover:border-rn-border">
                    <ChevronLeft className="w-4 h-4" />
                    <span className="hidden sm:inline">Home</span>
                </button>
                <div className="hidden sm:flex items-center gap-1.5 pl-2 border-l border-gray-200/80">
                    <div className="w-5 h-5 rounded-md gradient-primary flex items-center justify-center text-white shadow-sm">
                        <Shield className="w-3 h-3" />
                    </div>
                    <span className="text-xs font-black text-rn-dark tracking-tight">SENTRA</span>
                    <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">ZYPHER</span>
                </div>
            </div>

            {/* Center — branding */}
            <div className="flex-1 flex items-center justify-center min-w-0">
                <div className="flex items-center gap-2">
                    {mode === 'testing' ? (
                        <TextShimmer className="text-xs font-bold text-rn-primary" duration={1.5}>
                            6 AI QA Agents Testing in Parallel...
                        </TextShimmer>
                    ) : (
                        <span className="text-xs font-bold text-rn-dark flex items-center gap-1.5">
                            <Shield className="w-3.5 h-3.5 text-rn-primary" /> Consolidated QA Report
                        </span>
                    )}
                </div>
            </div>

            {/* Right — status indicator */}
            <div className="flex items-center gap-1.5 ml-3 shrink-0">
                {mode === 'testing' && (
                    <div className="h-8 px-3.5 text-xs font-bold rounded-md flex items-center gap-1.5 bg-rn-success/10 text-rn-success border border-rn-success/20">
                        <div className="w-1.5 h-1.5 rounded-full bg-rn-success animate-pulse" />
                        Live
                    </div>
                )}
                {mode === 'report' && (
                    <button onClick={onBack}
                        className="h-8 px-3.5 text-xs font-bold rounded-md flex items-center gap-1.5 bg-rn-surface-2 text-rn-text-dim border border-transparent hover:border-rn-border hover:text-rn-primary transition-all">
                        New Test
                    </button>
                )}
            </div>
        </nav>
    );
}
