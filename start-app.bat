@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo  Subscription Tracking Agent - Starting Up
echo ============================================
echo.

echo [1/4] Starting Postgres via Docker...
docker compose up -d
if errorlevel 1 (
    echo.
    echo Could not start Docker containers. Make sure Docker Desktop is running, then try again.
    pause
    exit /b 1
)

echo [2/4] Waiting for Postgres to be ready...
set /a tries=0
:waitloop
docker compose exec -T db pg_isready -U postgres >nul 2>&1
if not errorlevel 1 goto ready
set /a tries+=1
if !tries! GEQ 30 (
    echo.
    echo Postgres did not become ready in time. Check "docker compose logs db".
    pause
    exit /b 1
)
timeout /t 2 >nul
goto waitloop
:ready

echo [3/4] Applying database migrations...
call npx prisma migrate deploy
if errorlevel 1 (
    echo.
    echo Migration failed. See the error above.
    pause
    exit /b 1
)
call npm run db:seed >nul 2>&1

echo [4/4] Starting the app...
start "Subscription Tracker - Dev Server (close this window to stop the app)" cmd /k npm run dev

timeout /t 6 >nul
start "" http://localhost:3000

echo.
echo The app is starting in a separate window titled "Subscription Tracker - Dev Server".
echo Close that window (or Ctrl+C in it) to stop the app. This window will close shortly.
timeout /t 4 >nul
