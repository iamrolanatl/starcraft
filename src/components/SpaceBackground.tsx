"use client";
import { useEffect, useRef, useState } from "react";
// Seamless looping nebula (generated in-house, scripts/gen_nebula.py). Two stacked
// videos cross-fade at the loop point so restarts are invisible. Reduced motion => poster only.
export default function SpaceBackground({ dim = 0.35 }: { dim?: number }) {
  const [reduced, setReduced] = useState(false);
  const a = useRef<HTMLVideoElement>(null), b = useRef<HTMLVideoElement>(null);
  const [front, setFront] = useState<0 | 1>(0);
  useEffect(() => { setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  useEffect(() => {
    if (reduced) return;
    const vids = [a.current!, b.current!];
    const cur = vids[front], next = vids[front ^ 1];
    const onTime = () => {
      if (cur.duration && cur.duration - cur.currentTime < 1.2 && next.paused) {
        next.currentTime = 0; next.play().catch(() => {}); setFront((front ^ 1) as 0 | 1);
      }
    };
    cur.addEventListener("timeupdate", onTime);
    cur.play().catch(() => {});
    return () => cur.removeEventListener("timeupdate", onTime);
  }, [front, reduced]);
  const style = "absolute inset-0 h-full w-full object-cover transition-opacity duration-[1200ms] bg-video";
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden bg-navy" style={{ backgroundImage: "url(/media/nebula-poster.jpg)", backgroundSize: "cover", backgroundPosition: "center" }}>
      {!reduced && (<>
        <video ref={a} className={style} style={{ opacity: front === 0 ? 1 : 0 }} src="/media/nebula.mp4" poster="/media/nebula-poster.jpg" muted playsInline autoPlay preload="auto" onEnded={e => e.currentTarget.pause()} />
        <video ref={b} className={style} style={{ opacity: front === 1 ? 1 : 0 }} src="/media/nebula.mp4" muted playsInline preload="auto" onEnded={e => e.currentTarget.pause()} />
      </>)}
      <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, rgba(6,11,26,${dim * 0.2}) 0%, rgba(6,11,26,${dim + 0.15}) 100%)` }} />
      <div className="absolute inset-0 scanlines" />
    </div>
  );
}
