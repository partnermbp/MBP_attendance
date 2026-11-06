#!/usr/bin/env python3
"""Generate web, iOS Web Clip and Android icons from the single CRM brand SVG."""
from pathlib import Path
import base64
import cairosvg

ROOT = Path(__file__).resolve().parents[2]
SVG = ROOT / "public/icons/attendance-logo.svg"
ICONS = ROOT / "public/icons"
ICONS.mkdir(parents=True, exist_ok=True)

def png(size, path):
    cairosvg.svg2png(url=str(SVG), write_to=str(path), output_width=size, output_height=size)

# Browser/PWA and iOS touch icons
png(180, ICONS / "apple-touch-icon.png")
png(192, ICONS / "icon-192.png")
png(512, ICONS / "icon-512.png")

# Embed the actual PNG icon in the Apple Web Clip profile.
icon_data = base64.b64encode((ICONS / "apple-touch-icon.png").read_bytes()).decode("ascii")
profile = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadContent</key><array><dict>
<key>FullScreen</key><true/>
<key>IsRemovable</key><true/>
<key>Label</key><string>MBP Attendance</string>
<key>PrecomposedIcon</key><true/>
<key>Icon</key><data>{icon_data}</data>
<key>PayloadDescription</key><string>Adds MBP Attendance to the iPhone Home Screen.</string>
<key>PayloadDisplayName</key><string>MBP Attendance Web Clip</string>
<key>PayloadIdentifier</key><string>com.mostbetpartners.attendancecrm.webclip</string>
<key>PayloadType</key><string>com.apple.webClip.managed</string>
<key>PayloadUUID</key><string>7D89A2F1-7A21-4C61-9B1E-21D7A1A7B260</string>
<key>PayloadVersion</key><integer>1</integer>
<key>URL</key><string>https://attendence.dpdns.org/</string>
</dict></array>
<key>PayloadDisplayName</key><string>MBP Attendance</string>
<key>PayloadIdentifier</key><string>com.mostbetpartners.attendancecrm.profile</string>
<key>PayloadOrganization</key><string>Mostbet Partners</string>
<key>PayloadRemovalDisallowed</key><false/>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadUUID</key><string>F67D20D1-0E7B-4A8D-9E57-6B8E7E8F5F61</string>
<key>PayloadVersion</key><integer>1</integer>
</dict></plist>
'''
(ROOT / "public/mbp-attendance-ios.mobileconfig").write_text(profile, encoding="utf-8")
print("Generated PNG icons and iOS Web Clip profile with embedded icon.")
