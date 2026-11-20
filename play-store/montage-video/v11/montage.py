# Montage de la vidéo Google Play (SEND_SMS) à partir des enregistrements scrcpy.
# Usage : python montage.py plan.json sortie.mp4
# Le plan décrit des segments (source, entrée, sortie, vitesse, gels, titres, flous) et des cartons.
import json, os, subprocess, sys, tempfile, shutil
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, FPS = 1080, 1920, 30
HEAD_H = 404
PH_TOP, PH_BOT = 424, 1890          # zone du téléphone
BG_TOP, BG_BOT = (14, 14, 20), (24, 24, 33)
YELLOW, DARK = (254, 199, 60), (20, 16, 8)
GREY = (196, 194, 206)

FONT_CANDIDATES = {
    'badge': ['C:/Windows/Fonts/segoeuib.ttf', '/usr/share/fonts/opentype/inter/Inter-Bold.otf'],
    'title': ['C:/Windows/Fonts/seguibl.ttf', 'C:/Windows/Fonts/segoeuib.ttf', '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'],
    'sub':   ['C:/Windows/Fonts/segoeui.ttf', '/usr/share/fonts/opentype/inter/Inter-Regular.otf'],
}
try:
    import ocrwin as OCR
    OCR.NAMES |= {'papa', 'oulad', 'meziane', 'guettar', 'mazouna', 'sidi', 'abdullah', 'mosquée', 'remili'}
except Exception:
    OCR = None

def font(kind, size):
    for p in FONT_CANDIDATES[kind]:
        if os.path.exists(p): return ImageFont.truetype(p, size)
    raise SystemExit('police introuvable : ' + kind)

def ff(args, **kw):
    return subprocess.run(['ffmpeg', '-v', 'error', '-y'] + args, check=True, **kw)

def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height',
                          '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    st = json.loads(out)['streams']
    v = next(s for s in st if s['codec_type'] == 'video')
    return v['width'], v['height'], any(s['codec_type'] == 'audio' for s in st)

def background():
    im = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(im)
    for y in range(H):
        k = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(int(a + (b - a) * k) for a, b in zip(BG_TOP, BG_BOT)))
    return im
BG = background()

