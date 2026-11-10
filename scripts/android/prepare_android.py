#!/usr/bin/env python3
"""Apply Android location permissions using namespace-safe XML editing."""
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
manifest = ROOT / "android/app/src/main/AndroidManifest.xml"
if not manifest.exists():
    raise SystemExit(f"Android manifest not found: {manifest}")

ANDROID_NS = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID_NS)
android = lambda name: f"{{{ANDROID_NS}}}{name}"

tree = ET.parse(manifest)
root = tree.getroot()

# Ensure the Android namespace is declared by serializing namespaced attributes,
# not by inserting raw XML text (which can leave an unbound android: prefix).
permissions = {
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
}
existing = {
    node.get(android("name"))
    for node in root.findall("uses-permission")
}
application = root.find("application")
if application is None:
    raise SystemExit("Android application element missing")

for permission in sorted(permissions - existing):
    node = ET.Element("uses-permission")
    node.set(android("name"), permission)
    root.insert(list(root).index(application), node)

features = root.findall("uses-feature")
gps_declared = any(
    node.get(android("name")) == "android.hardware.location.gps"
    for node in features
)
if not gps_declared:
    node = ET.Element("uses-feature")
    node.set(android("name"), "android.hardware.location.gps")
    node.set(android("required"), "false")
    root.insert(list(root).index(application), node)

tree.write(manifest, encoding="utf-8", xml_declaration=True)

# Keep Android package metadata aligned with the current app release.
gradle = ROOT / "android/app/build.gradle"
if gradle.exists():
    lines = gradle.read_text(encoding="utf-8").splitlines()
    code_updated = False
    name_updated = False
    for index, line in enumerate(lines):
        stripped = line.strip()
        indent = line[:len(line) - len(line.lstrip())]
        if stripped.startswith("versionCode "):
            lines[index] = indent + "versionCode 2"
            code_updated = True
        elif stripped.startswith("versionName "):
            lines[index] = indent + 'versionName "0.1.1"'
            name_updated = True
    if not code_updated or not name_updated:
        raise SystemExit("Could not update Android versionCode/versionName")
    gradle.write_text("\\n".join(lines) + "\\n", encoding="utf-8")

# Generate shared PWA/iOS assets and the Android launcher icon set.
subprocess.run(
    [sys.executable, str(ROOT / "scripts/branding/generate_icons.py")],
    cwd=ROOT,
    check=True,
)
