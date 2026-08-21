; disk-clean GUI — Inno Setup installer script
; Build: powershell -File scripts\build-installer.ps1
; Expects staged files in gui\stage\: disk-clean-ui.exe, engine.exe, web\, LICENSE
; Downloads missing .NET 8 Desktop Runtime / WebView2 via official bootstrappers.

#define MyAppName "disk-clean"
#define MyAppVersion "0.4.0"
#define MyAppPublisher "ShuiQiongChuYunQiShi"
#define MyAppExeName "disk-clean-ui.exe"

[Setup]
AppId={{8E1F3C2A-5B4D-4A9E-9C2F-D1B7A5E6C0D3}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\disk-clean
DefaultGroupName=disk-clean
DisableProgramGroupPage=yes
PrivilegesRequired=admin
OutputDir=..\gui\dist
OutputBaseFilename=disk-clean-setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=..\gui\shell\app.ico
WizardStyle=modern

[Languages]
; Inno Setup 6 official install lacks ChineseSimplified.isl; wizard stays English.
; The app UI itself is bilingual (zh/en). Download Chinese language file if desired.
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\gui\stage\disk-clean-ui.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\gui\stage\engine.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\gui\stage\web\*"; DestDir: "{app}\web"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\gui\stage\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\disk-clean"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,disk-clean}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\disk-clean"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,disk-clean}"; Flags: nowait postinstall skipifsilent

[Code]
// -------- helpers: declare before use (PascalScript has no forward refs) --------
function DownloadAndRun(const Url, FileName: String): Boolean;
var
  tmpPath: String;
  code: Integer;
  dl: Int64;
begin
  // BaseName must be a bare filename: the file lands in {tmp} automatically.
  // signature: function DownloadTemporaryFile(const Url, BaseName, RequiredSHA256OfFile: String; const OnDownloadProgress): Int64;  (failure = -1)
  dl := DownloadTemporaryFile(Url, FileName, '', nil);
  if dl < 0 then begin
    Result := False;
    exit;
  end;
  tmpPath := ExpandConstant('{tmp}\') + FileName;
  if not Exec(tmpPath, '/install /quiet /norestart', '', SW_HIDE, ewWaitUntilTerminated, code) then begin
    Result := False;
    exit;
  end;
  Result := (code = 0);
end;

// -------- runtime detection --------
function IsDotNet8DesktopInstalled(): Boolean;
var
  fr: TFindRec;
begin
  // Most reliable: check the shared WindowsDesktop.App folder for an 8.0.x runtime.
  // (registry layout differs across installers; folder check covers all of them)
  if DirExists(ExpandConstant('{autopf}\dotnet\shared\Microsoft.WindowsDesktop.App')) and
     FindFirst(ExpandConstant('{autopf}\dotnet\shared\Microsoft.WindowsDesktop.App\8.0.*'), fr) then begin
    FindClose(fr);
    Result := True;
    exit;
  end;
  // fallback: per-machine install location
  if DirExists('C:\Program Files\dotnet\shared\Microsoft.WindowsDesktop.App') and
     FindFirst('C:\Program Files\dotnet\shared\Microsoft.WindowsDesktop.App\8.0.*', fr) then begin
    FindClose(fr);
    Result := True;
    exit;
  end;
  Result := False;
end;

function IsWebView2Installed(): Boolean;
begin
  // WebView2 runtime: per-machine or per-user registration key.
  Result := RegKeyExists(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')
         or RegKeyExists(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}');
end;

function InitializeSetup(): Boolean;
var
  dotnetMissing, webviewMissing: Boolean;
  ans: Integer;
begin
  dotnetMissing := not IsDotNet8DesktopInstalled();
  webviewMissing := not IsWebView2Installed();

  if dotnetMissing and webviewMissing then begin
    ans := MsgBox('此程序需要 .NET 8 Desktop Runtime 和 WebView2 运行时。'#13#13'是否立即下载并安装？（约 40 MB）', mbConfirmation, MB_YESNO);
    if ans <> IDYES then begin
      Result := False;
      exit;
    end;
    // Download both bootstrappers to temp and run silently.
    if not DownloadAndRun('https://aka.ms/dotnet/8.0/runtime-desktop-8.0.x-win-x64.exe', 'dotnet8-runtime.exe') then begin
      MsgBox('.NET 8 运行时下载/安装失败。请安装后重试：https://dotnet.microsoft.com/download/dotnet/8.0', mbError, MB_OK);
      Result := False;
      exit;
    end;
    if not DownloadAndRun('https://go.microsoft.com/fwlink/p/?LinkId=2124703', 'webview2-runtime.exe') then begin
      MsgBox('WebView2 运行时下载/安装失败。请安装后重试：https://developer.microsoft.com/microsoft-edge/webview2/', mbError, MB_OK);
      Result := False;
      exit;
    end;
    Result := True;
  end
  else if dotnetMissing then begin
    ans := MsgBox('此程序需要 .NET 8 Desktop Runtime，当前未安装。'#13#13'是否立即下载并安装？（约 25 MB）', mbConfirmation, MB_YESNO);
    if ans <> IDYES then begin
      Result := False;
      exit;
    end;
    if not DownloadAndRun('https://aka.ms/dotnet/8.0/runtime-desktop-8.0.x-win-x64.exe', 'dotnet8-runtime.exe') then begin
      MsgBox('.NET 8 运行时下载/安装失败。请安装后重试：https://dotnet.microsoft.com/download/dotnet/8.0', mbError, MB_OK);
      Result := False;
      exit;
    end;
    Result := True;
  end
  else if webviewMissing then begin
    ans := MsgBox('此程序需要 WebView2 运行时，当前未安装。'#13#13'是否立即下载并安装？（约 15 MB）', mbConfirmation, MB_YESNO);
    if ans <> IDYES then begin
      Result := False;
      exit;
    end;
    if not DownloadAndRun('https://go.microsoft.com/fwlink/p/?LinkId=2124703', 'webview2-runtime.exe') then begin
      MsgBox('WebView2 运行时下载/安装失败。请安装后重试：https://developer.microsoft.com/microsoft-edge/webview2/', mbError, MB_OK);
      Result := False;
      exit;
    end;
    Result := True;
  end
  else begin
    Result := True;
  end;
end;