def wrap(text, f, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if f.getlength(t) > width and cur: lines.append(cur); cur = w
        else: cur = t
    if cur: lines.append(cur)
    return lines

def header(badge, label, title, sub):
    im = BG.copy(); d = ImageDraw.Draw(im)
    bf = font('badge', 27); x, y, h = 60, 64, 50
    if badge:
        tw = bf.getlength(badge)
        d.rounded_rectangle([x, y, x + tw + 40, y + h], radius=25, fill=YELLOW)
        d.text((x + 20, y + h / 2), badge, font=bf, fill=DARK, anchor='lm'); x += tw + 56
    if label:
        tw = bf.getlength(label)
        d.rounded_rectangle([x, y, x + tw + 40, y + h], radius=25, outline=(120, 118, 132), width=2)
        d.text((x + 20, y + h / 2), label, font=bf, fill=(230, 228, 236), anchor='lm')
    tf = font('title', 54); yy = 197
    for l in wrap(title, tf, W - 120)[:2]:
        d.text((60, yy), l, font=tf, fill=(255, 255, 255), anchor='ls'); yy += 60
    sf = font('sub', 37); yy -= 4
    lines = [l for s in sub for l in wrap(s, sf, W - 110)]
    if len(lines) > 3: raise SystemExit('sous-titre trop long (%d lignes) : %s' % (len(lines), ' '.join(sub)))
    for l in lines:
        d.text((60, yy), l, font=sf, fill=(226, 224, 234), anchor='ls'); yy += 47
    return im

def card(lines):
    """Carton plein écran : [(texte, 'title'|'sub'|'badge'), ...]"""
    im = BG.copy(); d = ImageDraw.Draw(im)
    blocks = []
    for text, kind in lines:
        f = font(kind if kind != 'badge' else 'badge', {'title': 76, 'sub': 44, 'badge': 38}[kind])
        for i, l in enumerate(wrap(text, f, W - 140)): blocks.append((l, f, kind, i == 0))
    step = lambda k, first: (92 if k == 'title' else 58) + (34 if first else 0)
    total = sum(step(k, fi) for _, _, k, fi in blocks)
    y = (H - total) // 2
    for l, f, k, fi in blocks:
        if fi: y += 34
        col = {'title': (255, 255, 255), 'sub': (226, 224, 234), 'badge': YELLOW}[k]
        d.text((W // 2, y), l, font=f, fill=col, anchor='mt'); y += 92 if k == 'title' else 58
    return im

def fit(sw, sh):
    """Taille de l'écran affiché dans la zone téléphone (rapport conservé, largeur paire)."""
    mh, mw = PH_BOT - PH_TOP, W - 120
    s = min(mh / sh, mw / sw)
    return int(sw * s) // 2 * 2, int(sh * s) // 2 * 2

def blur(img, boxes):
    for bx in boxes:
        x0, y0, x1, y1 = bx[:4]; blk = bx[4] if len(bx) > 4 else 14; m = 0 if blk > 14 else 1
        x0, y0, x1, y1 = max(0, x0 - 8 * m), max(0, y0 - 10 * m), min(img.width, x1 + 8 * m), min(img.height, y1 + 10 * m)
        if x1 - x0 < 2 or y1 - y0 < 2: continue
        c = img.crop((x0, y0, x1, y1))
        c = c.resize((max(1, (x1 - x0) // blk), max(1, (y1 - y0) // blk)), Image.BILINEAR)
        c = c.resize((x1 - x0, y1 - y0), Image.NEAREST).filter(ImageFilter.GaussianBlur(max(6, blk // 2)))
        img.paste(c, (x0, y0))

def segment_frames(src, a, b, speed, crop, size):
    """Images du segment, une par une. scrcpy n'enregistre une image que quand l'écran change :
    on reconstitue d'abord une cadence fixe sur le temps d'origine (fps puis trim), sinon un saut
    à l'instant a tomberait sur l'image suivante et décalerait tout le plan."""
    vf = ['fps=%d' % FPS, 'trim=start=%.3f:end=%.3f' % (a, b), 'setpts=(PTS-STARTPTS)/%g' % speed, 'fps=%d' % FPS]
    if crop: vf.append('crop=%d:%d:%d:%d' % (crop[2], crop[3], crop[0], crop[1]))
    vf.append('scale=%d:%d:flags=lanczos' % size)
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', '%.3f' % max(0, a - 40), '-noaccurate_seek', '-copyts', '-i', src,
                          '-vf', ','.join(vf), '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    n = size[0] * size[1] * 3
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n: break
        yield buf
    p.kill(); p.wait()

def build(plan_path, out_path):
    plan = json.load(open(plan_path, encoding='utf-8'))
    srcs = {k: (v, *probe(v)) for k, v in plan['sources'].items()}
    use_audio = plan.get('audio', True)
    tmp = tempfile.mkdtemp(prefix='montage_')
    vid = os.path.join(tmp, 'video.mp4')
    enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, H),
                            '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
                            '-pix_fmt', 'yuv420p', vid], stdin=subprocess.PIPE)
    audio_parts, t_out, log = [], 0.0, []
    for si, seg in enumerate(plan['segments']):
        if 'card' in seg:
            fr = card(seg['card']).tobytes(); n = round(seg['dur'] * FPS)
            for _ in range(n): enc.stdin.write(fr)
            audio_parts.append(('sil', n / FPS)); log.append((round(t_out, 2), 'carton', seg['card'][0][0]))
            t_out += n / FPS; continue
        path, sw, sh, has_a = srcs[seg['src']]
        a, b, sp = seg['in'], seg['out'], seg.get('speed', 1.0)
        crop = seg.get('crop')
        cw, ch = (crop[2], crop[3]) if crop else (sw, sh)
        size = fit(cw, ch); kx, ky = size[0] / cw, size[1] / ch
        ox, oy = (W - size[0]) // 2, PH_TOP + (PH_BOT - PH_TOP - size[1]) // 2
        mask = Image.new('L', size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=34, fill=255)
        gen = segment_frames(path, a, b, sp, crop, size)
        subs = seg.get('subs') or [[a, b + 1, seg.get('sub', [])]]
        heads = {}
        def head_for(ts):
            i = next((i for i, s in enumerate(subs) if s[0] <= ts < s[1]), len(subs) - 1)
            if i not in heads:
                im = header(seg.get('badge', ''), seg.get('label', ''), seg.get('title', ''), subs[i][2])
                ImageDraw.Draw(im).rounded_rectangle([ox - 3, oy - 3, ox + size[0] + 2, oy + size[1] + 2], radius=37,
                                                     outline=(70, 70, 84), width=3)
                heads[i] = im
            return heads[i]
        freezes = {round((t - a) / sp * FPS): d for t, d in seg.get('freeze', [])}
        boxes = seg.get('blur', [])
        def to_disp(bb):
            x0, y0 = bb[0] - (crop[0] if crop else 0), bb[1] - (crop[1] if crop else 0)
            return (int(x0 * kx), int(y0 * ky), int((x0 + bb[2]) * kx), int((y0 + bb[3]) * ky))
        # floutage automatique : OCR Windows relancé dès que l'écran bouge (sinon toutes les 6 images),
        # zones gardées ±2 images ; pendant un défilement chaque image est donc relue
        pending, ocr, st = {}, {}, {'n': 0, 'done': False, 'zones': 0, 'last': None, 'lastk': -99, 'boxes': []}
        def read_one():
            b2 = next(gen, None)
            if b2 is None: st['done'] = True; return
            k2 = st['n']; pending[k2] = b2; st['n'] += 1
            if not (seg.get('ocr', True) and OCR): return
            im = Image.frombuffer('RGB', size, b2)
            small = im.convert('L').resize((54, 120))
            moved = st['last'] is None or sum(abs(p - q) for p, q in zip(small.getdata(), st['last'].getdata())) / 6480 > 0.6
            if moved or k2 - st['lastk'] >= 6:
                st['boxes'] = [tuple(int(v) for v in q) for q in OCR.sensitive(im)]
                st['last'], st['lastk'] = small, k2; st['zones'] += len(st['boxes'])
            ocr[k2] = st['boxes']
        nfr, k = 0, 0
        while True:
            while not st['done'] and st['n'] <= k + 3: read_one()
            if k not in pending: break
            buf = pending.pop(k); last = st['done'] and (k + 1) not in pending
            ts = a + k * sp / FPS
            fr = Image.frombuffer('RGB', size, buf)
            bx = [q for j in range(k - 2, k + 3) for q in ocr.get(j, [])]
            ocr.pop(k - 3, None)
            for bb in boxes:
                t0, t1 = (bb[4], bb[5]) if len(bb) >= 6 else (a, b + 1)
                if t0 <= ts < t1: bx.append(to_disp(bb) + ((bb[6],) if len(bb) >= 7 else ()))
            marks = [to_disp(m) for m in seg.get('marks', []) if m[4] <= ts < m[5]]
            if bx or marks: fr = fr.copy()
            keep = [(to_disp(kp), fr.crop(to_disp(kp))) for kp in seg.get('keep', [])] if bx else []
            if bx: blur(fr, bx)
            for (x0, y0, x1, y1), piece in keep: fr.paste(piece, (x0, y0))
            if marks:
                dm = ImageDraw.Draw(fr)
                for x0, y0, x1, y1 in marks:
                    dm.rounded_rectangle([x0 - 12, y0 - 12, x1 + 12, y1 + 12], radius=20, outline=(18, 18, 26), width=12)
                    dm.rounded_rectangle([x0 - 9, y0 - 9, x1 + 9, y1 + 9], radius=17, outline=YELLOW, width=6)
            img = head_for(ts).copy(); img.paste(fr, (ox, oy), mask); raw = img.tobytes()
            rep = 1 + round(freezes.get(k, 0) * FPS)
            if last: rep += round(seg.get('hold', 0) * FPS)
            for _ in range(rep): enc.stdin.write(raw)
            nfr += rep; k += 1
        nocr = st['zones']; nsrc = k
        # audio du segment : lecture, gels et maintien final en silence
        dur_play = nsrc / FPS
        if use_audio and has_a and sp == 1.0:
            pts = sorted((round((t - a) / sp * FPS) / FPS, d) for t, d in seg.get('freeze', []))
            cur = 0.0
            for p, d in pts:
                audio_parts.append(('cut', path, a + cur, a + p + 1 / FPS)); audio_parts.append(('sil', d)); cur = p + 1 / FPS
            audio_parts.append(('cut', path, a + cur, a + dur_play))
            audio_parts.append(('sil', seg.get('hold', 0)))
        else:
            audio_parts.append(('sil', nfr / FPS))
        log.append((round(t_out, 2), seg.get('badge', ''), seg.get('title', ''), '%d images' % nfr, 'ocr %d zones' % nocr))
        print(*log[-1], flush=True)
        t_out += nfr / FPS
    enc.stdin.close(); enc.wait()
    # assemblage audio
    wavs = []
    for i, part in enumerate(audio_parts):
        wv = os.path.join(tmp, 'a%04d.wav' % i)
        if part[0] == 'sil':
            if part[1] <= 0: continue
            ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '%.4f' % part[1], wv])
        else:
            _, path, s, e = part
            if e - s <= 0.01: continue
            d = e - s
            ff(['-ss', '%.4f' % s, '-t', '%.4f' % d, '-i', path, '-vn', '-ac', '2', '-ar', '48000',
                '-af', 'apad,atrim=0:%.4f,afade=t=in:d=0.02,afade=t=out:st=%.4f:d=0.03' % (d, max(0, d - 0.03)), wv])
        wavs.append(wv)
    lst = os.path.join(tmp, 'a.txt')
    with open(lst, 'w') as f:
        for wv in wavs: f.write("file '%s'\n" % wv.replace('\\', '/'))
    aud = os.path.join(tmp, 'audio.wav')
    ff(['-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', aud])
    ff(['-i', vid, '-i', aud, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
        '-shortest', '-movflags', '+faststart', out_path])
    shutil.rmtree(tmp, ignore_errors=True)
    print('durée totale %.1f s' % t_out)

if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2])
