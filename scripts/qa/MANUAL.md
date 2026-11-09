# Manual checks before a release

What the automatic runs cannot see: how the list looks in a real terminal app, and what a real keyboard sends.
About 5 minutes per app. Use a fresh tab in the project folder of terminalhinter itself.

## 1. Record the keys (once per app)

```bash
thint debug keys
```

Press each key it asks for. It saves `~/thint-keys-<app>.json`. Send the files back.

## 2. Look at the list (per app)

| # | Type | What should be on the screen |
| --- | --- | --- |
| 1 | `git ` | The list opens under the line, borders straight, nothing cut on the right |
| 2 | `git sta` then Down, Down | The highlight moves, the row background fills the whole width of the list |
| 3 | Shift+Down | The entry moves one row down |
| 4 | Esc, then `t` | The list closes on Esc and opens again on `t` |
| 5 | Ctrl+U, `cd ` then Enter on a folder | The line shows the folder, the list stays open with what is inside |
| 6 | Ctrl+U, `gti status` Enter, then Tab | After the error the empty line offers `git status`; Tab puts it on the line |
| 7 | Ctrl+U, `ls -la \| grep x` then Ctrl+G | Each word explained, the list fits in the window |
| 8 | Make the window very small (about 40 × 10) and type `git ` | The list fits or goes above the line, nothing is left behind after Enter |
| 9 | Option+Left / Option+Right (Alt on Windows) | The cursor jumps by words like without thint |
| 10 | Type `ąęł` and an emoji | They show correctly and the list stays aligned |
| 11 | Paste two lines | They are pasted as they are, nothing runs on its own |
| 12 | Run `vim` or `less README.md`, quit | The screen comes back clean, the list works again |
| 13 | Switch the system to dark and light mode | The list is readable in both |

Apps on the Mac: iTerm2, Terminal.app, Ghostty, WezTerm, Kitty, Alacritty, VS Code, Cursor; then iTerm2 with tmux.

Apps on Windows: Windows Terminal with PowerShell 7, Windows PowerShell 5.1, cmd and Git Bash; the old console
(conhost); VS Code with PowerShell. Also try a fresh install with `npm i -g @erykkozyra/terminalhinter` and watch for
Defender or SmartScreen warnings on the first start.

## 3. Updating with a tab open (Mac)

Open a tab, run `npm i -g @erykkozyra/terminalhinter@latest` in another one, then go back to the first tab and type
`git st`. The list should still open there. In CI on macOS it did not (on Linux it does), so this needs a real Mac.
Checked on a Mac on 2026-11-09 (update to 1.2.0): the list opened in the old tab, so what CI showed comes from its
own runner.

## 4. Open Windows items (PC)

What CI on Windows could not settle (run 11). Checked on a PC on 2026-11-09: all four fine in Windows Terminal, so
what CI showed there comes from its own terminal. Check again after changes to drawing or key handling on Windows.
In Windows Terminal at about 40 × 10:

1. `thint debug keys` in PowerShell 7, cmd and Git Bash: does Ctrl+Space arrive? Then Esc and Ctrl+Space: does the
   list come back?
2. cmd and Windows PowerShell 5.1: type `echo ąęł 🚀` so it reaches the right edge, then Enter. No piece of the
   border should stay behind.
3. cmd: type `git push --force` fast. Every letter should be on the line.
4. Git Bash: type `git sta`, Tab, then drag the window size back and forth. The line should say `git stage` or
   `git status` in full.

## 5. Write down

For anything that looks wrong: the app, the shell, the window size, a screenshot, and the step number.
