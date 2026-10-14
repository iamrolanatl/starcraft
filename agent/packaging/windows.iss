; Inno Setup script: per-user install (no admin), Start menu shortcut, launches setup on finish. Unsigned (see agent/README.md SIGNING TODO).
#define Ver GetEnv("CS_VER")
[Setup]
AppName=Crystal Sync
AppVersion={#Ver}
AppPublisher=Crystal
DefaultDirName={localappdata}\Programs\CrystalSync
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=CrystalSync-{#Ver}-Windows-Setup
Compression=lzma2
SolidCompression=yes
[Files]
Source: "..\dist\CrystalSync.exe"; DestDir: "{app}"; Flags: ignoreversion
[Icons]
Name: "{userprograms}\Crystal Sync"; Filename: "{app}\CrystalSync.exe"
[Run]
Filename: "{app}\CrystalSync.exe"; Description: "Open Crystal Sync setup"; Flags: nowait postinstall
[UninstallRun]
Filename: "{app}\CrystalSync.exe"; Parameters: "uninstall"; Flags: runhidden; RunOnceId: "cs-uninstall"
