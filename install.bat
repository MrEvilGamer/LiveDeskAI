@echo off
setlocal
cd /d "%~dp0"
py -3.11 -m venv .venv
if errorlevel 1 py -3 -m venv .venv
if errorlevel 1 (echo Install Python 3.11 x64 from https://www.python.org/downloads/windows/ and retry.& pause & exit /b 1)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (echo Dependency install failed. Check Python version and internet connection.& pause & exit /b 1)
echo Install complete. Run run.bat next.
pause
