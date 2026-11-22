@echo off
setlocal
where node.exe >nul 2>nul
if errorlevel 1 goto bundled
node "%~dp0check-categories.cjs"
goto finished
:bundled
"C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-1116-1220-0_26.1116.1220.0_x64__3k8sg7r9htsxt\dependencies\node\bin\node.exe" "%~dp0check-categories.cjs"
:finished
if /i "%~1"=="--no-pause" exit /b %errorlevel%
pause
