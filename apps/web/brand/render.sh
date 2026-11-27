#!/usr/bin/env bash
# 用本機 Google Chrome headless 與 macOS sips 把 brand/*.html 截成 public/ 裡的圖檔。
# 只在改了原稿時手動跑一次，產出的 PNG／ICO 進版控；build 與 CI 不跑，所以不多一個 dependency。
set -euo pipefail
cd "$(dirname "$0")/.."
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

shot() { # <html> <out.png> <width> <height>
  "$chrome" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$3,$4" --screenshot="$2" "file://$PWD/brand/$1" >/dev/null 2>&1
}

shot og-image.html public/og-image.png 1200 630
# headless Chrome 的視窗有最小寬度，小圖直接截會被裁，先截 512 再用 macOS 內建的 sips 縮。
shot icon.html "$tmp/icon-512.png" 512 512
for size in 180 48 32 16; do
  sips -z "$size" "$size" "$tmp/icon-512.png" --out "$tmp/icon-$size.png" >/dev/null
done
cp "$tmp/icon-180.png" public/apple-touch-icon.png

# ICO 容器可以直接包 PNG（Vista 之後的格式），用 Python 標準庫寫檔頭即可。
python3 - "$tmp/icon-16.png" "$tmp/icon-32.png" "$tmp/icon-48.png" public/favicon.ico <<'PY'
import struct, sys
*pngs, out = sys.argv[1:]
datas = [open(p, 'rb').read() for p in pngs]
header = struct.pack('<HHH', 0, 1, len(datas))
offset = 6 + 16 * len(datas)
entries = b''
for data in datas:
    w, h = struct.unpack('>II', data[16:24])
    entries += struct.pack('<BBBBHHII', w % 256, h % 256, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
open(out, 'wb').write(header + entries + b''.join(datas))
PY
