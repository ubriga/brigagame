#!/usr/bin/env python3
"""Brigagame 'Clockwork Towers' (D2) sprite generator v3 - mockup-derived painterly art.
Backgrounds, portholes, gears and airship are extracted from the APPROVED D2 mockup
(dir-d2-clockwork.png, the user's visual yardstick), cleaned of game UI by masked
inpainting, then re-sliced into game sprites. Blocks/trim are PIL-rendered to match
the mockup's patina+brass language. Same sprite names/sizes as v1/v2.
Usage: python3 gfx_clockwork.py [path-to-mockup.png]
Output: cloud/public/assets/gfx/clockwork/.
"""
import math, os, random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageOps

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "gfx", "clockwork")
os.makedirs(OUT, exist_ok=True)
MOCKUP = sys.argv[1] if len(sys.argv) > 1 else "/downloads/dir-d2-clockwork.png"

PAT_HI=(94,158,140,255); PAT_MID=(58,108,96,255); PAT_LO=(34,66,60,255); PAT_DK=(20,40,38,255)
BRASS_HI=(240,200,130,255); BRASS_MID=(190,148,82,255); BRASS_LO=(122,90,46,255); BRASS_DK=(62,44,22,255)
COPPER=(196,118,54,255); GLOW_WARM=(255,190,92,255)
P1=(56,189,248,255); P2=(251,113,133,255)
S = 52

# ---------- generic helpers ----------
def vgrad(size, top, bottom):
    w,h = size; img = Image.new("RGBA", size); d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h-1)
        d.line([(0,y),(w,y)], fill=tuple(int(top[i]+(bottom[i]-top[i])*t) for i in range(4)))
    return img

def radial(size, inner, outer, cx=None, cy=None, rmax=None):
    w,h = size
    cx = w/2 if cx is None else cx; cy = h/2 if cy is None else cy
    rmax = rmax or math.hypot(w,h)/2
    img = Image.new("RGBA", size); px = img.load()
    for y in range(h):
        for x in range(w):
            t = min(1.0, math.hypot(x-cx, y-cy)/rmax)
            px[x,y] = tuple(int(inner[i]+(outer[i]-inner[i])*t) for i in range(4))
    return img

