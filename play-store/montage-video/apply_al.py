import json,subprocess
from PIL import Image,ImageFilter
SX,SY,SW=218,410,644; sc=SW/720
al={int(k):v for k,v in json.load(open('al_boxes.json')).items()}
SRC='motoroute-demo-sms-v5.mp4'; OUT='motoroute-demo-sms-v6.mp4'
def p3_index(f):  # image finale -> image de p3 (30 i/s)
    t=f/30-38.9
    if t<0: return []
    if t<53.1: return [round(t*30)]
    if t<53.4: return [round(t*30), round((t+1.5)*30)]
    return [round((t+1.5)*30)]
dec=subprocess.Popen(['ffmpeg','-v','error','-i',SRC,'-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
enc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1080x1920','-r','30','-i','-','-c:v','libx264','-preset','veryfast','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',OUT],stdin=subprocess.PIPE)
n=1080*1920*3; f=0; nb=0
while True:
    buf=dec.stdout.read(n)
    if len(buf)<n: break
    img=Image.frombuffer('RGB',(1080,1920),buf).copy()
    for p in p3_index(f):
        for j in range(p-3,p+4):
            for x0,y0,x1,y1 in al.get(j,[]):
                X0=int(SX+max(0,x0-10)*sc); Y0=int(SY+max(0,y0-8)*sc); X1=int(SX+min(720,x1+10)*sc); Y1=int(SY+min(1608,y1+8)*sc)
                c=img.crop((X0,Y0,X1,Y1)); c=c.resize((max(1,(X1-X0)//10),max(1,(Y1-Y0)//10))).resize((X1-X0,Y1-Y0),Image.NEAREST).filter(ImageFilter.GaussianBlur(4)); img.paste(c,(X0,Y0)); nb+=1
    enc.stdin.write(img.tobytes()); f+=1
enc.stdin.close(); enc.wait(); print('images',f,'zones',nb)
