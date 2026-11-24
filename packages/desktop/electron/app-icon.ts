import fs from 'fs'
import path from 'path'

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
