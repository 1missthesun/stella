import fs from 'fs'
import path from 'path'

// The window icon for Windows and Linux. Without a usable one, the title bar,
// taskbar button and Alt-Tab fall back to electron.exe's icon. electronDir is
// the bundle's folder, packages/desktop/dist-electron/electron. macOS takes
// its icon from the Electron identity bundle (Stella.app) instead.
export const resolveAppIconPath = (electronDir: string): string | undefined => {
  const desktopRoot = path.resolve(electronDir, '..', '..')
  const uiRoot = path.join(path.dirname(desktopRoot), 'desktop-ui')
  const candidates = [
    ...(process.platform === 'win32' ? [path.join(desktopRoot, 'build', 'icon.ico')] : []),
    path.join(desktopRoot, 'build', 'icon.png'),
    path.join(uiRoot, 'dist', 'stella-app-icon.png'),
    path.join(uiRoot, 'public', 'stella-app-icon.png'),
  ]
  return candidates.find((candidatePath) => fs.existsSync(candidatePath))
}
