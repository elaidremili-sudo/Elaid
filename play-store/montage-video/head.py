from PIL import Image,ImageDraw,ImageFont
import numpy as np
F='/usr/share/fonts/opentype/inter/'
BG=Image.open('full_1.png').convert('RGB').crop((0,0,1080,404))
def fit(text,font_file,width):
    for s in range(20,90):
        f=ImageFont.truetype(F+font_file,s)
        if f.getlength(text)>width: return s-1
def header(badge,title_lines,sub_lines,P):
    im=BG.copy(); d=ImageDraw.Draw(im)
    bf=ImageFont.truetype(F+P['bfont'],P['bsize'])
    tw=bf.getlength(badge); x0,y0=60,64; h=50
    d.rounded_rectangle([x0,y0,x0+tw+2*P['bpad'],y0+h],radius=25,fill=(254,199,60))
    d.text((x0+P['bpad'],y0+h/2),badge,font=bf,fill=(20,16,8),anchor='lm')
    tf=ImageFont.truetype(F+P['tfont'],P['tsize']); y=P['ty']
    for l in title_lines: d.text((60,y),l,font=tf,fill=(255,255,255),anchor='ls'); y+=P['tlh']
    sf=ImageFont.truetype(F+P['sfont'],P['ssize']); y+=P['sgap']
    for l in sub_lines: d.text((60,y),l,font=sf,fill=tuple(P['scol']),anchor='ls'); y+=P['slh']
    return im
if __name__=='__main__':
    ref=np.asarray(Image.open('full_6.png').convert('RGB').crop((0,0,1080,404))).astype(int)
    print('titre taille',fit('Crash detection is off by default','Inter-Bold.otf',850),fit('Crash detection is off by default','Inter-ExtraBold.otf',850))
    print('sous-titre',fit('The rider turns it on. MotoRoute explains the SMS use first,','Inter-Regular.otf',930))
    print('badge',fit('STEP 1 OF 9','Inter-Bold.otf',150))
