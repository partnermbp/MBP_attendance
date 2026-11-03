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

# A compact orange/charcoal vector launcher icon for all Android densities.
resources = Path("android/app/src/main/res/drawable")
resources.mkdir(parents=True, exist_ok=True)
icon = resources / "ic_launcher.xml"
icon.write_text("""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="#111318" android:pathData="M0,0h108v108h-108z" />
    <path android:fillColor="#F97316"
        android:pathData="M20,25h13v48h-13z M43,39h13v34h-13z M66,17h13v56h-13z" />
    <path android:fillColor="#FFFFFF"
        android:pathData="M27,81l7,-7 11,11 27,-28 7,7 -34,35z" />
</vector>
""", encoding="utf-8")

# Prefer the same native artwork for normal and round launcher icons.
import re
application_match = re.search(r"<application\b[^>]*>", source, flags=re.DOTALL)
if not application_match:
    raise SystemExit("Could not find the Android application element.")
application = application_match.group(0)
for attribute in ("icon", "roundIcon"):
    pattern = rf'android:{attribute}="[^"]*"'
    replacement = f'android:{attribute}="@drawable/ic_launcher"'
    if re.search(pattern, application):
        application = re.sub(pattern, replacement, application, count=1)
    else:
        application = application[:-1] + f' {replacement}>'
source = source[:application_match.start()] + application + source[application_match.end():]
manifest.write_text(source, encoding="utf-8")
print("Android location permissions and MBP launcher icon configured.")

