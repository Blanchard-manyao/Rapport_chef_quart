@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo   Construction de Rapport Chef de Quart
echo   (a faire UNE SEULE FOIS, sur un PC avec Internet et le SDK .NET 8 ou plus recent)
echo ==============================================

where dotnet >nul 2>nul
if errorlevel 1 goto nodotnet

if exist publish rmdir /s /q publish
dotnet publish RapportQuart.csproj -c Release -r win-x64 --self-contained true -o publish
if errorlevel 1 goto erreur

echo.
echo Programme cree dans publish\RapportQuart.exe

set ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe
if not exist "%ISCC%" set ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe
if not exist "%ISCC%" goto sansinno
"%ISCC%" installateur.iss
if errorlevel 1 goto erreur
echo.
echo TERMINE. Copiez installateur\Installer_Rapport_Chef_Quart.exe sur le PC du bureau et lancez-le.
pause
exit /b 0

:sansinno
echo.
echo Inno Setup n'est pas installe (gratuit: jrsoftware.org/isdl.php).
echo Installez-le puis relancez ce fichier pour obtenir un vrai installateur.
echo Sinon, copiez tout le dossier publish sur le PC du bureau et lancez RapportQuart.exe.
pause
exit /b 0

:nodotnet
echo Le SDK .NET n'est pas installe.
echo Installez le SDK .NET 8 (ou plus recent) depuis dotnet.microsoft.com/download puis relancez.
pause
exit /b 1

:erreur
echo Une erreur est survenue. Copiez tout le texte affiche ci-dessus et envoyez-le moi.
pause
exit /b 1
