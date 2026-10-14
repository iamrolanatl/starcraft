"use client";
import { useEffect, useState } from "react";
// Random pool of seamless, pre-darkened 3D space loops (see public/media/bg/CREDITS.md).
// One clip is picked per page load; only that clip is fetched. Reduced motion => poster only.
export const BG_POOL = ["wormhole", "nebula-warp", "nebula-flythrough", "energy-tunnel", "holo-tunnel", "teal-drift", "galaxy-arm", "galaxy-drift", "dark-matter", "hazy-nebula"] as const;
let chosen: string | null = null;
function pick() {
  if (!chosen) chosen = BG_POOL[Math.floor(Math.random() * BG_POOL.length)];
  return chosen;
}
export default function SpaceBackground({ dim = 0.35 }: { dim?: number }) {
  const [clip, setClip] = useState<string | null>(null);
  const [reduced, setReduced] = useState(true);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    setClip(pick());
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setMobile(window.matchMedia("(max-width: 900px)").matches);
  }, []);
  const base = clip ? `/media/bg/${clip}` : null;
  const res = mobile ? "720" : "1080";
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden bg-navy" style={base ? { backgroundImage: `url(${base}-poster.jpg)`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
      {base && !reduced && (
        <video key={base} className="absolute inset-0 h-full w-full object-cover bg-video" poster={`${base}-poster.jpg`} muted playsInline autoPlay loop preload="auto">
          <source src={`${base}-${res}.webm`} type="video/webm" />
          <source src={`${base}-${res}.mp4`} type="video/mp4" />
        </video>
      )}
      <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, rgba(6,11,26,${dim * 0.2}) 0%, rgba(6,11,26,${dim + 0.15}) 100%)` }} />
      <div className="absolute inset-0 scanlines" />
    </div>
  );
}
