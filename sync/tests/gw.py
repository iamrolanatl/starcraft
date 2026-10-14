# Minimal Supabase stand-in: /rest/v1 -> PostgREST :3000, /storage/v1/object/raw (policy-checked as anon via SQL), /auth/v1/admin/users
import http.server, json, os, subprocess, urllib.request, base64, uuid
UID=os.environ.get("TEST_UID","11111111-1111-1111-1111-111111111111"); STORE="/tmp/e2e/objects"; os.makedirs(STORE,exist_ok=True)
def claims(h):
    t=(h.get("Authorization") or "").split(" ")[-1]
    try: return json.loads(base64.urlsafe_b64decode(t.split(".")[1]+"=="))
    except Exception: return {}
def psql(sql):
    return subprocess.run(["sudo","-n","-u","postgres","psql","-d","t","-qAt","-v","ON_ERROR_STOP=1","-c",sql],capture_output=True,text=True)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self,code,body=b"",ct="application/json"):
        self.send_response(code); self.send_header("Content-Type",ct); self.end_headers(); self.wfile.write(body if isinstance(body,bytes) else body.encode())
    def proxy(self):
        n=int(self.headers.get("Content-Length") or 0); data=self.rfile.read(n) if n else None
        req=urllib.request.Request("http://127.0.0.1:3000"+self.path[len("/rest/v1"):],data=data,method=self.command)
        for k in ("Authorization","Content-Type","Prefer","Accept"):
            if self.headers.get(k): req.add_header(k,self.headers[k])
        try: r=urllib.request.urlopen(req); self.send(r.status,r.read())
        except urllib.error.HTTPError as e: self.send(e.code,e.read())
    def obj(self):
        name=self.path.split("/storage/v1/object/raw/",1)[1].split("?")[0]; role=claims(self.headers).get("role","anon"); fp=os.path.join(STORE,name.replace("/","__"))
        if self.command=="POST":
            body=self.rfile.read(int(self.headers.get("Content-Length") or 0)); safe=name.replace("'","''")
            r=psql(f"set role {role}; insert into storage.objects(bucket_id,name) values ('raw','{safe}')")
            if r.returncode: return self.send(403,json.dumps({"message":"new row violates row-level security policy","error":r.stderr[-200:]}))
            open(fp,"wb").write(body); return self.send(200,json.dumps({"Key":"raw/"+name}))
        if self.command=="DELETE":
            if role!="service_role": return self.send(403,"{}")
            if os.path.exists(fp): os.remove(fp)
            psql(f"delete from storage.objects where bucket_id='raw' and name='{name}'"); return self.send(200,"[]")
        if self.command=="GET":
            if role!="service_role": return self.send(400,json.dumps({"message":"Object not found"}))
            return self.send(200,open(fp,"rb").read(),"application/zip") if os.path.exists(fp) else self.send(404,"{}")
    def route(self):
        if self.path.startswith("/rest/v1"): return self.proxy()
        if self.path.startswith("/storage/v1/object/raw/"): return self.obj()
        if self.path.startswith("/auth/v1/admin/users"):
            if claims(self.headers).get("role")!="service_role": return self.send(401,"{}")
            return self.send(200,json.dumps({"users":[{"id":UID,"email":"iamrolan@gmail.com"}] if os.path.exists("/tmp/e2e/user_exists") else []}))
        self.send(404,"{}")
    do_GET=do_POST=do_PATCH=do_DELETE=route
http.server.ThreadingHTTPServer(("127.0.0.1",54321),H).serve_forever()
