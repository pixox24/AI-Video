@echo off
cd /d "%~dp0"
title AI-Video
chcp 65001 >nul
echo.
echo   AI-Video 工作室
echo   http://localhost:3000
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 pause
