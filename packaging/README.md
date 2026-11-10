# Distribution packages

Package-manager listings for Stella's launcher. Each one ships the same
launcher binary as stella.sh, pinned to an unchanging copy under
`launcher/releases/<version>/` on the releases bucket (written by
`build-launchers.yml` on every publish, next to `launcher/stable/`). The
launcher then updates itself as usual, so these listings only need a bump when
we want new installs to start from a newer launcher.

## AUR: `stella-desktop-bin`

`yay -S stella-desktop-bin` → https://aur.archlinux.org/packages/stella-desktop-bin
(account `fromyou`, SSH key `~/.ssh/aur_stella` on omarchy; as of 2026-11-10 not yet
published: the AUR has paused new account registrations).

Not `stella`/`stella-bin`: Arch's official `stella` is the Atari 2600 emulator,
which owns `/usr/bin/stella`, `stella.desktop` and the `stella` icon. This
package installs alongside it:

| Path | What |
| --- | --- |
| `/usr/lib/stella-desktop/stella-launcher` | the released Linux launcher |
| `/usr/bin/stella-desktop` | wrapper: runs the per-user launcher when it's at least as new, else the packaged one |
| `/usr/share/applications/stella-desktop.desktop`, `/usr/share/pixmaps/stella-desktop.png` | menu entry and icon |

The launcher can't update files under `/usr`, so it keeps its updates where a
curl install does (`~/.local/share/stella/bin/stella-launcher`): the packaged
launcher copies itself there on first start, and the wrapper prefers that copy
once it's as new or newer. The wrapper sets `STELLA_LAUNCHER_PACKAGED=1`;
launchers that know it don't write their own `~/.local/share/applications/stella.desktop`
(and remove one an earlier curl install wrote), so the menu shows one Stella.
Older launchers ignore it and add a second menu entry that also works.

Bump after a launcher publish (or to re-pin the icon/LICENSE):

```sh
packaging/aur/bump.sh            # to launcher/stable/VERSION
packaging/aur/bump.sh --push     # ...and publish to the AUR
```

Then commit the changed `PKGBUILD`/`.SRCINFO` here. A package-only change:
raise `pkgrel` by hand, then `bump.sh <current version> --push`.

## winget: `FROMYOU.Stella`

`winget install FROMYOU.Stella`. Manifests for microsoft/winget-pkgs live under
`winget/manifests/`. Stella.exe is a portable install (winget copies it and adds
a `stella-desktop` command; the Atari emulator Stella is also on winget, as TheStellaTeam.Stella); on first start it installs itself into
`%LOCALAPPDATA%\Programs\Stella` with a Start-menu shortcut and updates itself
there. A new version is a copy of the folder with the new version, URL
(`launcher/releases/<n>/Stella.exe`) and SHA256, opened as a PR to
microsoft/winget-pkgs (`PackageVersion` is `1.0.<launcher version>`, matching
Stella.exe's file version).
