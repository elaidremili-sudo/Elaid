import subprocess,re,json,glob,os,shutil
import numpy as np
from multiprocessing import Pool
from PIL import Image,ImageFilter
import pytesseract
from PIL import ImageOps
SX,SY,SW,SH=218,410,644,1438
SRC='p3.mp4'; OUT='p3_flou.mp4'
NAMES=('elaid','remili','patron','zyw','zina','ali','sofiane')
def hit(s):
    k=re.sub(r'[^a-z0-9]','',s.lower())
    if any(n in k for n in NAMES if n!='ali') : return True
    if k in ('ali','alil','ali·') or (k.startswith('ali') and len(k)<=5): return True
    if re.search(r'(?<![\d.,])\d{8,}(?![\d.,])',s) or re.search(r'0[5-7]\d{5,}',s): return True
    return False
def scan(g):
    W,H=g.size; d=pytesseract.image_to_data(g.resize((W*2,H*2)),config='--psm 11',output_type=pytesseract.Output.DICT)
    return [(x//2,y//2,(x+w)//2,(y+h)//2) for t,x,y,w,h in zip(d['text'],d['left'],d['top'],d['width'],d['height']) if t.strip() and hit(t.strip())]
def ocr(p):
    im=Image.open(p).convert('L').resize((720,1608))
    out=scan(ImageOps.invert(im))+scan(ImageOps.invert(im.point(lambda v:min(255,v*3))))+scan(im)
    return out
if __name__=='__main__':
    shutil.rmtree('o3',ignore_errors=True); os.makedirs('o3')
    subprocess.run(['ffmpeg','-v','error','-i',SRC,'-vf',f'fps=30,crop={SW}:{SH}:{SX}:{SY}','o3/o_%05d.png'],check=True)
    fs=sorted(glob.glob('o3/o_*.png'))
    with Pool(2) as P: sb=P.map(ocr,fs,chunksize=8)
    json.dump(sb,open('boxes_p3.json','w')); print('ocr fini',len(fs),sum(len(b) for b in sb),flush=True)
    raw=subprocess.run(['ffmpeg','-v','error','-i',SRC,'-vf',f'fps=30,crop={SW}:{SH}:{SX}:{SY},scale=90:200','-f','rawvideo','-pix_fmt','gray','-'],capture_output=True).stdout
    g=np.frombuffer(raw,np.uint8).reshape(-1,200,90).astype(int); N=len(g)
    dd=[0]+[abs(g[k]-g[k-1]).mean() for k in range(1,N)]+[0]
    dec=subprocess.Popen(['ffmpeg','-v','error','-i',SRC,'-vf','fps=30','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
    enc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1080x1920','-r','30','-i','-','-c:v','libx264','-preset','veryfast','-crf','16','-pix_fmt','yuv420p',OUT],stdin=subprocess.PIPE)
    n=1080*1920*3; i=0; nb=0; mv=0; sc=SW/720
    while True:
        buf=dec.stdout.read(n)
        if len(buf)<n: break
        img=Image.frombuffer('RGB',(1080,1920),buf).copy()
        bx=[q for j in range(max(0,i-3),min(len(sb),i+4)) for q in sb[j]]
        for x0,y0,x1,y1 in bx:
            X0=int(SX+max(0,x0-12)*sc); Y0=int(SY+max(0,y0-9)*sc); X1=int(SX+min(720,x1+12)*sc); Y1=int(SY+min(1608,y1+9)*sc)
            if X1<=X0 or Y1<=Y0: continue
            c=img.crop((X0,Y0,X1,Y1)); c=c.resize((max(1,(X1-X0)//12),max(1,(Y1-Y0)//12))).resize((X1-X0,Y1-Y0),Image.NEAREST).filter(ImageFilter.GaussianBlur(4)); img.paste(c,(X0,Y0)); nb+=1
        if i<N and (dd[i]>3 or dd[min(i+1,N)]>3):
            r=img.crop((SX,SY,SX+SW,SY+SH)).filter(ImageFilter.GaussianBlur(9)); img.paste(r,(SX,SY)); mv+=1
        enc.stdin.write(img.tobytes()); i+=1
    enc.stdin.close(); enc.wait(); print('fini images',i,'zones',nb,'mouvement',mv,flush=True)
