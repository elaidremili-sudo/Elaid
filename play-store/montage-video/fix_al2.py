import subprocess
from PIL import Image,ImageFilter
SRC='motoroute-demo-sms-v6.mp4'; OUT='motoroute-demo-sms-v7.mp4'
X0,Y0,X1,Y1=543,1046,580,1078
win=[(59.45,65.85),(69.2,73.05)]
dec=subprocess.Popen(['ffmpeg','-v','error','-i',SRC,'-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
enc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1080x1920','-r','30','-i','-','-c:v','libx264','-preset','veryfast','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',OUT],stdin=subprocess.PIPE)
n=1080*1920*3; f=0; k=0
while True:
    b=dec.stdout.read(n)
    if len(b)<n: break
    t=f/30
    if any(a<=t<=z for a,z in win):
        img=Image.frombuffer('RGB',(1080,1920),b).copy()
        c=img.crop((X0,Y0,X1,Y1)); c=c.resize((4,3)).resize((X1-X0,Y1-Y0),Image.NEAREST).filter(ImageFilter.GaussianBlur(4)); img.paste(c,(X0,Y0)); b=img.tobytes(); k+=1
    enc.stdin.write(b); f+=1
enc.stdin.close(); enc.wait(); print('images',f,'masquées',k)
