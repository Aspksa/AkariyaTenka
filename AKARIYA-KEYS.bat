@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Akariya Tenka - Secure Key Setup
cd /d "%~dp0"
if errorlevel 1 goto error
if not exist "scripts\import-publisher-key.mjs" goto error
if not exist "scripts\bootstrap-node.ps1" goto error
set "NODE_EXE=%CD%\.runtime\node\node.exe"
if not exist "%NODE_EXE%" (
  echo Portable Node.js not found. Installing verified runtime...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\bootstrap-node.ps1" -Dest "%CD%\.runtime"
  if errorlevel 1 goto error
)
"%NODE_EXE%" -e "process.exit(Number(process.versions.node.split('.')[0])>=20?0:1)"
if errorlevel 1 goto error
chcp 65001 >nul
echo.
echo Akariya Tenka - publisher key import
echo.
if exist "C:\AkariyaPublisherKeys\publisher-private.pem" (
  echo Using the existing local key folder.
  "%NODE_EXE%" "scripts\import-publisher-key.mjs" "C:\AkariyaPublisherKeys"
) else (
  echo Key folder was not found in the standard location.
  echo Enter an absolute folder path that contains your three publisher key files.
  set /p "KEY_DIR=Key folder: "
  if not defined KEY_DIR goto error
  "%NODE_EXE%" "scripts\import-publisher-key.mjs" "%KEY_DIR%"
)
if errorlevel 1 goto error
echo.
echo Key import verified and completed.
echo Preserve an independent secure backup before removing the original files.
pause
exit /b 0
:error
echo.
echo [ERROR] Key setup did not complete. No original keys were deleted.
pause
exit /b 1
