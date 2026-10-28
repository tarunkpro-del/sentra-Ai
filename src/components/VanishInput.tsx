import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';

interface VanishInputProps {
    placeholders: string[];
    onSubmit: (value: string) => void;
    buttonText?: string;
}

export default function VanishInput({ placeholders, onSubmit, buttonText = 'Start Test' }: VanishInputProps) {
    const [currentPlaceholder, setCurrentPlaceholder] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const newDataRef = useRef<any[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const [value, setValue] = useState('');
    const [animating, setAnimating] = useState(false);

    useEffect(() => {
        const start = () => { intervalRef.current = setInterval(() => setCurrentPlaceholder(p => (p + 1) % placeholders.length), 3000); };
        start();
        const h = () => { if (document.visibilityState !== 'visible' && intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } else if (document.visibilityState === 'visible') start(); };
        document.addEventListener('visibilitychange', h);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); document.removeEventListener('visibilitychange', h); };
    }, [placeholders]);

    const draw = useCallback(() => {
        if (!inputRef.current || !canvasRef.current) return;
        const canvas = canvasRef.current; const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = 800; canvas.height = 800; ctx.clearRect(0, 0, 800, 800);
        const s = getComputedStyle(inputRef.current);
        ctx.font = `${parseFloat(s.getPropertyValue('font-size')) * 2}px ${s.fontFamily}`;
        ctx.fillStyle = '#FFF'; ctx.fillText(value, 16, 40);
        const img = ctx.getImageData(0, 0, 800, 800).data;
        const nd: any[] = [];
        for (let t = 0; t < 800; t++) { const i = 4 * t * 800; for (let n = 0; n < 800; n++) { const e = i + 4 * n; if (img[e] && img[e + 1] && img[e + 2]) nd.push({ x: n, y: t, color: [img[e], img[e + 1], img[e + 2], img[e + 3]] }); } }
        newDataRef.current = nd.map(({ x, y, color }) => ({ x, y, r: 1, color: `rgba(${color.join(',')})` }));
    }, [value]);

    useEffect(() => { draw(); }, [value, draw]);

    const animate = (start: number) => {
        const af = (pos = 0) => {
            requestAnimationFrame(() => {
                const arr: any[] = [];
                for (const c of newDataRef.current) { if (c.x < pos) arr.push(c); else { if (c.r <= 0) continue; c.x += Math.random() > .5 ? 1 : -1; c.y += Math.random() > .5 ? 1 : -1; c.r -= .05 * Math.random(); arr.push(c); } }
                newDataRef.current = arr;
                const ctx = canvasRef.current?.getContext('2d');
                if (ctx) { ctx.clearRect(pos, 0, 800, 800); arr.forEach(t => { if (t.x > pos) { ctx.beginPath(); ctx.rect(t.x, t.y, t.r, t.r); ctx.fillStyle = t.color; ctx.strokeStyle = t.color; ctx.stroke(); } }); }
                if (arr.length > 0) af(pos - 8); else { setValue(''); setAnimating(false); }
            });
        };
        af(start);
    };

    const vanishAndSubmit = () => {
        if (!value.trim()) return;
        setAnimating(true); draw();
        if (inputRef.current) { const mx = newDataRef.current.reduce((p, c) => c.x > p ? c.x : p, 0); animate(mx); }
        onSubmit(value.trim());
    };

    return (
        <div className="flex items-center gap-3 w-full max-w-xl mx-auto">
            <form className="flex-1 relative bg-white h-12 rounded-lg overflow-hidden shadow-[0_1px_3px_0_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.05)] hover:shadow-[0_2px_8px_0_rgba(124,58,237,0.12),0_0_0_1px_rgba(124,58,237,0.1)] transition-shadow duration-300"
                onSubmit={e => { e.preventDefault(); vanishAndSubmit(); }}>
                <canvas className={`absolute pointer-events-none text-base transform scale-50 top-[20%] left-2 sm:left-6 origin-top-left filter invert pr-20 ${!animating ? 'opacity-0' : 'opacity-100'}`} ref={canvasRef} />
                <input onChange={e => { if (!animating) setValue(e.target.value); }} onKeyDown={e => e.key === 'Enter' && !animating && vanishAndSubmit()}
                    ref={inputRef} value={value} type="text"
                    className={`w-full relative text-sm z-50 border-none bg-transparent text-rn-dark h-full rounded-lg focus:outline-none focus:ring-0 pl-4 sm:pl-6 pr-4 font-medium ${animating ? 'text-transparent' : ''}`} />
                <div className="absolute inset-0 flex items-center rounded-lg pointer-events-none">
                    <AnimatePresence mode="wait">
                        {!value && (
                            <motion.p key={`ph-${currentPlaceholder}`} initial={{ y: 5, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }}
                                transition={{ duration: 0.25, ease: 'linear' }} className="text-sm font-medium text-rn-text-muted pl-4 sm:pl-6 text-left w-[calc(100%-1rem)] truncate">
                                {placeholders[currentPlaceholder]}
                            </motion.p>
                        )}
                    </AnimatePresence>
                </div>
            </form>

            {/* Shimmer button */}
            <button onClick={vanishAndSubmit}
                style={{ '--speed': '3s', '--bg': 'rgba(124, 58, 237, 1)' } as React.CSSProperties}
                className="group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap border border-white/10 h-12 px-6 text-white [background:var(--bg)] rounded-lg transform-gpu transition-transform duration-200 active:translate-y-px shadow-md shadow-rn-primary/20 hover:shadow-lg hover:shadow-rn-primary/30 shrink-0">
                <div className="-z-30 blur-[2px] absolute inset-0 overflow-visible [container-type:size]">
                    <div className="absolute inset-0 h-[100cqh] animate-shimmer-slide [aspect-ratio:1]">
                        <div className="animate-spin-around absolute -inset-full w-auto rotate-0 [background:conic-gradient(from_calc(270deg-45deg),transparent_0,#ffffff_90deg,transparent_90deg)]" />
                    </div>
                </div>
                <span className="relative flex items-center gap-2 text-sm font-bold tracking-tight">
                    {buttonText} <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </span>
                <div className="absolute inset-0 rounded-lg shadow-[inset_0_-8px_10px_#ffffff1f] group-hover:shadow-[inset_0_-6px_10px_#ffffff3f] transition-all duration-300" />
                <div className="absolute -z-20 [background:var(--bg)] rounded-lg [inset:0.05em]" />
            </button>
        </div>
    );
}
