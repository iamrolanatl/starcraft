import base64,hmac,hashlib,json,sys
SECRET=b"e2e-test-secret-e2e-test-secret-0123456789"
b=lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode()
def tok(c): h=b(json.dumps({"alg":"HS256","typ":"JWT"}).encode()); p=b(json.dumps({**c,"exp":4102444800}).encode()); return f"{h}.{p}."+b(hmac.new(SECRET,f"{h}.{p}".encode(),hashlib.sha256).digest())
if __name__=="__main__": print(tok(json.loads(sys.argv[1])))
