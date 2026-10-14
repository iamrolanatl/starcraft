# Generates an original, seamlessly looping nebula video (no third-party footage).
import numpy as np, subprocess, sys
W,H,FPS,SEC=960,540,24,12; N=FPS*SEC
rng=np.random.default_rng(7)
def noise(scale,w,h):
    acc=np.zeros((h,w))
    for o in range(5):
        s=max(2,int(scale*2**o)); g=rng.random((s,s*2))
        from PIL import Image
        im=Image.fromarray((g*255).astype(np.uint8)).resize((w,h),Image.BICUBIC)
        acc+=np.asarray(im,dtype=float)/255/(2**o)
    acc-=acc.min(); return acc/acc.max()
TW=W*2
m=lambda x: np.hstack([x,np.fliplr(x)])
A=m(noise(3,W,H)); B=m(noise(4,W,H)); C=m(noise(2,W,H))
stars=np.zeros((H,W)); idx=rng.integers(0,H*W,900); stars.flat[idx]=rng.random(900)
phase=rng.random(900)*2*np.pi
out=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
 '-c:v','libx264','-preset','slow','-crf','30','-pix_fmt','yuv420p','-movflags','+faststart','-an',sys.argv[1]],stdin=subprocess.PIPE)
for f in range(N):
    t=f/N
    a=np.roll(A,int(t*TW),axis=1)[:, :W]; b=np.roll(B,-int(t*TW),axis=1)[:, :W]
    c=np.roll(C,int(t*TW),axis=1)[:, :W]
    neb=np.clip((a*b*1.8)**1.6,0,1); wisp=np.clip(c-0.45,0,1)*1.6
    r=0.02+0.25*neb*0.6+0.35*wisp*0.5; g=0.04+0.55*neb+0.2*wisp; bl=0.10+0.75*neb+0.5*wisp
    tw=np.zeros((H,W)); tw.flat[idx]=stars.flat[idx]*(0.6+0.4*np.sin(2*np.pi*t*3+phase))
    img=np.stack([r+tw,g+tw,bl+tw],-1)
    out.stdin.write((np.clip(img,0,1)*255).astype(np.uint8).tobytes())
out.stdin.close(); out.wait()
