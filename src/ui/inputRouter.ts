// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import type { ISTerm } from "../isterm/pty.js";
import { getBackspaceSequence, Shell } from "../utils/shell.js";
import type { KeyPressEvent, SuggestionManager } from "./suggestionManager.js";

type RouterOptions = {
  term: Pick<ISTerm, "write" | "noop" | "isAlternateBuffer">;
  suggestions: Pick<SuggestionManager, "update" | "consumeRefreshRequest" | "invalidate" | "noteInput">;
  shell: Shell;
  hasVisibleSuggestions: () => boolean;
  requestSuggestions: () => void;
  onBackspaceEcho?: () => void;
};

// Decides for every key whether the list takes it or the shell gets it.
export class InputRouter {
  readonly #options: RouterOptions;
  #pasting = false;

  constructor(options: RouterOptions) {
    this.#options = options;
  }

  handle(...keyPress: KeyPressEvent): void {
    const { term, suggestions, shell, hasVisibleSuggestions, requestSuggestions, onBackspaceEcho } = this.#options;
    const press = keyPress[1];
    if (term.isAlternateBuffer()) {
      term.write(press.name === "backspace" ? getBackspaceSequence(keyPress, shell) : press.sequence);
      return;
    }

    // A paste goes to the shell as it is. Its Tab, newline or arrow is text, not a key for the list: a pasted
    // newline must not accept an entry, and the shell (with bracketed paste) does not run what is pasted.
    if (press.name === "paste-start") this.#pasting = true;
    if (this.#pasting) {
      if (press.name === "paste-end") {
        this.#pasting = false;
        suggestions.noteInput();
        suggestions.invalidate();
        requestSuggestions();
      }
      term.write(press.sequence);
      return;
    }

    const inputHandled = suggestions.update(press, hasVisibleSuggestions());
    if (suggestions.consumeRefreshRequest()) {
      suggestions.invalidate();
      requestSuggestions();
    }
    if (hasVisibleSuggestions() && inputHandled) {
      term.noop();
    } else if (!inputHandled) {
      if (press.name === "backspace") {
        onBackspaceEcho?.();
        term.write(getBackspaceSequence(keyPress, shell));
      } else {
        term.write(press.sequence);
      }
    }
  }
}
