// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import readline from "node:readline";
import { PassThrough } from "node:stream";
import { StringDecoder } from "node:string_decoder";

import * as ansi from "../utils/ansi.js";
import type { KeyPressEvent } from "./suggestionManager.js";

// eslint-disable-next-line no-control-regex
const cursorPositionReport = new RegExp("\\u001B\\[\\??\\d+;\\d+R", "g");
// the start of a report, or of any CSI key sequence, cut off at the end of a chunk
// eslint-disable-next-line no-control-regex
const partialCursorPositionReport = new RegExp("\\u001B\\[\\??[\\d;:]*$");
// blocks win32 input mode, the kitty keyboard protocol and xterm modifyOtherKeys from upgrading input & breaking node's readline
// eslint-disable-next-line no-control-regex
const keyEncodingUpgrade = new RegExp("\\u001B\\[(?:\\?9001([hl])|\\?u|[=><][\\d;]*u|>[\\d;]*m)", "g");
// a trailing portion of a key encoding upgrade
// eslint-disable-next-line no-control-regex
const partialKeyEncodingUpgrade = new RegExp("^\\u001B(?:\\[(?:\\?(?:9(?:0(?:0(?:1)?)?)?)?|[=><][\\d;]*)?)?$");
const carriageReturn = "\r".charCodeAt(0);
// how long a lone Esc waits for the rest of a key sequence that the terminal or ssh sent in two pieces
export const escapeWait = 20;

type Key = KeyPressEvent[1];

// A key in the kitty keyboard protocol (CSI code;mods u) or xterm modifyOtherKeys (CSI 27;mods;code ~), as some
// terminals send them without being asked (iTerm2 "report keys using CSI u", WezTerm enable_csi_u_key_encoding,
// tmux extended-keys always). The name and modifiers let thint's own keys work; the bytes stay as they came.
const extendedKeyName = (code: number): string | undefined => {
  if (code === 9) return "tab";
  if (code === 13) return "return";
  if (code === 27) return "escape";
  if (code === 127 || code === 8) return "backspace";
  if (code === 32) return "space";
  if (code > 32 && code < 127) return String.fromCharCode(code).toLowerCase();
  return undefined;
};

const csiAt = (input: string, start: number): { params: string; final: string; end: number } | undefined => {
  let end = start + 2;
  while (end < input.length && /[\d;:]/.test(input[end])) end++;
  if (end >= input.length || !/[\x40-\x7e]/.test(input[end])) return undefined;
  return { params: input.slice(start + 2, end), final: input[end], end: end + 1 };
};

// CSI sequences that readline does not understand and would split into several keypresses, the rest of the bytes
// typed as if they were letters: kitty keys, modifyOtherKeys, win32-input-mode, anything with ':' sub-fields.
const extendedKey = (params: string, final: string, sequence: string): Key | undefined => {
  const fields = params.split(";");
  const kitty = final === "u" && /^\d/.test(params);
  if (!kitty && final !== "_" && !params.includes(":") && fields.length < 3) return undefined;
  let code: number | undefined;
  let modifiers = 0;
  let released = false;
  if (kitty) {
    code = Number(fields[0].split(":")[0]);
    const [mods, event] = (fields[1] ?? "1").split(":");
    modifiers = Math.max(Number(mods || "1") - 1, 0);
    released = event === "3";
  } else if (final === "~" && fields.length === 3 && fields[0] === "27") {
    code = Number(fields[2]);
    modifiers = Math.max(Number(fields[1] || "1") - 1, 0);
  }
  const name = code == null || released ? undefined : extendedKeyName(code);
  return {
    sequence,
    name: name as string,
    shift: (modifiers & 1) !== 0,
    meta: (modifiers & 2) !== 0,
    ctrl: (modifiers & 4) !== 0,
  };
};

const getPartialKeyEncodingUpgrade = (input: string): string => {
  const sequenceStart = input.lastIndexOf("\u001B");
  if (sequenceStart === -1) return "";
  const suffix = input.slice(sequenceStart);
  return partialKeyEncodingUpgrade.test(suffix) ? suffix : "";
};

const replaceBareLineFeeds = (output: string): string => {
  let feed = output.indexOf("\n");
  if (feed === -1) return output;

  let replaced = "";
  let copiedTo = 0;
  for (; feed !== -1; feed = output.indexOf("\n", feed + 1)) {
    if (output.charCodeAt(feed - 1) === carriageReturn) continue;
    replaced += output.slice(copiedTo, feed);
    replaced += ansi.index;
    copiedTo = feed + 1;
  }
  return replaced + output.slice(copiedTo);
};

