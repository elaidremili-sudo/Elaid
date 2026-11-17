import subprocess,json,sys
from PIL import Image,ImageDraw,ImageFilter
from head import header
P=json.load(open('P.json'))
SRC='/home/claude/montage/etape1-nocap.mp4'; OUT='etape1-v4style.mp4'
W,H=1080,1920; SX,SY,SW,SH=218,410,644,1438
base=Image.open('full_6.png').convert('RGB')
mask=Image.new('L',(SW,SH),0); ImageDraw.Draw(mask).rounded_rectangle([0,0,SW-1,SH-1],radius=38,fill=255)
TITLE=['SMS permission: refuse, then allow']
PH=[(0.0,4.8,['The rider opens MotoRoute from the phone home','screen (sign-in not shown).']),
    (4.8,9.7,['App switched to English for this step.']),
    (9.7,16.4,['Menu → My emergencies. Emergency SMS is','NOT allowed by default.']),
    (16.4,17.8,['The rider taps “Allow SMS”.']),
    (17.8,20.4,['MotoRoute first explains why it needs the SMS','permission, before Android asks anything.']),
    (20.4,28.3,['“Not now”: nothing is requested and the SMS','stays NOT allowed.']),
    (28.3,31.3,['The rider taps “Allow SMS” again, then','“I agree”.']),
    (31.3,32.9,['Android permission prompt (phone in French):','“Allow MotoRoute to use SMS?” → Allow.']),
    (32.9,99,['Emergency SMS allowed. It can be turned off','at any time.'])]
heads=[]
for a,b,sub in PH:
    t=base.copy(); t.paste(header('STEP 1 OF 9',TITLE,sub,P),(0,0)); heads.append((a,b,t))
for i,(a,b,t) in enumerate(heads): t.save(f'tpl_{i}.png')
dec=subprocess.Popen(['ffmpeg','-v','error','-i',SRC,'-vf','fps=30','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
enc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','30','-i','-','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p',OUT],stdin=subprocess.PIPE)
import numpy as np
raw=subprocess.run(['ffmpeg','-v','error','-i',SRC,'-vf','fps=30,scale=90:200','-f','rawvideo','-pix_fmt','gray','-'],capture_output=True).stdout
g=np.frombuffer(raw,np.uint8).reshape(-1,200,90).astype(int); N=len(g)
dd=[0]+[abs(g[k]-g[k-1]).mean() for k in range(1,N)]+[0]
moving=lambda k: dd[k]>3 or dd[k+1]>3
HOLD_AT=966; HOLD=45
S=next(k for k in range(537,N-3) if dd[k]<0.3 and dd[k+1]<0.3 and dd[k+2]<0.3)
print('fenetre MotoRoute nette a partir de',S,round(S/30,2),flush=True)
frames={}
n=720*1608*3; i=0; kept=0; blurred=0
allf=[]
while True:
    buf=dec.stdout.read(n)
    if len(buf)<n: break
    allf.append(buf); i+=1
print('lues',len(allf),flush=True)
def emit(k,tpl_t,times=1):
    global kept,blurred
    tpl=next(x for a,b,x in heads if a<=tpl_t<b)
    fr=Image.frombuffer('RGB',(720,1608),allf[k])
    if moving(k) and not (k==S): fr=fr.filter(ImageFilter.GaussianBlur(9)); blurred+=1
    fr=fr.resize((SW,SH),Image.LANCZOS)
    img=tpl.copy(); img.paste(fr,(SX,SY),mask); b=img.tobytes()
    for _ in range(times): enc.stdin.write(b); kept+=1
for k in range(len(allf)):
    t=k/30
    if 13.8<=t<14.25 or 22.4<=t<26.5: continue
    if 535<=k<S: emit(S,t); continue
    if k==600: emit(600,t,1+150); continue
    emit(k,t,HOLD+1 if k==HOLD_AT else 1)
enc.stdin.close(); enc.wait(); print('ecrites',kept,'floues',blurred)
