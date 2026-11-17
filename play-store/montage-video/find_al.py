import json,re,sys,time
from multiprocessing import Pool
from PIL import Image,ImageOps
import pytesseract
def scan(g):
    W,H=g.size; d=pytesseract.image_to_data(g.resize((W*2,H*2)),config='--psm 11',output_type=pytesseract.Output.DICT)
    toks=[(t.strip(),x//2,y//2,(x+w)//2,(y+h)//2) for t,x,y,w,h in zip(d['text'],d['left'],d['top'],d['width'],d['height']) if t.strip()]
    out=[]
    for t,x0,y0,x1,y1 in toks:
        k=re.sub(r'[^a-z0-9]','',t.lower())
        if k in ('al','ai','a1','ail','all'): out.append((x0,y0,x1,y1))
    return out
def ocr(i):
    im=Image.open('o3/o_%05d.png'%(i+1)).convert('L').resize((720,1608))
    return i,scan(ImageOps.invert(im))+scan(im)
if __name__=='__main__':
    sb=json.load(open('boxes_p3.json'))
    idx=[i for i in range(len(sb)) if any(sb[j] for j in range(max(0,i-3),min(len(sb),i+4)))]
    if len(sys.argv)>1: idx=idx[:int(sys.argv[1])]
    t=time.time()
    with Pool(2) as P: r=P.map(ocr,idx,chunksize=4)
    json.dump({i:b for i,b in r if b},open('al_boxes.json','w'))
    print(len(idx),'images',sum(1 for i,b in r if b),'avec Al',round(time.time()-t),'s')
