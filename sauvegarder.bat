@echo off
setlocal
set "EXE=%~dp0publish\RapportQuart.exe"
if not exist "%EXE%" set "EXE=%~dp0RapportQuart.exe"
if not exist "%EXE%" goto introuvable
"%EXE%" /sauvegarde "%~dp0Sauvegardes"
if errorlevel 1 goto erreur
echo Sauvegarde chiffree creee dans "%~dp0Sauvegardes".
pause
exit /b 0
:introuvable
echo RapportQuart.exe est introuvable. Publiez le projet ou placez ce fichier a cote de l'executable.
pause
exit /b 1
:erreur
echo La sauvegarde a echoue. Consultez le journal de l'application.
pause
exit /b 1