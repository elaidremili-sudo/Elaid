# Planches de vignettes horodatées pour repérer les passages d'une vidéo, ou une image seule en grand.
# python planche.py video.mkv prefixe --every 2 [--start 0 --end 9999 --cols 8 --w 170 --rows 5]
# python planche.py video.mkv image.png --frame 12.5 [--crop x,y,w,h] [--w 540]
import argparse, json, subprocess
from PIL import Image, ImageDraw, ImageFont

def dims(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                          'stream=width,height:format=duration', '-of', 'json', path], capture_output=True, text=True).stdout
    j = json.loads(out)
    return j['streams'][0]['width'], j['streams'][0]['height'], float(j['format'].get('duration', 0))

def fnt(size):
    for p in ['C:/Windows/Fonts/segoeuib.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        try: return ImageFont.truetype(p, size)
        except OSError: pass
    return ImageFont.load_default()

ap = argparse.ArgumentParser()
ap.add_argument('video'); ap.add_argument('out')
ap.add_argument('--every', type=float, default=2); ap.add_argument('--start', type=float, default=0)
ap.add_argument('--end', type=float, default=1e9); ap.add_argument('--cols', type=int, default=8)
ap.add_argument('--rows', type=int, default=5); ap.add_argument('--w', type=int, default=170)
ap.add_argument('--frame', type=float); ap.add_argument('--crop')
a = ap.parse_args()
sw, sh, dur = dims(a.video)
if a.frame is not None:
    vf = []
    if a.crop:
        x, y, w, h = map(int, a.crop.split(',')); vf.append('crop=%d:%d:%d:%d' % (w, h, x, y))
    vf.append('scale=%d:-2' % a.w)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(a.frame), '-i', a.video, '-frames:v', '1',
                    '-vf', ','.join(vf), a.out], check=True)
    print(a.out, 'source %dx%d, durée %.1f s' % (sw, sh, dur)); raise SystemExit
end = min(a.end, dur)
th = int(sh * a.w / sw) // 2 * 2
p = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', str(a.start), '-to', str(end), '-i', a.video,
                      '-vf', 'fps=1/%g,scale=%d:%d' % (a.every, a.w, th), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                     stdout=subprocess.PIPE)
n = a.w * th * 3; imgs = []
while True:
    b = p.stdout.read(n)
    if len(b) < n: break
    imgs.append(Image.frombuffer('RGB', (a.w, th), b))
f = fnt(18); per = a.cols * a.rows; pages = []
for pg in range(0, len(imgs), per):
    chunk = imgs[pg:pg + per]; rows = (len(chunk) + a.cols - 1) // a.cols
    sheet = Image.new('RGB', (a.cols * (a.w + 6), rows * (th + 30)), (30, 30, 30)); d = ImageDraw.Draw(sheet)
    for i, im in enumerate(chunk):
        x, y = (i % a.cols) * (a.w + 6), (i // a.cols) * (th + 30)
        sheet.paste(im, (x, y + 28))
        t = a.start + (pg + i) * a.every
        d.text((x + 4, y + 3), '%d:%04.1f' % (t // 60, t % 60), font=f, fill=(255, 220, 80))
    name = '%s_%02d.png' % (a.out, pg // per + 1); sheet.save(name); pages.append(name)
print('source %dx%d, durée %.1f s, %d vignettes' % (sw, sh, dur, len(imgs)), *pages)
