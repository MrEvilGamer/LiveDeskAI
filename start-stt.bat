@echo off
cd /d "%~dp0"
echo Starting local transcription server (faster-whisper) on port 8399...
".venv\Scripts\python.exe" stt_server.py --model base --port 8399
pause
