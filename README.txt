ENIGMA - HOW TO BUILD YOUR .EXE
================================

STEP 1 - Install Node.js (if not already installed)
  Download from: https://nodejs.org
  Choose the "LTS" version for Windows
  Install it with all default settings

STEP 2 - Double-click "CLICK ME TO BUILD.bat"
  The window will show you everything happening
  First run takes 3-5 minutes (downloads Electron ~150MB)
  Do NOT close the window while it runs

STEP 3 - When done, the dist\ folder opens automatically
  You will see two files:
    Enigma-Setup-1.0.0.exe     <- Run this to install
    Enigma-Portable-1.0.0.exe  <- Runs without installing

STEP 4 - Launch Enigma
  Double-click the "Enigma" shortcut on your Desktop
  (This shows the correct purple icon in the taskbar)

  Or run:  npm start


IF THE BUILD FAILS
==================
The window will show the exact error. Common fixes:

  "node is not recognized"
    -> Install Node.js from nodejs.org first, then try again

  "npm install" fails
    -> Check your internet connection
    -> Try disabling antivirus temporarily

  "Build failed" / electron-builder error
    -> Right-click "CLICK ME TO BUILD.bat" -> Run as Administrator

  Window closes immediately without showing anything
    -> Right-click "CLICK ME TO BUILD.bat" -> Run as Administrator


KEYBOARD SHORTCUTS IN ENIGMA
=============================
Ctrl+T          New tab
Ctrl+W          Close tab
Ctrl+L          Address bar
Ctrl+F          Find on page
Ctrl+B          Bookmarks
Ctrl+H          History
Ctrl+D          Bookmark this page
Ctrl+Shift+N    New incognito session
Ctrl+[ / ]      Back / Forward
Ctrl++ / -      Zoom in / out
