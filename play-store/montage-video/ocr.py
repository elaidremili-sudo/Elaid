import re,sys,pytesseract
from PIL import Image,ImageOps
PAT_NUM=re.compile(r'\d{3,}')
EMAIL=re.compile(r'\S+@\S+\.\S+')
NAMES=('ali','elaid','elaidremili','zyw853')
def _scan(g):
    W,H=g.size
    d=pytesseract.image_to_data(g.resize((W*2,H*2)),config='--psm 11',output_type=pytesseract.Output.DICT)
    out=[]
    for t,x,y,w,h in zip(d['text'],d['left'],d['top'],d['width'],d['height']):
        s=t.strip()
        if not s: continue
        k=re.sub(r'[^a-z0-9]','',s.lower())
        if PAT_NUM.search(s) or EMAIL.search(s) or k in NAMES or (k.startswith('elaid')) or (k.startswith('ali') and len(k)<=5) or k.startswith('zyw'):
            out.append((x//2,y//2,(x+w)//2,(y+h)//2,s))
    return out
def boxes(img,boost=True):
    g=img.convert('L')
    out=_scan(ImageOps.invert(g))
    if boost:
        out+=_scan(ImageOps.invert(g.point(lambda v:min(255,v*3))))
        out+=_scan(ImageOps.invert(g.point(lambda v:min(255,v*8))))
    return out
if __name__=='__main__':
    print(boxes(Image.open(sys.argv[1])))
