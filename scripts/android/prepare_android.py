#!/usr/bin/env python3
"""Apply Android permissions and install the shared CRM launcher branding."""
from pathlib import Path
import subprocess
import sys

manifest = Path("android/app/src/main/AndroidManifest.xml")
if not manifest.exists():
    raise SystemExit(f"Android manifest not found: {manifest}")
source = manifest.read_text(encoding="utf-8")
permissions = [
    '    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
    '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
]
for permission in permissions:
    if permission not in source:
        marker = "    <application"
        if marker not in source:
            raise SystemExit("Could not find Android application element.")
        source = source.replace(marker, permission + "\\n" + marker, 1)
gps = '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />'
if gps not in source:
    source = source.replace("    <application", gps + "\\n    <application", 1)
manifest.write_text(source, encoding="utf-8")
subprocess.run([sys.executable, "scripts/branding/generate_icons.py"], check=True)
