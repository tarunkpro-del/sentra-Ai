import { useMemo } from 'react';
import { motion } from 'framer-motion';

interface TextShimmerProps {
    children: string;
    className?: string;
    duration?: number;
    spread?: number;
}

export default function TextShimmer({
    children,
    className = '',
    duration = 2,
    spread = 2,
}: TextShimmerProps) {
    const dynamicSpread = useMemo(() => children.length * spread, [children, spread]);

    return (
        <motion.span
            className={`relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent ${className}`}
            style={{
                '--spread': `${dynamicSpread}px`,
                '--base-color': '#8a8a8a',
                '--base-gradient-color': '#7c3aed',
                backgroundImage: `linear-gradient(90deg, #0000 calc(50% - var(--spread)), var(--base-gradient-color), #0000 calc(50% + var(--spread))), linear-gradient(var(--base-color), var(--base-color))`,
                backgroundRepeat: 'no-repeat, padding-box',
            } as React.CSSProperties}
            initial={{ backgroundPosition: '100% center' }}
            animate={{ backgroundPosition: '0% center' }}
            transition={{ repeat: Infinity, duration, ease: 'linear' }}
        >
            {children}
        </motion.span>
    );
}
