#!/usr/bin/env python3
"""Generate every platform icon from the shared vector master logo."""
from pathlib import Path
import base64
from PIL import Image\nimport cairosvg
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "public/icons/attendance-logo.png"\nVECTOR = ROOT / "public/icons/attendance-logo.svg"
OUT = ROOT / "public/icons"
OUT.mkdir(parents=True, exist_ok=True)
if VECTOR.exists():\n    cairosvg.svg2png(url=str(VECTOR), write_to=str(SOURCE), output_width=1024, output_height=1024)\nif not SOURCE.exists():\n    raise SystemExit("Missing shared CRM logo: public/icons/attendance-logo.svg")\nlogo = Image.open(SOURCE).convert("RGBA")
if logo.size != (1024, 1024):
    logo = logo.resize((1024, 1024), Image.Resampling.LANCZOS)

for size, name in [(180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
    logo.resize((size, size), Image.Resampling.LANCZOS).save(OUT / name, optimize=True)

icon_data = base64.b64encode((OUT / "apple-touch-icon.png").read_bytes()).decode("ascii")
profile = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadContent</key><array><dict>
<key>FullScreen</key><true/><key>IsRemovable</key><true/>
<key>Label</key><string>attendence_crm</string><key>PrecomposedIcon</key><true/>
<key>Icon</key><data>{icon_data}</data>
<key>PayloadDescription</key><string>Adds attendence_crm to the iPhone Home Screen.</string>
<key>PayloadDisplayName</key><string>attendence_crm Web Clip</string>
<key>PayloadIdentifier</key><string>com.mostbetpartners.attendancecrm.webclip</string>
<key>PayloadType</key><string>com.apple.webClip.managed</string>
<key>PayloadUUID</key><string>7D89A2F1-7A21-4C61-9B1E-21D7A1A7B260</string>
<key>PayloadVersion</key><integer>1</integer>
<key>URL</key><string>https://attendence.dpdns.org/</string>
</dict></array>
<key>PayloadDisplayName</key><string>attendence_crm</string>
<key>PayloadIdentifier</key><string>com.mostbetpartners.attendancecrm.profile</string>
<key>PayloadOrganization</key><string>Mostbet Partners</string>
<key>PayloadRemovalDisallowed</key><false/>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadUUID</key><string>F67D20D1-0E7B-4A8D-9E57-6B8E7E8F5F61</string>
<key>PayloadVersion</key><integer>1</integer>
</dict></plist>'''
(ROOT / "public/mbp-attendance-ios.mobileconfig").write_text(profile, encoding="utf-8")

# Capacitor creates android/ during CI. Generate every launcher variant from the supplied artwork.
res = ROOT / "android/app/src/main/res"
if res.exists():
    for density, size in [("mdpi",48),("hdpi",72),("xhdpi",96),("xxhdpi",144),("xxxhdpi",192)]:
        d = res / f"mipmap-{density}"; d.mkdir(parents=True, exist_ok=True)
        scaled = logo.resize((size,size), Image.Resampling.LANCZOS)
        scaled.save(d / "ic_launcher.png", optimize=True)
        scaled.save(d / "ic_launcher_round.png", optimize=True)
    fg = Image.new("RGBA", (432,432), (0,0,0,0))
    mark = logo.copy(); mark.thumbnail((360,360), Image.Resampling.LANCZOS)
    fg.alpha_composite(mark, ((432-mark.width)//2,(432-mark.height)//2))
    d = res / "drawable"; d.mkdir(parents=True, exist_ok=True)
    fg.save(d / "ic_launcher_foreground.png", optimize=True)
    d = res / "values"; d.mkdir(parents=True, exist_ok=True)
    (d / "ic_launcher_background.xml").write_text('<resources><color name="ic_launcher_background">#03091F</color></resources>', encoding="utf-8")
    d = res / "mipmap-anydpi-v26"; d.mkdir(parents=True, exist_ok=True)
    adaptive = '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@drawable/ic_launcher_foreground"/></adaptive-icon>'
    (d / "ic_launcher.xml").write_text(adaptive, encoding="utf-8")
    (d / "ic_launcher_round.xml").write_text(adaptive, encoding="utf-8")
    ET.register_namespace("android", "http://schemas.android.com/apk/res/android")
    manifest = ROOT / "android/app/src/main/AndroidManifest.xml"
    tree = ET.parse(manifest); app = tree.getroot().find("application")
    if app is None: raise SystemExit("Android application element missing")
    ns = "{http://schemas.android.com/apk/res/android}"
    app.set(ns+"icon", "@mipmap/ic_launcher")
    app.set(ns+"roundIcon", "@mipmap/ic_launcher_round")
    tree.write(manifest, encoding="utf-8", xml_declaration=True)
print("Generated all platform icons and the embedded-icon iOS Web Clip profile from attendance-logo.png.")