def patina_noise(size, seed, n=90, tones=((16,42,38),(120,190,165),(150,110,60))):
    rnd = random.Random(seed); w,h = size
    img = Image.new("RGBA", size, (0,0,0,0)); d = ImageDraw.Draw(img)
    for _ in range(n):
        t = tones[rnd.randrange(len(tones))]; a = rnd.randint(14,42)
        r = rnd.randint(3, max(4, w//6)); x,y = rnd.randint(-r,w), rnd.randint(-r,h)
        d.ellipse([x-r,y-r,x+r,y+r], fill=(t[0],t[1],t[2],a))
    return img.filter(ImageFilter.GaussianBlur(2))

def cyl_shade(size, edge=70, spec=54):
    w,h = size
    ov = Image.new("RGBA", size, (0,0,0,0)); px = ov.load()
    for x in range(w):
        t = x/(w-1); dark = int(edge*(abs(t-0.42)/0.58)**1.7)
        for y in range(h): px[x,y] = (8,14,12,max(0,dark))
    band = Image.new("RGBA", size, (0,0,0,0)); bd = ImageDraw.Draw(band)
    bx = int(w*0.30)
    bd.rectangle([bx-w//10, 0, bx+w//10, h], fill=(235,255,245,spec))
    return Image.alpha_composite(ov, band.filter(ImageFilter.GaussianBlur(w//8)))

def rivet(d, x, y, r=3):
    d.ellipse([x-r,y-r,x+r,y+r], fill=BRASS_LO, outline=BRASS_DK)
    d.ellipse([x-r+1,y-r+1,x+r-2,y+r-2], fill=BRASS_HI)
    d.point((x-1,y-1), fill=(255,250,225,255))

def brass_frame(d, w, h, width=5, rad=7):
    d.rounded_rectangle([1,1,w-2,h-2], rad, outline=BRASS_DK, width=width+2)
    d.rounded_rectangle([2,2,w-3,h-3], rad, outline=BRASS_MID, width=width)
    d.line([(4,3),(w-5,3)], fill=BRASS_HI, width=1)
    d.line([(3,h-4),(w-4,h-4)], fill=(30,20,10,160), width=1)
    for x,y in [(8,8),(w-8,8),(8,h-8),(w-8,h-8)]: rivet(d, x, y, 2)

def feather_circle(size, r, feather=2, cx=None, cy=None):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    cx = size[0]/2 if cx is None else cx; cy = size[1]/2 if cy is None else cy
    d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=255)
    return m.filter(ImageFilter.GaussianBlur(feather))

# ---------- mockup scene preparation (UI removal) ----------
def prepare_scene():
    m = Image.open(MOCKUP).convert("RGB")
    W,H = m.size
    sc = 1460/1255.0  # mockup displayed 1429 wide in review; native may differ -> derive battle crop by ratio
    # battle interior in native coords (verified on 1672x941): x[100,1560], y[185,870]
    scene = m.crop((100, 185, 1560, 870))
    w,h = scene.size
    sp = scene.load()
    mask = Image.new("L", (w,h), 0); mp = mask.load()
    for y in range(h):
        for x in range(w):
            r,g,b = sp[x,y]
            if r>185 and g>135 and b<140 and r>b+65 and g>b+35:
                mp[x,y] = 255
    d = ImageDraw.Draw(mask)
    d.rectangle([180,262,395,300], fill=255)   # left HP bar
    d.rectangle([1105,262,1315,300], fill=255) # right HP bar
    d.ellipse([740,470,880,610], fill=255)     # explosion core
    d.ellipse([50,15,245,100], fill=255)       # airship (becomes separate sprite)
    for bx,by,br in [(488,208,60),(588,192,60),(992,222,66),(980,260,66),(475,117,60),(625,110,60),(1000,125,66)]:
        d.ellipse([bx-br,by-br,bx+br,by+br], fill=255)  # projectile glow remnants
    d.ellipse([40, 5, 260, 115], fill=255)   # airship zone, generous
    # second + third sweep for arc ghosts (bright and diluted) in the sky band
    for y in range(0, 200):
        for x in range(w):
            r,g,b = sp[x,y]
            if (r>150 and g>110 and b<160 and r>b+45) or (r>110 and r>b+25 and g>b+10):
                mp[x,y] = 255
    for y in range(60, 190):      # targeted ghost band (clouds are blue-dominant, safe)
        for x in range(250, 1000):
            r,g,b = sp[x,y]
            if r>95 and r>=g-6 and g>b+4:
                mp[x,y] = 255
    mask = mask.filter(ImageFilter.MaxFilter(11))
    # protect the moon AFTER dilation so it is never inpainted
    mp = mask.load()
    for y in range(0, 145):
        for x in range(1020, 1205):
            mp[x,y] = 0
    clean = scene.copy()
    for _ in range(24):
        clean = Image.composite(clean.filter(ImageFilter.GaussianBlur(4)), clean, mask)
    return clean, scene

# ---------- extracted sprites ----------
def bg_sky(scene):
    # pure sky only: moon, clouds, stars (everything below scene y=190 risks UI/towers)
    sky = scene.crop((0, 0, 1460, 190)).resize((1000, 240), Image.LANCZOS)
    # full-canvas gradient from mid-sky tone to haze, painterly sky feathered over it
    mid = sky.crop((0, 150, 1000, 190)).filter(ImageFilter.GaussianBlur(40)).resize((1, 1)).getpixel((0, 0))
    haze = (78, 96, 128)
    img = Image.new("RGB", (1000, 560))
    d = ImageDraw.Draw(img)
    for y in range(560):
        t = max(0.0, (y - 170) / 390)
        c = tuple(int(mid[i] + (haze[i] - mid[i]) * min(1, t)) for i in range(3))
        d.line([(0, y), (1000, y)], fill=c)
    feather = Image.new("L", (1000, 240), 255)
    fd = ImageDraw.Draw(feather)
    for y in range(150, 240):
        fd.line([(0, y), (1000, y)], fill=int(255 * (240 - y) / 90))
    img.paste(sky, (0, 0), feather)
    return img.filter(ImageFilter.GaussianBlur(1))

def ridge_alpha(size, src):
    """per-column mountain ridge detection -> alpha mask"""
    w,h = size
    gray = src.convert("L"); gp = gray.load()
    m = Image.new("L", size, 0); mp = m.load()
    for x in range(w):
        run = 0; top = h
        for y in range(h):
            if gp[x,y] < 88:
                run += 1
                if run >= 3:
                    top = y-2; break
            else:
                run = 0
        for y in range(top, h): mp[x,y] = 255
    return m.filter(ImageFilter.GaussianBlur(2))

def bg_far(scene):
    band = scene.crop((430, 140, 1040, 430))          # mountains+castles+viaduct, no side cliffs
    bw = band.width
    pal = Image.new("RGB", (bw*2, 300))
    pal.paste(band, (0,0)); pal.paste(band.transpose(Image.FLIP_LEFT_RIGHT), (bw,0))
    strip = pal.resize((1400, 200), Image.LANCZOS)
    alpha = ridge_alpha((1400, 200), strip)
    out = strip.convert("RGBA"); out.putalpha(alpha)
    return out

def bg_near():
    w,h = 1400, 90
    img = Image.new("RGBA", (w,h), (0,0,0,0)); d = ImageDraw.Draw(img)
    d.rectangle([0,26,w,h], fill=(26,24,34,255))
    d.rectangle([0,26,w,31], fill=(52,48,64,255))
    d.line([(0,26),(w,26)], fill=(140,150,180,90), width=1)
    for x in range(0, w, 90):
        d.line([(x,31),(x,h)], fill=(12,11,18,255), width=2)
        for y in (42,62,80): rivet(d, x+8, y, 2)
    for lx in (170, 1180):
        d.rectangle([lx,0,lx+4,30], fill=(14,12,18,255))
        d.polygon([(lx-6,14),(lx+10,14),(lx+8,30),(lx-4,30)], fill=(18,16,24,255), outline=(90,70,40,255))
        gl = radial((40,40), (255,200,110,200), (255,200,110,0), rmax=20)
        img.alpha_composite(gl, (lx-18, 6)); d = ImageDraw.Draw(img)
        d.ellipse([lx-2,17,lx+6,27], fill=(255,224,150,255))
        pool = radial((90,30), (255,190,100,70), (255,190,100,0), rmax=45)
        img.alpha_composite(pool, (lx-43, 34)); d = ImageDraw.Draw(img)
    return img

def airship(scene):
    crop = scene.crop((50, 15, 250, 105)).convert("RGB")
    w,h = crop.size
    gray = crop.convert("L"); gp = gray.load()
    ell = Image.new("L", (w,h), 0)
    ImageDraw.Draw(ell).ellipse([2, 2, w-4, h-30], fill=255)   # hull zone only
    ImageDraw.Draw(ell).rectangle([70, h-34, w-70, h-2], fill=255)  # gondola zone
    ep = ell.load()
    m = Image.new("L", (w,h), 0); mp = m.load()
    for y in range(h):
        for x in range(w):
            if ep[x,y] and gp[x,y] < 104: mp[x,y] = 255
    m = m.filter(ImageFilter.GaussianBlur(1.2))
    out = crop.convert("RGBA"); out.putalpha(m)
    return out.resize((240, 100), Image.LANCZOS)

def porthole(scene, team=None):
    crop = scene.crop((203, 403, 267, 467)).convert("RGB")   # left tower porthole
    crop = crop.point(lambda v: min(255, int(v * 1.32 + 10)))  # lift the glow
    m = feather_circle((64,64), 27, 2)
    out = Image.new("RGBA", (64,64), (0,0,0,0))
    out.paste(crop, (0,0), m)
    d = ImageDraw.Draw(out)
    d.ellipse([5,5,59,59], outline=BRASS_DK, width=2)
    d.arc([8,6,56,54], 150, 300, fill=(255,250,230,180), width=2)  # rim light
    if team:
        tr, tg_, tb, _ = team
        d.ellipse([6,6,58,58], outline=(tr, tg_, tb, 170), width=2)
    return out.resize((S,S), Image.LANCZOS)

def gear_from_mock(scene, diam):
    crop = scene.crop((165, 515, 265, 615)).convert("RGB")   # left tower base gear
    m = feather_circle((100,100), 45, 2)
    out = Image.new("RGBA", (100,100), (0,0,0,0))
    out.paste(crop, (0,0), m)
    return out.resize((diam, diam), Image.LANCZOS)

# ---------- PIL-matched sprites ----------
HULL = None
def block_base(variant):
    img = vgrad((S,S), PAT_HI, PAT_MID)
    if HULL:  # painterly mottling sampled from the mockup tower hull
        patch = HULL.resize((S,S), Image.LANCZOS).convert("RGBA")
        img = Image.blend(img, Image.alpha_composite(img, patch), 0.28)
    img = Image.alpha_composite(img, patina_noise((S,S), seed=hash(variant)&0xffff, n=60))
    d = ImageDraw.Draw(img)
    d.rectangle([0,S-9,S,S], fill=BRASS_LO)
    d.rectangle([0,S-10,S,S-9], fill=BRASS_HI)
    img = Image.alpha_composite(img, cyl_shade((S,S)))
    d = ImageDraw.Draw(img)
    if variant == "b":
        d.line([(3,S//2),(S-3,S//2)], fill=(20,34,30,200), width=2)
        d.line([(3,S//2+2),(S-3,S//2+2)], fill=(200,240,220,60), width=1)
    elif variant == "vent":
        for i in range(3):
            y = 13 + i*9
            d.rounded_rectangle([11,y,S-11,y+6], 3, fill=(16,28,26,255))
            d.line([(12,y+1),(S-12,y+1)], fill=(190,230,210,90), width=1)
            d.line([(12,y+5),(S-12,y+5)], fill=(255,170,80,60), width=1)
    brass_frame(d, S, S)
    return img

def dmg_light():
    img = Image.new("RGBA", (S,S), (0,0,0,0))
    dent = Image.new("RGBA", (S,S), (0,0,0,0))
    ImageDraw.Draw(dent).ellipse([12,16,36,34], fill=(10,16,14,110))
    img = Image.alpha_composite(img, dent.filter(ImageFilter.GaussianBlur(4)))
    d = ImageDraw.Draw(img)
    d.line([(8,10),(22,24)], fill=(22,30,26,220), width=2)
    d.line([(22,24),(18,38)], fill=(22,30,26,180), width=1)
    d.line([(40,8),(32,20)], fill=(22,30,26,190), width=1)
    d.line([(10,9),(20,20)], fill=(220,245,230,70), width=1)
    return img

def dmg_heavy():
    img = Image.new("RGBA", (S,S), (0,0,0,0))
    soot = Image.new("RGBA", (S,S), (0,0,0,0))
    ImageDraw.Draw(soot).ellipse([5,7,47,45], fill=(12,10,8,130))
    img = Image.alpha_composite(img, soot.filter(ImageFilter.GaussianBlur(7)))
    d = ImageDraw.Draw(img)
    d.line([(6,6),(20,20),(14,34),(26,48)], fill=(14,18,16,240), width=2)
    d.line([(20,20),(34,16)], fill=(14,18,16,215), width=2)
    d.line([(44,30),(30,34),(26,48)], fill=(14,18,16,205), width=1)
    d.line([(8,44),(18,34)], fill=(14,18,16,195), width=1)
    d.line([(21,21),(30,17)], fill=(255,150,60,90), width=1)
    d.line([(15,33),(24,44)], fill=(255,150,60,70), width=1)
    return img

def chimney():
    w,h = 48,64
    img = Image.new("RGBA", (w,h), (0,0,0,0))
    body = vgrad((22, h-14), PAT_HI, PAT_LO)
    img.paste(body, (13,12))
    img = Image.alpha_composite(img, patina_noise((w,h), 42, n=20))
    img = Image.alpha_composite(img, cyl_shade((w,h), edge=80))
    d = ImageDraw.Draw(img)
    d.rectangle([13,12,34,h-4], outline=PAT_DK, width=2)
    for y in (24,38):
        d.rectangle([11,y,36,y+6], fill=BRASS_MID, outline=BRASS_DK)
        d.line([(12,y+1),(35,y+1)], fill=BRASS_HI, width=1)
    d.rounded_rectangle([8,2,39,15], 4, fill=BRASS_MID, outline=BRASS_DK, width=2)
    d.line([(10,4),(37,4)], fill=BRASS_HI, width=1)
    d.rectangle([12,6,35,12], fill=(24,16,10,255))
    d.ellipse([14,7,33,11], fill=(255,170,80,90))
    return img

def pennant(color):
    w,h = 52,40
    img = Image.new("RGBA", (w,h), (0,0,0,0)); d = ImageDraw.Draw(img)
    d.line([(5,2),(5,h-2)], fill=BRASS_DK, width=3)
    d.line([(4,2),(4,h-2)], fill=BRASS_HI, width=1)
    d.ellipse([2,0,8,6], fill=GLOW_WARM, outline=BRASS_DK)
    pts = [(7,4),(30,7),(46,5),(40,13),(46,21),(28,19),(7,16)]
    d.polygon(pts, fill=color, outline=(30,22,30,255))
    d.polygon([(7,12),(28,15),(42,14),(46,21),(28,19),(7,16)], fill=(0,0,20,60))
    d.line([(8,6),(28,9),(43,7)], fill=(255,255,255,110), width=1)
    # gear emblem like the mockup flags
    cx,cy,gr = 24,11,5
    for i in range(8):
        a = i*math.pi/4
        d.line([(cx+math.cos(a)*(gr-2), cy+math.sin(a)*(gr-2)),
                (cx+math.cos(a)*(gr+1), cy+math.sin(a)*(gr+1))], fill=(255,255,255,130), width=1)
    d.ellipse([cx-gr+2, cy-gr+2, cx+gr-2, cy+gr-2], outline=(255,255,255,130), width=1)
    return img

def steam():
    n = 64
    img = Image.new("RGBA", (n,n), (0,0,0,0))
    rnd = random.Random(5)
    for _ in range(9):
        r = rnd.randint(9,20)
        x = n/2 + rnd.randint(-12,12); y = n/2 + rnd.randint(-10,10)
        img.alpha_composite(radial((r*2,r*2), (232,236,240,120), (232,236,240,0), rmax=r),
                            (int(x-r), int(y-r)))
    return img.filter(ImageFilter.GaussianBlur(1))

def shard():
    n = 36
    img = Image.new("RGBA", (n,n), (0,0,0,0))
    pts = [(4,20),(12,6),(26,8),(32,18),(24,22),(26,30),(12,30),(14,22)]
    body = radial((n,n), BRASS_HI, BRASS_LO, cx=14, cy=12, rmax=n*.8)
    m = Image.new("L",(n,n),0); ImageDraw.Draw(m).polygon(pts, fill=255)
    img.paste(body, (0,0), m)
    d = ImageDraw.Draw(img)
    d.polygon(pts, outline=BRASS_DK)
    d.line([(8,18),(14,9)], fill=(255,244,210,160), width=1)
    d.ellipse([16,16,21,21], fill=BRASS_DK)
    return img

def strip_v(color):
    w,h = 16,52
    img = Image.new("RGBA", (w,h), (0,0,0,0)); d = ImageDraw.Draw(img)
    d.rectangle([3,0,w-3,h], fill=BRASS_LO, outline=BRASS_DK)
    d.rectangle([5,0,w-5,h], fill=color)
    d.rectangle([5,0,6,h], fill=(255,255,255,90))
    d.rectangle([5,h-8,w-5,h], fill=(0,0,30,60))
    for y in (6,h-6): rivet(d, w//2, y, 2)
    return img

def rivet_projectile():
    n = 32
    img = Image.new("RGBA", (n,n), (0,0,0,0))
    pts = [(n/2+10*math.cos(a), n/2+10*math.sin(a)) for a in [i*math.pi/3-math.pi/6 for i in range(6)]]
    body = radial((n,n), BRASS_HI, BRASS_LO, cx=n*.4, cy=n*.35, rmax=n*.8)
    m = Image.new("L",(n,n),0); ImageDraw.Draw(m).polygon(pts, fill=255)
    img.paste(body, (0,0), m)
    d = ImageDraw.Draw(img)
    d.polygon(pts, outline=BRASS_DK)
    d.ellipse([n/2-3,n/2-3,n/2+3,n/2+3], fill=COPPER, outline=BRASS_DK)
    d.ellipse([n/2-1.5,n/2-1.5,n/2+1.5,n/2+1.5], fill=BRASS_HI)
    return img

def gauge_face():
    n = 64
    img = Image.new("RGBA", (n,n), (0,0,0,0))
    ring = radial((n,n), BRASS_HI, BRASS_LO, cx=n*.4, cy=n*.35, rmax=n*.75)
    m = Image.new("L",(n,n),0); ImageDraw.Draw(m).ellipse([2,2,n-2,n-2], fill=255)
    img.paste(ring, (0,0), m)
    d = ImageDraw.Draw(img)
    d.ellipse([2,2,n-2,n-2], outline=BRASS_DK, width=3)
    face = radial((n,n), (246,238,214,255), (214,198,160,255), cx=n*.42, cy=n*.4, rmax=n*.6)
    fm = Image.new("L",(n,n),0); ImageDraw.Draw(fm).ellipse([8,8,n-8,n-8], fill=255)
    img.paste(face, (0,0), fm)
    d = ImageDraw.Draw(img)
    d.ellipse([8,8,n-8,n-8], outline=BRASS_DK, width=1)
    d.arc([10,10,n-10,n-10], -60, 20, fill=(178,58,38,255), width=4)
    for adeg in range(-120, 61, 30):
        a = math.radians(adeg-90)
        x0 = n/2+math.cos(a)*(n/2-13); y0 = n/2+math.sin(a)*(n/2-13)
        x1 = n/2+math.cos(a)*(n/2-8);  y1 = n/2+math.sin(a)*(n/2-8)
        d.line([(x0,y0),(x1,y1)], fill=(70,52,28,255), width=2)
    d.arc([12,10,n-16,n-14], 170, 280, fill=(255,255,255,130), width=2)
    for a in range(4):
        x = n/2+math.cos(a*math.pi/2+math.pi/4)*(n/2-5)
        y = n/2+math.sin(a*math.pi/2+math.pi/4)*(n/2-5)
        rivet(d, x, y, 2)
    return img

def gauge_needle():
    w = h = 64
    img = Image.new("RGBA", (w,h), (0,0,0,0)); d = ImageDraw.Draw(img)
    cx = cy = w/2
    d.polygon([(cx-2,cy+4),(cx+2,cy+4),(cx+.8,cy-22),(cx-.8,cy-22)], fill=(186,52,34,255), outline=(70,22,14,255))
    d.line([(cx-1,cy+3),(cx-.2,cy-20)], fill=(255,160,130,160), width=1)
    d.ellipse([cx-4,cy-4,cx+4,cy+4], fill=BRASS_DK)
    d.ellipse([cx-2,cy-2,cx+2,cy+2], fill=COPPER)
    return img


def tower_sheet(scene):
    """The mockup's own 3D riveted cylinder, alpha-carved and sized to the
    4x6 block grid (104x156). Sliced per-block at draw time so destroyed
    blocks still open real holes in the hull."""
    body = scene.crop((190, 345, 345, 620)).convert("RGB")
    w, h = body.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([1, 1, w - 2, h - 2], radius=26, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.6))
    out = body.convert("RGBA"); out.putalpha(mask)
    return out.resize((104, 156), Image.LANCZOS)

def cannon_sprite(scene):
    """Right tower's riveted brass cannon (mirrored to aim up-right),
    warm-keyed off the sky, largest component only. Natural elevation ~43
    deg; runtime rotates around the trunnion for aim."""
    import numpy as np
    from collections import deque
    can = ImageOps.mirror(scene.crop((1120, 300, 1205, 368)).convert("RGB"))
    a = np.asarray(can).astype(int)
    m = (a[..., 0] > a[..., 2] + 8).astype(np.uint8)
    lab = np.zeros_like(m, dtype=int); cur = 0; sizes = {}
    for y0 in range(m.shape[0]):
        for x0 in range(m.shape[1]):
            if m[y0, x0] and not lab[y0, x0]:
                cur += 1; q = deque([(y0, x0)]); lab[y0, x0] = cur; sizes[cur] = 0
                while q:
                    y, x = q.popleft(); sizes[cur] += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < m.shape[0] and 0 <= nx < m.shape[1] and m[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = cur; q.append((ny, nx))
    keep = (lab == max(sizes, key=sizes.get)).astype(np.uint8) * 255
    km = Image.fromarray(keep, "L").filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.0))
    out = can.convert("RGBA"); out.putalpha(km)
    bb = out.getbbox()
    print("cannon pre-crop 85x68 pivot (42,50); bbox", bb)
    return out.crop(bb)

def save(img, name, **kw):
    img.save(os.path.join(OUT, name), **kw)
    print(name, img.size, os.path.getsize(os.path.join(OUT, name)), "bytes")

scene, scene_raw = prepare_scene()
HULL = scene.crop((1180, 438, 1252, 482))  # flat riveted patina patch from right tower

save(block_base("a"), "block_a.png", optimize=True)
save(block_base("b"), "block_b.png", optimize=True)
save(block_base("vent"), "block_vent.png", optimize=True)
save(dmg_light(), "dmg_light.png", optimize=True)
save(dmg_heavy(), "dmg_heavy.png", optimize=True)
save(gear_from_mock(scene, 96), "gear_l.png", optimize=True)
save(gear_from_mock(scene, 72), "gear_m.png", optimize=True)
save(gear_from_mock(scene, 52), "gear_s.png", optimize=True)
save(porthole(scene), "window.png", optimize=True)
save(porthole(scene, P1), "window_p1.png", optimize=True)
save(porthole(scene, P2), "window_p2.png", optimize=True)
save(chimney(), "chimney.png", optimize=True)
save(pennant(P1), "pennant_p1.png", optimize=True)
save(pennant(P2), "pennant_p2.png", optimize=True)
save(steam(), "steam.png", optimize=True)
save(shard(), "shard.png", optimize=True)
save(bg_sky(scene), "bg_sky.webp", quality=86, method=6)
save(bg_far(scene), "bg_far.webp", quality=86, method=6)
save(bg_near(), "bg_near.webp", quality=86, method=6)
save(airship(scene_raw), "airship.webp", quality=88, method=6)
save(strip_v(P1), "strip_p1.png", optimize=True)
save(strip_v(P2), "strip_p2.png", optimize=True)
save(rivet_projectile(), "rivet.png", optimize=True)
save(gauge_face(), "gauge.png", optimize=True)
save(gauge_needle(), "needle.png", optimize=True)
save(tower_sheet(scene), "tower_sheet.webp", quality=90, method=6)
save(cannon_sprite(scene), "cannon.webp", quality=90, method=6)
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print("TOTAL", total, "=", round(total/1024, 1), "KB")
