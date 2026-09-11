@echo off
chcp 65001 >nul
title Banca DG - Servidor local
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo  No se encontro Node.js. Instalelo desde https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo  Instalando componentes...
  call npm install --no-audit --no-fund
)

if not exist ".env" (
  echo.
  echo  Falta el archivo .env con la conexion a Supabase.
  echo  Copie .env.example a .env y complete DATABASE_URL.
  echo.
  pause
  exit /b 1
)

echo.
echo  Abriendo el sistema en el navegador...
start "" http://localhost:3000

node src/server.js

echo.
echo  El servidor se detuvo.
pause
