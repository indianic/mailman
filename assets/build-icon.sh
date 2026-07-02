#!/usr/bin/env bash
###############################################################################
# build-icon.sh — regenerate assets/mailman.icns (+ preview PNG) from scratch.
#
# Only needed when the icon design changes. Requires ImageMagick (`magick`)
# and macOS `iconutil` — both authoring-time only; the shipped mailman.icns is
# what the runtime uses, so end users need neither. See src/notify.ts for how
# the icon is baked into the generated mailman.app bundle.
###############################################################################
set -euo pipefail
cd "$(dirname "$0")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Indigo gradient rounded square + white envelope with a "V" flap. Drawn with
# ImageMagick's native draw ops (its SVG renderer drops gradients/strokes).
magick -size 1024x1024 gradient:'#5B6CF9-#2E43D4' "$WORK/grad.png"
magick -size 1024x1024 xc:black -fill white \
  -draw "roundrectangle 104,104,920,920,188,188" "$WORK/mask.png"
magick "$WORK/grad.png" "$WORK/mask.png" -alpha off -compose CopyOpacity -composite "$WORK/bg.png"
magick "$WORK/bg.png" \
  -fill white -stroke none -draw "roundrectangle 286,360,738,680,40,40" \
  -fill none -stroke '#2E43D4' -strokewidth 36 \
  -draw "stroke-linecap round stroke-linejoin round path 'M 322 402 L 512 552 L 702 402'" \
  mailman-icon.png

# PNG set -> .icns
ICONSET="$WORK/mailman.iconset"
mkdir -p "$ICONSET"
gen() { magick mailman-icon.png -resize "${1}x${1}" "$ICONSET/icon_${2}.png"; }
gen 16 16x16;    gen 32 16x16@2x
gen 32 32x32;    gen 64 32x32@2x
gen 128 128x128; gen 256 128x128@2x
gen 256 256x256; gen 512 256x256@2x
gen 512 512x512; gen 1024 512x512@2x
iconutil -c icns "$ICONSET" -o mailman.icns

echo "Wrote assets/mailman.icns and assets/mailman-icon.png"
