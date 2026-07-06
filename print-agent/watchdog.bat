@echo off
title JESHA Print Agent
cd /d C:\JESHA\print-agent
:loop
echo [%date% %time%] Iniciando print-agent...
node agent.js
echo [%date% %time%] Agente detenido. Reiniciando en 10 segundos...
timeout /t 10 /nobreak >nul
goto loop
