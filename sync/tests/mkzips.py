import zipfile, re, json, io
src = zipfile.ZipFile("/workspace/eli-dashboard/raw.zip"); files = {i.filename: src.read(i) for i in src.infolist()}
def mk(name, ts, edit=lambda f: f):
    f = {k: v for k, v in files.items()}; f = edit(f)
    fl = json.loads(f["_fetch_log.json"].decode("utf-8-sig")); fl["fetched_at"] = ts
    f["_fetch_log.json"] = json.dumps(fl if "_blankfl" not in f else f.pop("_blankfl")).encode() if "_blankfl" not in f else None
    with zipfile.ZipFile(f"zips/{name}.zip", "w") as z:
        for k, v in f.items():
            if v is not None: z.writestr(k, v)
def sub(f, k, pat, rep, flags=0): f[k] = re.sub(pat, rep, f[k].decode("utf-8-sig"), flags=flags).encode(); return f
def numeric(f):
    vals = iter(["82", "88", "91", "77", "85", "95", "150"])   # last course gets an invalid 150 (must be dropped)
    g = f["Gradebook.xml"].decode("utf-8-sig")
    def mark(m):
        v = next(vals, "80"); t = re.sub(r'CalculatedScoreString="[^"]*"', f'CalculatedScoreString="{v}"', m.group(0)); return re.sub(r'CalculatedScoreRaw="[^"]*"', f'CalculatedScoreRaw="{v}"', t)
    f["Gradebook.xml"] = re.sub(r"<Mark\b[^>]*>", mark, g).encode(); return f
def blank(f):
    for k in list(f):
        if k.endswith(".xml"): f[k] = b'<RT_ERROR ERROR_MESSAGE="Session expired" />'
    fl = json.loads(f["_fetch_log.json"].decode("utf-8-sig"))
    for x in fl["log"]: x["ok"] = False; x["error"] = "RT_ERROR: Session expired"
    f["_fetch_log.json"] = json.dumps(fl).encode(); return f
def partial(f):
    g = f["Gradebook.xml"].decode("utf-8-sig"); cs = re.findall(r"<Course\b.*?</Course>", g, re.S)
    for c in cs[3:]: g = g.replace(c, "")
    f["Gradebook.xml"] = g.encode(); return f
def noemail(f):
    for k in list(f):
        if k.endswith(".xml"): f[k] = f[k].replace(b"Nicole.Hyden@cobbk12.org", b"")
    return f
def noasg(f): return sub(f, "Gradebook.xml", r"<Assignment\b[^>]*/>|<Assignment\b.*?</Assignment>", "", re.S)
mk("1_real", "2026-10-13T17:40:09-04:00")
mk("2_numeric", "2026-10-14T05:40:00-04:00", numeric)
mk("3_blank", "2026-10-14T06:40:00-04:00", blank)
mk("4_partial3of7", "2026-10-14T07:40:00-04:00", partial)
mk("5_allNA", "2026-10-14T08:40:00-04:00")
mk("6_teacher_email_blank", "2026-10-14T09:40:00-04:00", noemail)
mk("7_zero_assignments", "2026-10-14T10:40:00-04:00", noasg)
mk("8_real_again", "2026-10-14T11:40:00-04:00")
print(sorted(__import__("os").listdir("zips")))
