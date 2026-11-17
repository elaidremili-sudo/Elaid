import subprocess
from PIL import Image,ImageFilter
SRC='motoroute-demo-sms-v7.mp4'; OUT='motoroute-demo-sms-v8.mp4'
M=[(38.85,40.55,(552,1044,34,34)),   # « Al » contact
   (81.85,86.80,(398,492,86,46)),    # « L » entre les pavés
   (81.85,86.80,(318,496,64,64)),    # avatar A
   (87.45,90.40,(762,509,61,61)),    # avatar E
   (87.45,90.40,(550,1084,94,42))]   # étiquette Travail
dec=subprocess.Popen(['ffmpeg','-v','error','-i',SRC,'-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
enc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1080x1920','-r','30','-i','-','-c:v','libx264','-preset','veryfast','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',OUT],stdin=subprocess.PIPE)
n=1080*1920*3; f=0; k=0
while True:
    b=dec.stdout.read(n)
    if len(b)<n: break
    t=f/30; act=[r for a,z,r in M if a<=t<=z]
    if act:
        img=Image.frombuffer('RGB',(1080,1920),b).copy()
        for x,y,w,h in act:
            c=img.crop((x,y,x+w,y+h)); c=c.resize((max(1,w//10),max(1,h//10))).resize((w,h),Image.NEAREST).filter(ImageFilter.GaussianBlur(5)); img.paste(c,(x,y)); k+=1
        b=img.tobytes()
    enc.stdin.write(b); f+=1
enc.stdin.close(); enc.wait(); print('images',f,'masques',k)
