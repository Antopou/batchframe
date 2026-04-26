@echo off
REM Launches Image Dataset Selector pre-loaded with the current cmd folder.
REM Place this batch file (or its containing folder) on PATH, then run `launch`
REM from any image folder to open the app there.

set "FOLDER=%CD%"
pushd "%~dp0"
start "" cmd /c npm run dev -- "%FOLDER%"
popd
