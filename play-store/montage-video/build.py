import subprocess,re,json,os,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageFilter
from multiprocessing import Pool
from ocr import boxes as rawboxes
V1='/mnt/user-data/uploads/Record_2026-11-16-18-49-15.mp4'
V3='/mnt/user-data/uploads/Record_2026-11-16-18-54-26.mp4'
W,H,FPS=720,1608,30
SEGS=[(V1,0.0,1.8,[(0,9,'Opening MotoRoute from the phone home screen')]),
      (V3,0.0,3.0,[(0,9,'MotoRoute opens (sign-in not shown)')]),
      (V3,40.0,53.0,[(40,47,'App switched to English for this video'),(47,99,'Menu → My emergencies')]),
      (V3,86.0,108.5,[(86,89.3,'Emergency SMS NOT allowed. Tap "Allow SMS"'),
                      (89.3,92.6,'MotoRoute first explains why it needs the SMS permission'),
                      (92.6,98.8,'"Not now": nothing is requested, SMS stays NOT allowed'),
                      (98.8,102.7,'Tap "Allow SMS" again, then "I agree"'),
                      (102.7,104.8,'Android prompt (in French): "Allow MotoRoute to use SMS?" → Allow'),
                      (104.8,999,'Emergency SMS allowed')])]
def frames(src,a,b,fps):
    p=subprocess.Popen(['ffmpeg','-v','error','-ss',str(a),'-t',str(b-a),'-i',src,'-vf',f'fps={fps},scale={W}:{H}','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
    n=W*H*3
    while True:
        buf=p.stdout.read(n)
        if len(buf)<n: break
        yield Image.frombuffer('RGB',(W,H),buf)
def good(b):
    x0,y0,x1,y1,s=b
    if y1<75: return False
    if '@' in s and len(s)<6 and not re.search(r'\d{3,}',s): return False
    return True
def ocr_one(path):
    return [b[:4] for b in rawboxes(Image.open(path)) if good(b)]
SAMPLE=30
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',26)
def caption(img,text):
    d=ImageDraw.Draw(img,'RGBA')
    words=text.split();lines=[];cur=''
    for w in words:
        t=(cur+' '+w).strip()
        if d.textlength(t,font=font)>W-60 and cur: lines.append(cur);cur=w
        else: cur=t
    lines.append(cur)
    h=len(lines)*34+20;y0=78
    d.rectangle([0,y0,W,y0+h],fill=(0,0,0,200))
    for i,l in enumerate(lines):
        d.text(((W-d.textlength(l,font=font))/2,y0+10+i*34),l,font=font,fill=(255,214,90))
def blur(img,bx):
    for x0,y0,x1,y1 in bx:
        x0,y0,x1,y1=max(0,x0-10),max(0,y0-8),min(W,x1+10),min(H,y1+8)
        if x1<=x0 or y1<=y0: continue
        c=img.crop((x0,y0,x1,y1));c=c.resize((max(1,(x1-x0)//12),max(1,(y1-y0)//12))).resize((x1-x0,y1-y0),Image.NEAREST).filter(ImageFilter.GaussianBlur(4))
        img.paste(c,(x0,y0))
enc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart','etape1-en-test106.mp4'],stdin=subprocess.PIPE)
log=[]
for si,(src,a,b,caps) in enumerate(SEGS):
    import shutil,glob as G
    d=f'samp{si}'; shutil.rmtree(d,ignore_errors=True); os.makedirs(d)
    subprocess.run(['ffmpeg','-v','error','-ss',str(a),'-t',str(b-a),'-i',src,'-vf',f'fps={SAMPLE},scale={W}:{H}',f'{d}/s_%05d.png'],check=True)
    samp=sorted(G.glob(f'{d}/s_*.png'))
    with Pool(2) as P: sb=P.map(ocr_one,samp,chunksize=8)
    for fi,img in enumerate(frames(src,a,b,FPS)):
        t=fi/FPS; k=t*SAMPLE; lo=int(k); hi=min(lo+1,len(sb)-1); lo=min(lo,len(sb)-1)
        bx=[q for j in range(max(0,lo-2),min(len(sb),lo+3)) for q in sb[j]]
        if src==V3 and 39.9<=a+t<47.6: bx.append((236,160,345,210))
        img=img.copy(); blur(img,bx)
        ts=a+t
        for c0,c1,txt in caps:
            if c0<=ts<c1: caption(img,txt);break
        enc.stdin.write(img.tobytes())
    log.append((si,len(samp),sum(len(x) for x in sb)))
    print('segment',si,'ok',log[-1],flush=True)
enc.stdin.close();enc.wait()
