#!/usr/bin/env bash
# Builds dist/CrystalSync-<ver>-x86_64.AppImage and dist/crystal-sync_<ver>_amd64.deb (unsigned).
set -euo pipefail; cd "$(dirname "$0")/.."; PY=${PY:-python3}
VER=$($PY -c "import crystal_sync;print(crystal_sync.__version__)")
[ -n "${SKIP_PYI:-}" ] || $PY -m PyInstaller --noconfirm --clean --onefile --name crystal-sync --hidden-import keyring.backends.SecretService --hidden-import keyring.backends.kwallet \
  --collect-submodules crystal_sync packaging/entry.py >/dev/null
mkdir -p dist; rm -rf build/AppDir build/deb
# AppImage
A=build/AppDir; mkdir -p $A/usr/bin; cp dist/crystal-sync $A/usr/bin/
cat > $A/AppRun <<'R'
#!/bin/sh
exec "$(dirname "$(readlink -f "$0")")/usr/bin/crystal-sync" "$@"
R
chmod +x $A/AppRun; cp packaging/crystal-sync.png $A/crystal-sync.png
printf '[Desktop Entry]\nType=Application\nName=Crystal Sync\nExec=crystal-sync\nIcon=crystal-sync\nCategories=Utility;\nTerminal=false\n' > $A/crystal-sync.desktop
AIT=${APPIMAGETOOL:-/tmp/appimagetool}; [ -x "$AIT" ] || { curl -sL -o "$AIT" https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage; chmod +x "$AIT"; }
command -v file >/dev/null || { mkdir -p build/shim; printf '#!/bin/sh\nfor f; do echo "$f: ELF 64-bit LSB executable, x86-64"; done\n' > build/shim/file; chmod +x build/shim/file; export PATH=$PWD/build/shim:$PATH; }
ARCH=x86_64 "$AIT" --appimage-extract-and-run $A dist/CrystalSync-$VER-x86_64.AppImage >/dev/null 2>&1
# .deb
D=build/deb; mkdir -p $D/DEBIAN $D/usr/bin $D/usr/share/applications $D/usr/share/icons/hicolor/256x256/apps
cp dist/crystal-sync $D/usr/bin/; cp packaging/crystal-sync.png $D/usr/share/icons/hicolor/256x256/apps/
cp $A/crystal-sync.desktop $D/usr/share/applications/
printf "Package: crystal-sync\nVersion: $VER\nArchitecture: amd64\nMaintainer: Crystal <iamrolan@gmail.com>\nDepends: libsecret-1-0 | gnome-keyring\nDescription: Crystal Sync - pulls your child's ParentVUE school data to Crystal\n" > $D/DEBIAN/control
dpkg-deb --root-owner-group --build $D dist/crystal-sync_${VER}_amd64.deb >/dev/null
ls -la dist
