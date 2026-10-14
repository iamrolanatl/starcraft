"use client";
// Crystal: snow-white robot with neon accents and big blue eyes.
export type Mood = "idle" | "happy" | "thinking" | "alert" | "wave";
export default function CrystalBot({ size = 96, mood = "idle", onClick, label = "Crystal, your co-pilot" }: { size?: number; mood?: Mood; onClick?: () => void; label?: string }) {
  const body = mood === "happy" ? "hop .7s ease-in-out 2" : mood === "wave" ? "wiggle .5s ease-in-out 3" : mood === "alert" ? "wiggle .25s linear infinite" : "float 4s ease-in-out infinite";
  const eyeColor = mood === "alert" ? "#ff5c7a" : "#3aa8ff";
  return (
    <button type="button" onClick={onClick} aria-label={label} className="relative select-none" style={{ width: size, height: size * 1.15 }}>
      <svg viewBox="0 0 120 138" width="100%" height="100%" style={{ animation: body, overflow: "visible" }}>
        <defs>
          <radialGradient id="cb-body" cx="40%" cy="30%" r="75%"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#d9e6f5" /></radialGradient>
          <radialGradient id="cb-eye" cx="40%" cy="35%" r="65%"><stop offset="0" stopColor="#bff0ff" /><stop offset=".45" stopColor={eyeColor} /><stop offset="1" stopColor="#0a2a6b" /></radialGradient>
          <linearGradient id="cb-neon" x1="0" x2="1"><stop offset="0" stopColor="#3ef2e0" /><stop offset=".5" stopColor="#c77dff" /><stop offset="1" stopColor="#ff7ab6" /></linearGradient>
          <filter id="cb-glow"><feGaussianBlur stdDeviation="2.2" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {/* antenna */}
        <line x1="60" y1="16" x2="60" y2="4" stroke="#c7ccd4" strokeWidth="3" strokeLinecap="round" />
        <circle cx="60" cy="4" r="5" fill={mood === "thinking" ? "#ffd166" : "#7dffc8"} filter="url(#cb-glow)" className="animate-glow" />
        {/* head */}
        <rect x="14" y="16" width="92" height="70" rx="32" fill="url(#cb-body)" stroke="url(#cb-neon)" strokeWidth="2" />
        <rect x="24" y="28" width="72" height="46" rx="22" fill="#0b1430" />
        <g className="animate-blink">
          <ellipse cx="45" cy="51" rx="11" ry={mood === "happy" ? 6 : 13} fill="url(#cb-eye)" filter="url(#cb-glow)" />
          <ellipse cx="75" cy="51" rx="11" ry={mood === "happy" ? 6 : 13} fill="url(#cb-eye)" filter="url(#cb-glow)" />
          <circle cx="41" cy="45" r="3.5" fill="#fff" /><circle cx="71" cy="45" r="3.5" fill="#fff" />
        </g>
        <ellipse cx="30" cy="68" rx="5" ry="3" fill="#ff7ab6" opacity=".6" /><ellipse cx="90" cy="68" rx="5" ry="3" fill="#ff7ab6" opacity=".6" />
        {mood === "thinking" ? <circle cx="60" cy="68" r="2.5" fill="#7dffc8" /> : <path d="M52 66 q8 7 16 0" stroke="#7dffc8" strokeWidth="2.5" fill="none" strokeLinecap="round" />}
        {/* ear lights */}
        <rect x="6" y="40" width="9" height="22" rx="4" fill="#3ef2e0" filter="url(#cb-glow)" className="animate-glow" />
        <rect x="105" y="40" width="9" height="22" rx="4" fill="#c77dff" filter="url(#cb-glow)" className="animate-glow" />
        {/* body */}
        <rect x="32" y="88" width="56" height="38" rx="18" fill="url(#cb-body)" stroke="url(#cb-neon)" strokeWidth="1.5" />
        <circle cx="60" cy="106" r="7" fill="#0b1430" /><circle cx="60" cy="106" r="4" fill={mood === "alert" ? "#ff3b5c" : "#3ef2e0"} filter="url(#cb-glow)" className="animate-glow" />
        <g style={{ transformOrigin: "30px 96px", animation: mood === "wave" ? "wiggle .4s ease-in-out 4" : undefined }}>
          <rect x="18" y="92" width="12" height="26" rx="6" fill="url(#cb-body)" stroke="#3ef2e0" strokeWidth="1" />
        </g>
        <rect x="90" y="92" width="12" height="26" rx="6" fill="url(#cb-body)" stroke="#ff7ab6" strokeWidth="1" />
        <ellipse cx="60" cy="134" rx="24" ry="3" fill="#3ef2e0" opacity=".25" />
      </svg>
    </button>
  );
}
