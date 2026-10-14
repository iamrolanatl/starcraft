"use client";
// Crystal Sync downloads + pairing (020). Parent creates a 15-minute single-use pairing code here and types it into the installed app.
import { useCallback, useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import { SyncLights } from "@/components/CrystalSync";

const VER = "0.1.0";
const REL = "/downloads";  // static files on Cloudflare Pages (the GitHub repo is private, so release links would not work for parents)
const DL = [
  { os: "macOS", hue: "#c4b5fd", file: `CrystalSync-${VER}-macOS.dmg`, href: `${REL}/CrystalSync-${VER}-macOS.dmg`, note: "macOS 12+, Apple silicon & Intel. Unsigned preview: right-click the app → Open the first time.", runs: "Runs in the background with launchd (starts at login)." },
  { os: "Windows", hue: "#7dd3fc", file: `CrystalSync-${VER}-Windows-Setup.exe`, href: `${REL}/CrystalSync-${VER}-Windows-Setup.exe`, note: "Windows 10/11. Unsigned preview: SmartScreen → More info → Run anyway.", runs: "Runs with Task Scheduler at 5:40 AM/PM and at log-on." },
  { os: "Linux", hue: "#7dffc8", file: `CrystalSync-${VER}-x86_64.AppImage`, href: `/downloads/CrystalSync-${VER}-x86_64.AppImage`, alt: { label: ".deb", href: `/downloads/crystal-sync_${VER}_amd64.deb` }, note: "x86_64. chmod +x, then run it. Ubuntu/Debian users can use the .deb.", runs: "Runs as a systemd user timer (5:40 AM/PM, survives reboots)." },
];
type Kid = { id: string; first_name: string; grade: string | null };

export default function Downloads() {
  const [kids, setKids] = useState<Kid[] | null>(null); const [sel, setSel] = useState<string[]>([]); const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [have, setHave] = useState<Record<string, boolean>>({});
  useEffect(() => { DL.forEach(d => fetch(d.href, { method: "HEAD" }).then(r => setHave(h => ({ ...h, [d.os]: r.ok && !(r.headers.get("content-type") || "").includes("text/html") }))).catch(() => setHave(h => ({ ...h, [d.os]: false })))); }, []);
  const [err, setErr] = useState(""); const [signed, setSigned] = useState<boolean | null>(null); const [left, setLeft] = useState(0);
  const [devices, setDevices] = useState<{ id: string; name: string; platform: string; last_seen_at: string | null; revoked_at: string | null; child_ids: string[]; role: string; last_ok_at: string | null }[]>([]);
  const load = useCallback(async () => {
    const { data: s } = await sb().auth.getSession(); setSigned(!!s.session); if (!s.session) return;
    const { data } = await sb().from("children").select("id,first_name,grade").order("sort"); setKids((data as Kid[]) ?? []); setSel(v => v.length ? v : ((data as Kid[]) ?? []).map(k => k.id));
    const { data: d } = await sb().rpc("sync_my_devices"); setDevices((d as typeof devices) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!code) return; const t = setInterval(() => { const s = Math.max(0, Math.round((new Date(code.expires_at).getTime() - Date.now()) / 1000)); setLeft(s); if (!s) { setCode(null); load(); } }, 1000); return () => clearInterval(t); }, [code, load]);
  const make = async () => { setErr(""); const { data, error } = await sb().rpc("sync_pair_create", { p_child_ids: sel });
    if (error) { setErr(/schema cache|does not exist/.test(error.message) ? "Crystal Sync isn't enabled yet (migration 020 pending)." : error.message); return; } setCode(data as typeof code); };
  const revoke = async (id: string) => { if (!confirm("Disconnect this computer? It stops syncing immediately.")) return; const { error } = await sb().rpc("sync_device_revoke", { p_device: id }); if (error) setErr(error.message); load(); };
  return (<main className="mx-auto max-w-5xl space-y-5 p-4 pb-24 text-sm text-ice sm:p-8">
    <header className="flex flex-wrap items-center gap-3"><a href="/" className="text-cyan hover:underline">← Crystal</a><h1 className="font-mono text-xl font-bold tracking-[.2em] text-snow">CRYSTAL SYNC · DOWNLOADS</h1></header>
    <p className="max-w-3xl text-ash">Crystal Sync is a small app for the parent&apos;s computer. It signs in to ParentVUE / CTLS Parent (and optionally the student&apos;s StudentVUE, CTLS Learn, Office 365) <b className="text-snow">from your own computer</b>, once per run, at 5:40 AM and 5:40 PM and whenever you press SYNC NOW, then uploads only your child&apos;s school data to Crystal. Passwords are stored only in that computer&apos;s keychain. They are never sent to Crystal.</p>
    <section className="grid gap-3 md:grid-cols-3">{DL.map(d => <div key={d.os} className="glass rounded-2xl border p-4" style={{ borderColor: `${d.hue}55`, boxShadow: `0 0 24px ${d.hue}1f` }}>
      <h2 className="font-mono text-lg font-bold tracking-[.15em]" style={{ color: d.hue }}>{d.os.toUpperCase()}</h2>
      {have[d.os] === false ? <span className="mt-2 block rounded-lg border px-3 py-2 text-center font-bold tracking-wider" style={{ borderColor: `${d.hue}66`, color: d.hue }}>BUILD COMING SOON</span>
        : <a href={d.href} download className="mt-2 block rounded-lg px-3 py-2 text-center font-bold tracking-wider text-[#04121a]" style={{ background: d.hue }}>DOWNLOAD</a>}
      {"alt" in d && d.alt && <a href={d.alt.href} className="mt-1 block text-center text-xs text-ash hover:underline">or {d.alt.label}</a>}
      <p className="mt-2 break-all font-mono text-[10px] text-slate">{d.file}</p><p className="mt-2 text-xs">{d.note}</p><p className="mt-1 text-xs text-ash">{d.runs}</p></div>)}</section>
    <section className="glass rounded-2xl border border-cyan/25 p-4"><h2 className="mb-2 font-mono font-bold tracking-[.15em] text-cyan">SETUP · 4 STEPS</h2>
      <ol className="list-decimal space-y-1 pl-5"><li>Download and open Crystal Sync for your computer.</li><li>Create a pairing code below (good for 15 minutes, works once).</li>
        <li>In the setup window: paste the code, then enter your ParentVUE / CTLS Parent login. Optional: your student&apos;s StudentVUE, CTLS Learn, Office 365.</li><li>Press <b>Pair &amp; test</b>. The light next to your child in Education turns green after the first good sync.</li></ol></section>
    <section className="glass rounded-2xl border border-[#ffd166]/30 p-4"><h2 className="mb-2 font-mono font-bold tracking-[.15em] text-[#ffd166]">PAIRING CODE</h2>
      {signed === false ? <p>Sign in to Crystal first, then come back to this page.</p> : !kids ? <p className="text-ash">Loading…</p> : !kids.length ? <p>Add your child first (Family → Add child), then create a pairing code.</p> : <>
        <div className="mb-2 flex flex-wrap gap-2">{kids.map(k => <label key={k.id} className="flex items-center gap-1 rounded-full border border-cyan/30 px-2 py-0.5"><input type="checkbox" checked={sel.includes(k.id)} onChange={e => setSel(v => e.target.checked ? [...v, k.id] : v.filter(x => x !== k.id))} />{k.first_name}{k.grade ? ` · grade ${k.grade}` : ""}</label>)}</div>
        {code ? <div className="flex flex-wrap items-center gap-4"><span data-testid="pair-code" className="rounded-xl border border-[#ffd166] px-5 py-2 font-mono text-3xl font-bold tracking-[.3em] text-[#ffd166]" style={{ boxShadow: "0 0 24px #ffd16655" }}>{code.code}</span><span className="text-ash">expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} · single use</span><button className="text-cyan hover:underline" onClick={() => navigator.clipboard?.writeText(code.code)}>COPY</button></div>
          : <button disabled={!sel.length} onClick={make} className="rounded-lg bg-[#ffd166] px-4 py-2 font-bold tracking-wider text-[#04121a] disabled:opacity-40">CREATE PAIRING CODE</button>}
        <p className="mt-2 text-xs text-ash">You can pair several computers. Only one (PRIMARY) signs in to ParentVUE at each 5:40 run; the others stand by and take over if it hasn&apos;t finished within 10 minutes. The paired computer can only upload school data for the children you tick here. It can&apos;t read anything in Crystal. You can disconnect it at any time below.</p></>}
      {err && <p className="mt-2 text-[#ff3b5c]">{err}</p>}</section>
    {signed && <section className="glass rounded-2xl border border-cyan/25 p-4"><h2 className="mb-2 font-mono font-bold tracking-[.15em] text-cyan">STATUS &amp; PAIRED COMPUTERS</h2><SyncLights />
      <ul className="mt-3 space-y-1">{devices.map(d => <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs" style={{ opacity: d.revoked_at ? .5 : 1 }}><span className="rounded px-1.5 font-mono text-[10px] font-bold" style={{ color: d.role === "primary" ? "#7dffc8" : d.role === "standby" ? "#7dd3fc" : "#7a8aa6", border: "1px solid currentColor" }} title={d.role === "primary" ? "Signs in to ParentVUE at 5:40 and runs SYNC NOW" : d.role === "standby" ? "Waits; takes over if the primary hasn't finished within 10 minutes" : ""}>{d.role.toUpperCase()}</span><span className="font-bold text-snow">{d.name}</span><span className="text-ash">{d.platform} · {d.child_ids.length} child(ren) · last seen {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET" : "never"}</span>
        {d.revoked_at ? <span className="text-ash">DISCONNECTED</span> : <button onClick={() => revoke(d.id)} className="rounded border border-[#ff3b5c88] px-2 font-bold text-[#ff3b5c]">DISCONNECT</button>}</li>)}{!devices.length && <li className="text-xs text-ash">No computers paired yet.</li>}</ul></section>}
    <section className="text-xs text-slate"><b>Security:</b> each computer gets its own key (only a fingerprint is stored in Crystal), limited to uploading the paired children&apos;s school data, rate-limited, and logged. Passwords never leave your computer.</section>
  </main>);
}
