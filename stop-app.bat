@echo off
cd /d "%~dp0"
echo Stopping the Postgres container...
docker compose down
echo.
echo Postgres stopped.
echo If the app's dev server window is still open, close it (or press Ctrl+C in it) to fully stop the app.
pause
