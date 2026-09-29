#!/usr/bin/env python3
"""Brigagame 'Clockwork Towers' (direction D2) sprite generator.
Deterministic, original soft-steampunk art. All sprites 2x game scale
(game block = 26px, sprite cell = 52px) for retina crispness; the runtime
scales down with drawImage. Output: cloud/public/assets/gfx/clockwork/.
"""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter

random.seed(20260929)
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "gfx", "clockwork")
os.makedirs(OUT, exist_ok=True)

BRASS_HI   = (226, 188, 122, 255)
BRASS_MID  = (176, 141, 87, 255)
BRASS_LO   = (122, 92, 51, 255)
BRASS_DARK = (63, 45, 24, 255)
COPPER     = (184, 115, 51, 255)
GLOW       = (244, 201, 93, 255)
P1         = (56, 189, 248, 255)   # team blue
P2         = (251, 113, 133, 255)  # team rose

S = 52  # sprite cell (2x of 26px block)

def vgrad(size, top, bottom):
    w, h = size
    img = Image.new("RGBA", size)
    for y in range(h):
        t = y / max(1, h - 1)
        px = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(4))
        ImageDraw.Draw(img).line([(0, y), (w, y)], fill=px)
    return img

def rivet(d, x, y, r=3):
    d.ellipse([x - r, y - r, x + r, y + r], fill=BRASS_LO, outline=BRASS_DARK)
    d.ellipse([x - r + 1, y - r + 1, x + r - 2, y + r - 2], fill=BRASS_HI)

