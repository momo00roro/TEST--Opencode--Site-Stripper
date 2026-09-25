@echo off
cd /d "C:\Users\Admin\Desktop\Coding-Projects\2026-09__TEST--Opencode--Site-Stripper\worker"
set PORT=8917

:loop
echo [%date% %time%] Starting server on port 8917... >> local-server.log
call npx tsx local/server.ts < NUL >> local-server.log 2>&1
echo [%date% %time%] Server stopped with exit code %ERRORLEVEL%. Restarting in 2 seconds... >> local-server.log
timeout /t 2 /nobreak > NUL
goto loop
