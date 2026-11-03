#!/usr/bin/env python3
"""Apply Android-specific settings after Capacitor creates the native project."""
from pathlib import Path

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
            raise SystemExit("Could not find the Android application manifest element.")
        source = source.replace(marker, permission + "\n" + marker, 1)

gps_feature = '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />'
if gps_feature not in source:
    marker = "    <application"
    source = source.replace(marker, gps_feature + "\n" + marker, 1)

manifest.write_text(source, encoding="utf-8")
print("Android location permissions configured.")
