import React, { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

const LogoSVGLoader = ({ duration = 3 }) => {
    const pathRef = useRef<SVGPathElement>(null);

    useLayoutEffect(() => {
        if (pathRef.current) {
            const path = pathRef.current;
            const length = path.getTotalLength();
            
            gsap.fromTo(
                path,
                {
                    strokeDasharray: length,
                    strokeDashoffset: length
                },
                {
                    strokeDashoffset: 0,
                    duration,
                    ease: "power2.inOut"
                }
            );
        }
    }, [duration]);

    return (
        <svg width="300" height="220" viewBox="0 0 106 76" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
            <path 
                ref={pathRef}
                d="M26.4818 74C31.3653 38.8875 33.2531 -24.9829 47.969 14.4152C61.7465 51.301 69.5188 87.0269 54.6811 68.3235C22.8868 28.2457 -68.3957 27.8893 104 27.8893" 
                stroke="#71C829" 
                strokeWidth="4" 
                strokeLinecap="round"
            />
        </svg>
    );
};

export const Loader = ({ onLoadComplete }: { onLoadComplete: () => void }) => {
    const loaderRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const timer = setTimeout(() => {
            if (loaderRef.current) {
                gsap.to(loaderRef.current, {
                    opacity: 0,
                    duration: 1,
                    ease: "power2.inOut",
                    onComplete: () => {
                        onLoadComplete();
                    }
                });
            }
        }, 2000);

        return () => clearTimeout(timer);
    }, [onLoadComplete]);

    return (
        <div ref={loaderRef} className="loader-container">
            <div className="flex items-center justify-center">
                <LogoSVGLoader duration={2} />
            </div>
        </div>
    );
};
