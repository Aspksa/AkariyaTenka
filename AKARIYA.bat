@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Akariya Tenka requires Node.js 20 or newer.
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo Akariya Tenka requires Node.js 20 or newer.
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm ci
  if errorlevel 1 exit /b 1
)
if not exist apps\web\dist (
  echo Building Akariya Tenka...
  call npm run build
  if errorlevel 1 exit /b 1
)
call npm start
