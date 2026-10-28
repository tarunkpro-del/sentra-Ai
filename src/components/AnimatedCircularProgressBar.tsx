import { useEffect, useState } from 'react';

interface Props {
    value: number;
    min?: number;
    max?: number;
    gaugePrimaryColor?: string;
    gaugeSecondaryColor?: string;
    className?: string;
}

export default function AnimatedCircularProgressBar({
    value,
    min = 0,
    max = 100,
    gaugePrimaryColor = 'rgb(79 70 229)',
    gaugeSecondaryColor = 'rgba(0, 0, 0, 0.1)',
    className = '',
}: Props) {
    const [animatedValue, setAnimatedValue] = useState(0);

    useEffect(() => {
        const timeout = setTimeout(() => setAnimatedValue(value), 100);
        return () => clearTimeout(timeout);
    }, [value]);

    const circumference = 2 * Math.PI * 45;
    const percentPx = circumference / 100;
    const currentPercent = Math.round(((animatedValue - min) / (max - min)) * 100);
    const strokeDashoffset = circumference - (currentPercent * percentPx);

    return (
        <div className={`relative inline-flex items-center justify-center ${className}`}>
            <svg width="120" height="120" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
                {/* Background circle */}
                <circle
                    cx="50" cy="50" r="45"
                    fill="none"
                    stroke={gaugeSecondaryColor}
                    strokeWidth="7"
                />
                {/* Progress circle */}
                <circle
                    cx="50" cy="50" r="45"
                    fill="none"
                    stroke={gaugePrimaryColor}
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    style={{
                        transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-black text-rn-dark">{currentPercent}</span>
                <span className="text-[9px] font-extrabold text-rn-text-muted uppercase tracking-widest">percent</span>
            </div>
        </div>
    );
}