type StdioProxyOptions = {
  onCursorPositionReport?: (data: string) => void;
  onWin32InputMode?: (enabled: boolean) => void;
};

export class StdioProxy {
  readonly #keypressInput = new PassThrough();
  #decoder = new StringDecoder("utf8");
  readonly #onCursorPositionReport: (data: string) => void;
  readonly #onWin32InputMode: (enabled: boolean) => void;
  #pendingInput = "";
  #pendingOutput = "";
  #pendingEscape?: NodeJS.Timeout;

  constructor({ onCursorPositionReport = () => {}, onWin32InputMode = () => {} }: StdioProxyOptions = {}) {
    this.#onCursorPositionReport = onCursorPositionReport;
    this.#onWin32InputMode = onWin32InputMode;
    readline.emitKeypressEvents(this.#keypressInput as unknown as NodeJS.ReadStream);
  }

  onKeypress(listener: (...event: KeyPressEvent) => void): void {
    this.#keypressInput.on("keypress", (value: KeyPressEvent[0], key: Key) => {
      // Alt+arrow sent as Esc plus the arrow (iTerm2 and Terminal.app with Option as Esc+)
      if (key.sequence.startsWith("\u001b\u001b") && key.name) key = { ...key, meta: true };
      listener(value, key);
    });
  }

  handleInput(data: Buffer | string): void {
    const decoded = Buffer.isBuffer(data) ? this.#decoder.write(data) : this.#decoder.end() + data;
    if (!Buffer.isBuffer(data)) this.#decoder = new StringDecoder("utf8");
    this.#routeInput(this.#pendingInput + decoded);
  }

  handleOutput(data: string): string {
    const input = this.#pendingOutput + data;
    this.#pendingOutput = getPartialKeyEncodingUpgrade(input);
    const completeInput = this.#pendingOutput.length === 0 ? input : input.slice(0, -this.#pendingOutput.length);

    return replaceBareLineFeeds(
      completeInput.replace(keyEncodingUpgrade, (_sequence, win32Mode?: string) => {
        if (win32Mode != null) this.#onWin32InputMode(win32Mode === "h");
        return "";
      }),
    );
  }

  dispose(): string {
    this.#flushEscape();
    const remaining = this.#pendingInput + this.#decoder.end();
    this.#pendingInput = "";
    if (remaining.length !== 0) this.#keypressInput.write(remaining);
    this.#keypressInput.destroy();
    const pendingOutput = this.#pendingOutput;
    this.#pendingOutput = "";
    return pendingOutput;
  }

  #emit(key: Key): void {
    this.#keypressInput.emit("keypress", key.sequence, key);
  }

  #flushEscape(): void {
    if (this.#pendingEscape == null) return;
    clearTimeout(this.#pendingEscape);
    this.#pendingEscape = undefined;
    this.#emit({ sequence: "\u001b", name: "escape", ctrl: false, meta: false, shift: false });
  }

  #routeInput(input: string): void {
    if (this.#pendingEscape != null) {
      if (input === "\u001b") this.#flushEscape();
      else {
        // the rest of an arrow or an Alt+key that came in two pieces
        clearTimeout(this.#pendingEscape);
        this.#pendingEscape = undefined;
        input = "\u001b" + input;
      }
    }
    this.#pendingInput = input.match(partialCursorPositionReport)?.[0] ?? "";
    const completeInput = this.#pendingInput.length === 0 ? input : input.slice(0, -this.#pendingInput.length);
    const keypressInput = completeInput.replace(cursorPositionReport, (response) => {
      this.#onCursorPositionReport(response);
      return "";
    });
    // A lone Esc is the Esc key. Given to readline it would wait half a second for more bytes and read a key typed
    // in that time as Alt+key (Esc then `k` became Alt+K and the k was lost); Alt+key arrives in one piece anyway.
    // It waits a few milliseconds in case it is the start of a key cut in two (an arrow over ssh), which would
    // otherwise close the list and leave "[A" typed on the line.
    if (keypressInput === "\u001b") {
      this.#pendingEscape = setTimeout(() => this.#flushEscape(), escapeWait);
      return;
    }
    let from = 0;
    for (let at = keypressInput.indexOf("\u001b["); at !== -1; at = keypressInput.indexOf("\u001b[", at + 1)) {
      const csi = csiAt(keypressInput, at);
      if (csi == null) continue;
      const key = extendedKey(csi.params, csi.final, keypressInput.slice(at, csi.end));
      if (key == null) continue;
      if (at > from) this.#keypressInput.write(keypressInput.slice(from, at));
      this.#emit(key);
      from = csi.end;
      at = csi.end - 1;
    }
    if (from < keypressInput.length) this.#keypressInput.write(keypressInput.slice(from));
  }
}
