[Setup]
AppId={{7B2E5A64-3C1D-4F7B-9A0E-5D8C1E2F4A61}
AppName=Rapport Chef de Quart
AppVersion=1.0
DefaultDirName={autopf}\RapportQuart
DefaultGroupName=Rapport Chef de Quart
OutputDir=installateur
OutputBaseFilename=Installer_Rapport_Chef_Quart
SetupIconFile=exat_agri_fb.ico
UninstallDisplayIcon={app}\RapportQuart.exe
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
AppPublisher=Blanchard YAO
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Files]
Source: "publish\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
; Dossier de la base, partage entre toutes les sessions Windows du PC
Name: "{commonappdata}\RapportQuart"; Permissions: users-modify

[Icons]
Name: "{commondesktop}\RapportQuart"; Filename: "{app}\RapportQuart.exe"; WorkingDir: "{app}"; IconFilename: "{app}\RapportQuart.exe"
Name: "{group}\RapportQuart"; Filename: "{app}\RapportQuart.exe"; WorkingDir: "{app}"; IconFilename: "{app}\RapportQuart.exe"

[Run]
Filename: "{app}\RapportQuart.exe"; WorkingDir: "{app}"; Description: "Lancer Rapport Chef de Quart"; Flags: postinstall nowait skipifsilent runasoriginaluser
