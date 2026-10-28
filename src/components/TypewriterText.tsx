import { useState, useEffect, useRef } from 'react';

interface TypewriterTextProps {
    text: string;
    speed?: number;       // ms per character
    showCaret?: boolean;  // show blinking cursor
    onComplete?: () => void;
    className?: string;
}

export default function TypewriterText({
    text,
    speed = 18,
    showCaret = true,
    onComplete,
    className = '',
}: TypewriterTextProps) {
    const [displayed, setDisplayed] = useState('');
    const [isComplete, setIsComplete] = useState(false);
    const indexRef = useRef(0);

    useEffect(() => {
        setDisplayed('');
        setIsComplete(false);
        indexRef.current = 0;

        if (!text) {
            setIsComplete(true);
            return;
        }

        const interval = setInterval(() => {
            indexRef.current++;
            setDisplayed(text.slice(0, indexRef.current));

            if (indexRef.current >= text.length) {
                clearInterval(interval);
                setIsComplete(true);
                onComplete?.();
            }
        }, speed);

        return () => clearInterval(interval);
    }, [text, speed]);

    return (
        <span className={className}>
            {displayed}
            {showCaret && !isComplete && (
                <span className="inline-block w-[2px] h-[1em] bg-rn-primary ml-[1px] animate-pulse align-middle" />
            )}
        </span>
    );
}