def block_base(variant):
    img = vgrad((S, S), BRASS_HI, BRASS_MID)
    d = ImageDraw.Draw(img)
    # darken lower third slightly for weight
    d.rectangle([0, S * 2 // 3, S, S], fill=(0, 0, 0, 0))
    for y in range(S * 2 // 3, S):
        d.line([(0, y), (S, y)], fill=(0, 0, 0, int(28 * (y - S * 2 / 3) / (S / 3))))
    d.rounded_rectangle([1, 1, S - 2, S - 2], 7, outline=BRASS_DARK, width=2)
    d.line([(5, 5), (S - 6, 5)], fill=(255, 240, 200, 110), width=1)      # top bevel
    d.line([(5, S - 5), (S - 6, S - 5)], fill=(40, 26, 12, 90), width=1)  # bottom shade
    if variant == "a":
        for x, y in [(7, 7), (S - 7, 7), (7, S - 7), (S - 7, S - 7)]:
            rivet(d, x, y)
    elif variant == "b":
        d.line([(4, S // 2), (S - 4, S // 2)], fill=(70, 50, 26, 160), width=2)
        d.line([(4, S // 2 + 2), (S - 4, S // 2 + 2)], fill=(255, 240, 200, 70), width=1)
        for x, y in [(7, 7), (S - 7, 7), (7, S - 7), (S - 7, S - 7)]:
            rivet(d, x, y, 2)
    elif variant == "vent":
        for i in range(3):
            y = 16 + i * 8
            d.rounded_rectangle([12, y, S - 12, y + 5], 2, fill=(46, 32, 16, 255))
            d.line([(12, y), (S - 12, y)], fill=(255, 240, 200, 60), width=1)
        for x, y in [(7, 7), (S - 7, 7)]:
            rivet(d, x, y, 2)
    return img

def dmg_light():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.ellipse([14, 18, 34, 32], fill=(30, 20, 10, 70))                 # dent shadow
    d.arc([13, 16, 33, 30], 200, 340, fill=(255, 240, 200, 70), width=1)
    d.line([(8, 10), (22, 24)], fill=(40, 28, 14, 200), width=2)
    d.line([(22, 24), (18, 38)], fill=(40, 28, 14, 160), width=1)
    d.line([(40, 8), (32, 20)], fill=(40, 28, 14, 170), width=1)
    return img

def dmg_heavy():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    soot = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(soot).ellipse([6, 8, 46, 44], fill=(20, 12, 6, 90))
    img = Image.alpha_composite(img, soot.filter(ImageFilter.GaussianBlur(6)))
    d = ImageDraw.Draw(img)
    d.line([(6, 6), (20, 20), (14, 34), (26, 48)], fill=(30, 20, 10, 235), width=2)
    d.line([(20, 20), (34, 16)], fill=(30, 20, 10, 210), width=2)
    d.line([(44, 30), (30, 34), (26, 48)], fill=(30, 20, 10, 200), width=1)
    d.line([(8, 44), (18, 34)], fill=(30, 20, 10, 190), width=1)
    return img

def gear(diam, teeth, ring=0.30):
    img = Image.new("RGBA", (diam, diam), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    cx = cy = diam / 2
    r_out = diam / 2 - 1
    r_in = r_out * (1 - ring)
    # teeth
    for i in range(teeth):
        a = i * 2 * math.pi / teeth
        tw = math.pi / teeth * 0.55
        pts = [(cx + math.cos(a - tw) * r_in, cy + math.sin(a - tw) * r_in),
               (cx + math.cos(a - tw * 0.6) * r_out, cy + math.sin(a - tw * 0.6) * r_out),
               (cx + math.cos(a + tw * 0.6) * r_out, cy + math.sin(a + tw * 0.6) * r_out),
               (cx + math.cos(a + tw) * r_in, cy + math.sin(a + tw) * r_in)]
        d.polygon(pts, fill=BRASS_MID, outline=BRASS_DARK)
    d.ellipse([cx - r_in, cy - r_in, cx + r_in, cy + r_in], fill=BRASS_MID, outline=BRASS_DARK, width=2)
    # top-left light arc
    d.arc([cx - r_in + 2, cy - r_in + 2, cx + r_in - 2, cy + r_in - 2], 120, 260, fill=BRASS_HI, width=max(2, diam // 18))
    r_hub = r_in * 0.30
    # spokes
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        d.line([(cx + math.cos(a) * r_hub, cy + math.sin(a) * r_hub),
                (cx + math.cos(a) * (r_in - 2), cy + math.sin(a) * (r_in - 2))],
               fill=BRASS_DARK, width=max(2, diam // 22))
    d.ellipse([cx - r_hub, cy - r_hub, cx + r_hub, cy + r_hub], fill=COPPER, outline=BRASS_DARK, width=1)
    d.ellipse([cx - r_hub * .4, cy - r_hub * .4, cx + r_hub * .4, cy + r_hub * .4], fill=BRASS_DARK)
    return img

def window_port():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    cx = cy = S / 2
    d.ellipse([6, 6, S - 6, S - 6], fill=BRASS_MID, outline=BRASS_DARK, width=3)
    for a in range(4):
        x = cx + math.cos(a * math.pi / 2 + math.pi / 4) * (S / 2 - 8)
        y = cy + math.sin(a * math.pi / 2 + math.pi / 4) * (S / 2 - 8)
        rivet(d, x, y, 2)
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([12, 12, S - 12, S - 12], fill=(255, 214, 130, 255))
    gd.ellipse([16, 16, S - 20, S - 16], fill=(255, 238, 190, 255))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)
    d.ellipse([12, 12, S - 12, S - 12], outline=BRASS_DARK, width=2)
    d.arc([16, 14, S - 18, S - 16], 160, 300, fill=(255, 252, 230, 220), width=2)  # glass shine
    d.line([(cx, 13), (cx, S - 13)], fill=(120, 80, 40, 160), width=2)              # frame bar
    return img

def chimney():
    w, h = 48, 64
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    body = vgrad((20, h - 16), BRASS_HI, BRASS_LO)
    img.paste(body, (14, 12))
    d = ImageDraw.Draw(img)
    d.rectangle([14, 12, 33, h - 4], outline=BRASS_DARK, width=2)
    for y in (24, 38):
        d.rectangle([12, y, 35, y + 5], fill=COPPER, outline=BRASS_DARK)
    d.rounded_rectangle([8, 2, 39, 14], 4, fill=BRASS_MID, outline=BRASS_DARK, width=2)
    d.rectangle([12, 5, 35, 11], fill=(30, 20, 10, 255))  # mouth
    return img

def pennant(color):
    w, h = 52, 40
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.line([(5, 2), (5, h - 2)], fill=BRASS_DARK, width=3)
    d.ellipse([2, 0, 8, 6], fill=GLOW, outline=BRASS_DARK)
    # waving flag (two-tone cloth)
    pts = [(7, 4), (30, 7), (46, 5), (40, 13), (46, 21), (28, 19), (7, 16)]
    d.polygon(pts, fill=color, outline=BRASS_DARK)
    d.line([(7, 10), (28, 13), (41, 12)], fill=(255, 255, 255, 90), width=1)
    return img

def steam():
    n = 64
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for r in range(n // 2, 0, -2):
        t = r / (n / 2)
        a = int(150 * (1 - t) ** 1.6)
        d.ellipse([n / 2 - r, n / 2 - r, n / 2 + r, n / 2 + r], fill=(226, 226, 222, a))
    return img.filter(ImageFilter.GaussianBlur(1))

def shard():
    n = 36
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    pts = [(4, 20), (12, 6), (26, 8), (32, 18), (24, 22), (26, 30), (12, 30), (14, 22)]
    d.polygon(pts, fill=BRASS_MID, outline=BRASS_DARK)
    d.arc([10, 8, 30, 30], 200, 320, fill=BRASS_HI, width=2)
    d.ellipse([16, 16, 21, 21], fill=BRASS_DARK)
    return img

def bg_sky():
    w, h = 1000, 560
    img = vgrad((w, h), (30, 21, 46, 255), (113, 58, 63, 255))
    d = ImageDraw.Draw(img)
    for y in range(int(h * .62), h):
        t = (y - h * .62) / (h * .38)
        d.line([(0, y), (w, y)], fill=(232, 160, 92, int(120 * t)))
    # low warm sun glow right of center
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([640, 330, 900, 520], fill=(255, 196, 110, 90))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(60)))
    d = ImageDraw.Draw(img)
    random.seed(7)
    for _ in range(46):
        x, y = random.randint(0, w - 1), random.randint(8, int(h * .42))
        a = random.randint(60, 170)
        d.point((x, y), fill=(255, 244, 211, a))
        if random.random() < .18:
            d.point((x + 1, y), fill=(255, 244, 211, a // 2))
    return img.convert("RGB")

def bg_far():
    w, h = 1400, 200
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    sil = (29, 21, 38, 255)
    random.seed(11)
    x = 0
    while x < w:
        bw = random.randint(46, 110)
        bh = random.randint(50, 150)
        d.rectangle([x, h - bh, x + bw, h], fill=sil)
        if random.random() < .5:  # chimney
            cx = x + random.randint(8, max(9, bw - 14))
            d.rectangle([cx, h - bh - random.randint(16, 42), cx + 8, h - bh], fill=sil)
        if random.random() < .30:  # water tower
            tx = x + bw // 2
            d.ellipse([tx - 16, h - bh - 30, tx + 16, h - bh - 8], fill=sil)
            d.line([(tx - 10, h - bh - 8), (tx - 12, h - bh)], fill=sil, width=3)
            d.line([(tx + 10, h - bh - 8), (tx + 12, h - bh)], fill=sil, width=3)
        for _ in range(random.randint(2, 8)):  # lit windows
            wx = x + random.randint(5, max(6, bw - 9))
            wy = h - random.randint(10, max(11, bh - 6))
            d.rectangle([wx, wy, wx + 3, wy + 4], fill=(244, 201, 93, random.randint(90, 200)))
        x += bw + random.randint(6, 26)
    return img

def bg_near():
    w, h = 1400, 90
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rectangle([0, 30, w, h], fill=(52, 38, 26, 255))
    d.rectangle([0, 30, w, 34], fill=(94, 68, 42, 255))
    for x in range(0, w, 90):
        d.line([(x, 34), (x, h)], fill=(30, 21, 14, 255), width=2)
        for y in (44, 62, 80):
            d.ellipse([x + 6, y, x + 10, y + 4], fill=(120, 96, 60, 255))
    for lx in (170, 1180):  # street lamps
        d.rectangle([lx, 0, lx + 4, 34], fill=(24, 17, 12, 255))
        d.ellipse([lx - 5, -6, lx + 9, 8], fill=(24, 17, 12, 255))
        d.ellipse([lx - 2, -3, lx + 6, 5], fill=(255, 226, 150, 255))
    return img

def airship():
    w, h = 240, 100
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.ellipse([8, 12, w - 30, 62], fill=(84, 54, 60, 255), outline=(36, 24, 30, 255), width=2)
    d.arc([14, 16, w - 40, 56], 150, 300, fill=(150, 100, 96, 255), width=3)
    for i in range(5):  # panel ribs
        x = 34 + i * 34
        d.arc([x - 26, 13, x + 26, 61], 250, 290, fill=(46, 30, 34, 255), width=1)
    d.polygon([(w - 32, 24), (w - 6, 12), (w - 10, 30)], fill=(64, 40, 46, 255), outline=(36, 24, 30, 255))  # fin
    d.polygon([(w - 32, 48), (w - 6, 62), (w - 10, 44)], fill=(64, 40, 46, 255), outline=(36, 24, 30, 255))
    d.rounded_rectangle([80, 62, 150, 82], 6, fill=(52, 34, 30, 255), outline=(30, 20, 18, 255))  # gondola
    for i in range(4):
        d.rectangle([90 + i * 14, 68, 98 + i * 14, 74], fill=(244, 201, 93, 220))
    d.line([(100, 62), (96, 50)], fill=(30, 20, 18, 255), width=2)
    d.line([(130, 62), (128, 52)], fill=(30, 20, 18, 255), width=2)
    d.ellipse([w - 14, 34, w - 4, 44], fill=(120, 96, 60, 255), outline=(36, 24, 30, 255))  # prop hub
    return img

def save(img, name, **kw):
    img.save(os.path.join(OUT, name), **kw)
    print(name, img.size, os.path.getsize(os.path.join(OUT, name)), "bytes")

save(block_base("a"), "block_a.png", optimize=True)
save(block_base("b"), "block_b.png", optimize=True)
save(block_base("vent"), "block_vent.png", optimize=True)
save(dmg_light(), "dmg_light.png", optimize=True)
save(dmg_heavy(), "dmg_heavy.png", optimize=True)
save(gear(52, 8), "gear_s.png", optimize=True)
save(gear(72, 10), "gear_m.png", optimize=True)
save(gear(96, 12), "gear_l.png", optimize=True)
save(window_port(), "window.png", optimize=True)
save(chimney(), "chimney.png", optimize=True)
save(pennant(P1), "pennant_p1.png", optimize=True)
save(pennant(P2), "pennant_p2.png", optimize=True)
save(steam(), "steam.png", optimize=True)
save(shard(), "shard.png", optimize=True)
save(bg_sky(), "bg_sky.webp", quality=82, method=6)
save(bg_far(), "bg_far.webp", quality=85, method=6)
save(bg_near(), "bg_near.webp", quality=85, method=6)
save(airship(), "airship.webp", quality=85, method=6)
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print("TOTAL", total, "bytes =", round(total / 1024, 1), "KB")

# --- team accent additions (decision ב: pennant + metal strip + skylight tint) ---
def strip_v(color):
    w, h = 16, 52
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rectangle([3, 0, w - 3, h], fill=BRASS_LO, outline=BRASS_DARK)
    d.rectangle([5, 0, w - 5, h], fill=color)
    d.rectangle([5, 0, 7, h], fill=(255, 255, 255, 70))
    for y in (6, h - 6):
        rivet(d, w // 2, y, 2)
    return img

def window_team(color):
    base = window_port()
    d = ImageDraw.Draw(base)
    # enamel ring in team color between brass rim and glass
    d.ellipse([9, 9, S - 9, S - 9], outline=color, width=3)
    return base

save(strip_v(P1), "strip_p1.png", optimize=True)
save(strip_v(P2), "strip_p2.png", optimize=True)
save(window_team(P1), "window_p1.png", optimize=True)
save(window_team(P2), "window_p2.png", optimize=True)
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print("TOTAL", total, "bytes =", round(total / 1024, 1), "KB")

# --- brass rivet projectile (decision ג) ---
def rivet():
    n = 32
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    cx, cy = n / 2, n / 2
    # hex head
    pts = [(cx + 10 * math.cos(a), cy + 10 * math.sin(a)) for a in
           [i * math.pi / 3 - math.pi / 6 for i in range(6)]]
    d.polygon(pts, fill=BRASS_MID, outline=BRASS_DARK)
    d.polygon([(cx + 7 * math.cos(a), cy + 7 * math.sin(a)) for a in
               [i * math.pi / 3 - math.pi / 6 for i in range(6)]], fill=BRASS_HI)
    d.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=COPPER, outline=BRASS_DARK)
    # shaft glint
    d.line([(cx - 6, cy + 8), (cx + 6, cy - 8)], fill=(255, 240, 200, 120), width=1)
    return img
save(rivet(), "rivet.png", optimize=True)
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print("TOTAL", total, "bytes =", round(total / 1024, 1), "KB")

# --- stage 2: pressure gauge (face + needle) ---
def gauge_face():
    n = 64
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.ellipse([2, 2, n - 2, n - 2], fill=BRASS_MID, outline=BRASS_DARK, width=3)
    d.ellipse([8, 8, n - 8, n - 8], fill=(240, 230, 205, 255), outline=BRASS_DARK, width=1)
    # red zone
    d.arc([10, 10, n - 10, n - 10], -60, 20, fill=(180, 60, 40, 255), width=4)
    for adeg in range(-120, 61, 30):
        a = math.radians(adeg - 90)
        x0 = n / 2 + math.cos(a) * (n / 2 - 13); y0 = n / 2 + math.sin(a) * (n / 2 - 13)
        x1 = n / 2 + math.cos(a) * (n / 2 - 8); y1 = n / 2 + math.sin(a) * (n / 2 - 8)
        d.line([(x0, y0), (x1, y1)], fill=(60, 45, 25, 255), width=2)
    for a in range(4):
        x = n / 2 + math.cos(a * math.pi / 2 + math.pi / 4) * (n / 2 - 5)
        y = n / 2 + math.sin(a * math.pi / 2 + math.pi / 4) * (n / 2 - 5)
        d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=BRASS_LO, outline=BRASS_DARK)
    return img

def gauge_needle():
    w, h = 64, 64
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    cx, cy = w / 2, h / 2
    d.polygon([(cx - 2, cy + 4), (cx + 2, cy + 4), (cx + .8, cy - 22), (cx - .8, cy - 22)],
              fill=(180, 50, 35, 255), outline=(60, 20, 15, 255))
    d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=BRASS_DARK)
    d.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=COPPER)
    return img

save(gauge_face(), "gauge.png", optimize=True)
save(gauge_needle(), "needle.png", optimize=True)
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print("TOTAL", total, "=", round(total / 1024, 1), "KB")
