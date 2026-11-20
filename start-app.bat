@echo off
setlocal
cd /d "%~dp0"
rem Prefer the newest completed portable build, including staged fixes.
set "liveDeskBuild="
for /f "delims=" %%F in ('dir /b /a-d /o-d "%~dp0dist\LiveDeskAI*.exe" 2^>nul') do if not defined liveDeskBuild set "liveDeskBuild=%%F"
if defined liveDeskBuild (
  start "" "%~dp0dist\%liveDeskBuild%"
  exit /b
)
echo First run - installing dependencies and starting in dev mode...
echo (run "npm run dist" once to build dist\LiveDeskAI.exe)
if not exist node_modules call npm install
call npm start
