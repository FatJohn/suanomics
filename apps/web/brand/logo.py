"""從維護者的 logo 原圖產生品牌原稿與網站用的小圖。

兩段，可分開跑：
  masters <原圖目錄>  原圖 1.png（橫式）、2.png（圖形）→ brand/lockup-master.png、brand/mark-master.png
  outputs              兩張原稿 → public/logo-mark.png（256px）、brand/lockup.png（640px 寬）
原圖不進 repo；原稿進 repo，日後放大或改尺寸只跑 outputs。

用 Pillow 而不是 Node：Node 沒有原生的 PNG 解碼／編碼、Lanczos 縮放與反鋸齒繪圖，
自己寫等於重做一個影像庫。venv 建在 repo 外（放 repo 內會被 ESLint、knip 掃到），
不進 pnpm workspace，build 與 CI 不跑：
  python3 -m venv ~/.venvs/suanomics-brand
  ~/.venvs/suanomics-brand/bin/pip install -r apps/web/brand/requirements.txt
  ~/.venvs/suanomics-brand/bin/python apps/web/brand/logo.py masters ~/Downloads/logo
  ~/.venvs/suanomics-brand/bin/python apps/web/brand/logo.py outputs
"""
import statistics
import sys
from pathlib import Path

from PIL import Image, ImageDraw

BRAND = Path(__file__).resolve().parent
PUBLIC = BRAND.parent / 'public'


def color_to_alpha(path):
    """把白底換成透明，半透明邊緣反推回原色，貼在任何底色上都不會留白邊。"""
    im = Image.open(path).convert('RGB')
    px = im.load()
    out = Image.new('RGBA', im.size)
    op = out.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = px[x, y]
            a = 255 - min(r, g, b)
            if a < 8:  # 原圖白底帶輕微雜訊，低於這個值的一律當全透明
                op[x, y] = (0, 0, 0, 0)
                continue
            f = 255.0 / a
            op[x, y] = tuple(max(0, min(255, round(255 - (255 - c) * f))) for c in (r, g, b)) + (a,)
    return out


def redraw_trigrams(im):
    """原圖的卦象有錯，依維護者 2026-11-27 決定重畫成先天八卦四正位：上乾、下坤、左離、右坎。

    座標是量 1.png（1536x1024）得到的，換原圖要重量。
    """
    p = im.load()
    ink = tuple(int(statistics.median(p[x, y][i] for x in range(312, 380) for y in (224, 248, 273))) for i in range(4))
    d = ImageDraw.Draw(im)
    for box in [(300, 214, 392, 286), (296, 766, 386, 818), (32, 472, 90, 542), (588, 472, 640, 542)]:
        d.rectangle(box, fill=(0, 0, 0, 0))
    k = 4  # 放大 4 倍畫再縮回，取得反鋸齒的圓角
    layer = Image.new('RGBA', (im.width * k, im.height * k), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    def bar(x0, x1, y):
        draw.rounded_rectangle((x0 * k, y * k, x1 * k, (y + 13) * k), radius=3 * k, fill=ink)

    def trigram(cx, top, width, gap, lines):  # lines 由上而下，True 是陽爻（實線）
        x0, x1 = cx - width / 2, cx + width / 2
        for i, solid in enumerate(lines):
            y = top + i * 24.5
            if solid:
                bar(x0, x1, y)
            else:
                bar(x0, cx - gap / 2, y)
                bar(cx + gap / 2, x1, y)

    trigram(346.5, 219, 78, 16, [True, True, True])     # 乾
    trigram(346.5, 773, 78, 16, [False, False, False])  # 坤
    trigram(60.5, 478, 46, 10, [True, False, True])     # 離
    trigram(612.5, 478, 46, 10, [False, True, False])   # 坎
    return Image.alpha_composite(im, layer.resize(im.size, Image.LANCZOS))


def mark_without_trigrams(im):
    """刊頭與網站圖示用去掉卦象的版本（維護者選的 B 版），卦象在 40px 以下會糊成雜點。

    座標是量 2.png（1254x1254）得到的；結果裁成正方形、四邊各留 2%。
    """
    im = im.copy()
    d = ImageDraw.Draw(im)
    for box in [(540, 110, 710, 245), (540, 1025, 710, 1150), (120, 535, 228, 665), (1028, 535, 1130, 665)]:
        d.rectangle(box, fill=(0, 0, 0, 0))
    l, t, r, b = im.getbbox()
    side = int(max(r - l, b - t) * 1.04)
    cx, cy = (l + r) // 2, (t + b) // 2
    out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    out.paste(im.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)), (0, 0))
    return out


def masters(src):
    src = Path(src).expanduser()
    lockup = redraw_trigrams(color_to_alpha(src / '1.png'))
    lockup = lockup.crop(lockup.getbbox())
    lockup.save(BRAND / 'lockup-master.png', optimize=True)
    mark = mark_without_trigrams(color_to_alpha(src / '2.png'))
    mark.save(BRAND / 'mark-master.png', optimize=True)
    print('lockup-master', lockup.size, 'mark-master', mark.size)


def outputs():
    mark = Image.open(BRAND / 'mark-master.png')
    mark.resize((256, 256), Image.LANCZOS).save(PUBLIC / 'logo-mark.png', optimize=True)
    lockup = Image.open(BRAND / 'lockup-master.png')
    height = round(lockup.height * 640 / lockup.width)
    lockup.resize((640, height), Image.LANCZOS).save(BRAND / 'lockup.png', optimize=True)
    print('logo-mark (256, 256)', 'lockup', (640, height))


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'masters':
        masters(sys.argv[2])
    elif len(sys.argv) == 2 and sys.argv[1] == 'outputs':
        outputs()
    else:
        sys.exit(__doc__)
