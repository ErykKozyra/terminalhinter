# inshellisense, wersja w stylu Kiro

Fork [microsoft/inshellisense](https://github.com/microsoft/inshellisense) z dropdownem i nawigacją jak w Kiro CLI (dawny Fig).

## Co jest inaczej niż w oryginale

**Nawigacja po folderach Enterem**
- `cd web` + Enter wstawia `websites/` i lista zostaje otwarta z zawartością folderu.
- Na górze listy jest pozycja `↪` ("Enter the current directory"). Enter na niej wykonuje komendę.
- Strzałki wybierają folder, Enter schodzi poziom niżej. I tak dalej, aż Enter na `↪`.

**Kiedy Enter akceptuje, a kiedy wykonuje**
- W trakcie pisania słowa pierwsza pozycja jest zaznaczona i Enter ją wstawia (`git che` + Enter daje `git checkout `).
- Zaraz po spacji nic nie jest zaznaczone, więc Enter po prostu odpala komendę. Strzałka w dół zaznacza pierwszą pozycję.
- Jeśli słowo jest już wpisane w całości (`git status`), Enter je wykonuje.
- Tab zawsze wstawia zaznaczoną (albo pierwszą) pozycję, Esc zamyka listę.
- Strzałka w górę, gdy nic nie jest zaznaczone, idzie do historii shella jak normalnie.

**Wygląd**
- Jedna ramka z zaokrąglonymi rogami, opis zaznaczonej pozycji w stopce pod listą, licznik pozycji przy dłuższych listach.
- Pełny niebieski pasek zaznaczenia i kolorowe ikonki, które działają w każdym terminalu bez dodatkowych fontów (szczegóły niżej).
- Podpowiedzi argumentów obok nazwy, np. `checkout [branch, file, tag or commit]`, `cherry-pick <commit...>`.
- Wpisany fragment podświetlony na żółto, lista przewija się płynnie zamiast skakać stronami.
- Ramka ustawia się pod słowem, które uzupełniasz.

## Ikonki

Domyślnie ikonki to zwykłe kolorowe znaki, które ma każdy font terminala, więc nie trzeba nic instalować ani ustawiać: niebieski kwadrat przy folderach, `≡` przy plikach, fioletowy `$` przy subkomendach, pomarańczowy `-` przy opcjach, zielony `#` przy wartościach (branche, skrypty), żółta `*` przy aktualnym branchu i czerwony `>` przy `↪`. Na zaznaczonym wierszu ikonka robi się biała.

Dwa inne style do wyboru w `~/.inshellisenserc`:
- `iconStyle = "badge"`: znak na kolorowym kwadraciku. Uwaga, w kolejnych wierszach kwadraciki zlewają się w pionowy pasek.
- `iconStyle = "nerd"`: płaskie ikonki i zaokrąglone pigułki z fontu Nerd Font. Wymaga ustawienia takiego fontu w terminalu.

## Instalacja (macOS)

Do zbudowania potrzebny jest Node (dowolna wersja z nvm), do działania już nie.

```bash
cd ~/Dev/inshellisense-kiro
./zainstaluj.sh
```

Skrypt buduje binarkę z zaszytym Node i instaluje ją jako `~/.local/bin/is`, poza nvm. Zmiana wersji Node w systemie nie ma na nią wpływu. Jeśli `~/.local/bin` nie było w PATH, skrypt dopisze to na początku `~/.zshrc`. Wersja z npm (`@microsoft/inshellisense`) nie jest już potrzebna i można ją usunąć: `npm uninstall -g @microsoft/inshellisense`.

Usunięcie forka: `./przywroc.sh`.

## Ustawienia (`~/.inshellisenserc`)

Linijkę z `acceptSuggestion = "return"` możesz usunąć, Enter działa teraz sam z siebie.

```toml
maxSuggestions = 6                        # ile pozycji widać naraz
activeSuggestionBackgroundColor = "#2F5FD0"
borderColor = "#4B5263"
boxBorderStyle = "rounded"                # albo "square"
enterAcceptsSuggestion = true             # false: Enter zawsze wykonuje komendę, wstawianie tylko Tabem
iconStyle = "plain"                       # "plain" (domyślnie), "badge" albo "nerd"
```

## Szybszy start nowej karty (opcjonalnie)

Domyślny blok inshellisense jest na końcu `.zshrc`, więc oh-my-zsh ładuje się dwa razy: raz w zewnętrznym shellu, drugi raz w tym, który odpala inshellisense. Jeśli przeniesiesz blok na **samą górę** `.zshrc`, zewnętrzny shell od razu przekazuje pałeczkę i całość ładuje się raz:

```zsh
# inshellisense, na samej górze .zshrc
if [[ -z "${ISTERM}" && $- = *i* && ${+ZSH_EXECUTION_STRING} -eq 0 && -z "${VSCODE_RESOLVING_ENVIRONMENT}" ]] && command -v is >/dev/null 2>&1; then
  if [[ -o login ]]; then is -s zsh --login; else is -s zsh; fi
  exit
fi
```

i usuń stary blok z dołu. Jeśli `is` jest dostępne dopiero po załadowaniu czegoś w `.zshrc` (np. nvm), ten wariant nie wystartuje, wtedy zostań przy bloku na dole.

## Dla programisty

- Zmiany: `src/ui/suggestionManager.ts` (renderowanie i klawisze), `src/runtime/runtime.ts` i `src/runtime/suggestion.ts` (kontekst ścieżki, podpowiedzi argumentów), `src/utils/config.ts` (nowe opcje).
- Testy nawigacji: `src/tests/utils/kiroNavigation.test.ts`.
- Podgląd dropdowna bez terminala: `FORCE_COLOR=3 node --import=tsx scripts/preview.ts <folder> "cd web" "git che"`.
