import { motion } from 'framer-motion';
import { Eye, Globe, Lock } from 'lucide-react';

interface LiveViewportProps {
    url?: string;
    status: string;
    workerId: string;
}

export default function LiveViewport({ url, status, workerId }: LiveViewportProps) {
    const isActive = !['sleeping', 'idle', 'done', 'error'].includes(status);

    return (
        <div className="relative aspect-video bg-rn-dark rounded-lg border border-gray-800 overflow-hidden shadow-inner group">
            {/* Browser Header Emulator */}
            <div className="absolute top-0 left-0 right-0 h-4 bg-gray-900/80 backdrop-blur-md flex items-center px-2 gap-1 z-20 border-b border-white/5">
                <div className="flex gap-0.5">
                    <div className="w-1 h-1 rounded-full bg-red-500/50" />
                    <div className="w-1 h-1 rounded-full bg-amber-500/50" />
                    <div className="w-1 h-1 rounded-full bg-emerald-500/50" />
                </div>
                <div className="flex-1 flex justify-center">
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-black/40 border border-white/5 w-[120px]">
                        <Lock className="w-1.5 h-1.5 text-emerald-400" />
                        <span className="text-[6px] text-white/40 truncate font-mono">
                            {url || 'about:blank'}
                        </span>
                    </div>
                </div>
                <Globe className="w-2 h-2 text-white/20" />
            </div>

            {/* Content Area */}
            <div className="absolute inset-0 pt-4 flex items-center justify-center">
                {isActive ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="w-full h-full relative"
                    >
                        {/* Simulated Page Content with Shaders */}
                        <div className="absolute inset-0 bg-white/5 animate-pulse" />
                        <div className="absolute top-4 left-4 right-4 h-2 rounded bg-white/10 animate-pulse" style={{ animationDelay: '0.2s' }} />
                        <div className="absolute top-8 left-4 w-20 h-2 rounded bg-white/10 animate-pulse" style={{ animationDelay: '0.4s' }} />
                        <div className="absolute top-12 left-4 right-12 h-16 rounded bg-rn-primary/5 border border-rn-primary/10 animate-pulse" />

                        {/* Floating Cursor (Simulated) */}
                        <motion.div
                            animate={{
                                x: [20, 60, 40, 80, 20],
                                y: [20, 40, 80, 50, 20]
                            }}
                            transition={{
                                duration: 8,
                                repeat: Infinity,
                                ease: "easeInOut"
                            }}
                            className="absolute w-2 h-2 rounded-full bg-rn-primary border border-white shadow-[0_0_8px_rgba(124,58,237,0.5)] z-30"
                        />

                        {/* Scanline Effect */}
                        <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.03),rgba(0,255,0,0.01),rgba(0,0,255,0.03))] bg-[length:100%_2px,3px_100%]" />
                    </motion.div>
                ) : (
                    <div className="flex flex-col items-center gap-1 opacity-20">
                        <Eye className="w-6 h-6 text-white" />
                        <span className="text-[8px] font-mono text-white uppercase tracking-widest">Feed Offline</span>
                    </div>
                )}
            </div>

            {/* Status Overlay */}
            {isActive && (
                <div className="absolute bottom-1 right-2 z-20 flex items-center gap-1">
                    <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </span>
                    <span className="text-[7px] font-mono text-emerald-400 uppercase font-bold drop-shadow-md">Live</span>
                </div>
            )}

            {/* Agent ID Watermark */}
            <div className="absolute bottom-1 left-2 z-20 opacity-30">
                <span className="text-[8px] font-mono text-white font-bold tracking-tighter">AGENT-{workerId}</span>
            </div>
        </div>
    );
}
