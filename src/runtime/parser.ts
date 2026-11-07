// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { wcswidth } from "../utils/unicode.js";
import { Shell } from "../utils/shell.js";
import { getShellWhitespaceEscapeChar } from "./utils.js";

export type CommandToken = {
  token: string;
  tokenLength: number;
  complete: boolean;
  isOption: boolean;
  isPersistent?: boolean;
  isPath?: boolean;
  isPathComplete?: boolean;
  isQuoted?: boolean; // used for any token starting with quotes
  isQuoteContinued?: boolean; // used for strings that are fully wrapped in quotes with content after the quotes
};

const spaceRegex = /\s/;

// the part after the last |, ||, && or ; that is not inside quotes: `git commit -m "a && b" --am` stays one command
const lastCommandOf = (command: string, shell: Shell): string => {
  const escapeChar = getShellWhitespaceEscapeChar(shell);
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === escapeChar && quote !== "'") {
      i++;
      continue;
    }
    if (quote != null) {
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === ";" || c === "|" || (c === "&" && command[i + 1] === "&")) {
      if (command[i + 1] === c) i++;
      start = i + 1;
    }
  }
  return command.slice(start);
};

export const parseCommand = (command: string, shell: Shell): CommandToken[] => {
  const lastCommand = lastCommandOf(command, shell).trimStart();
  const tokens = lastCommand ? lex(lastCommand, shell) : [];
  return sanitizeTokens(tokens, shell);
};

export const getCommandCacheKey = (command: string, shell: Shell): string => JSON.stringify(parseCommand(command, shell));

const sanitizeTokens = (cmdTokens: CommandToken[], shell: Shell): CommandToken[] => unwrapQuotedTokens(unescapeSpaceTokens(cmdTokens, shell), shell);

// remove escapes around spaces
const unescapeSpaceTokens = (cmdTokens: CommandToken[], shell: Shell): CommandToken[] => {
  const escapeChar = getShellWhitespaceEscapeChar(shell);
  return cmdTokens.map((cmdToken) => {
    const { token, isQuoted } = cmdToken;
    // in POSIX shells any special character can be escaped: `my\ app\ \(v2\)` is the folder `my app (v2)`
    if (!isQuoted && escapeChar === "\\" && /\\[ '"()&;|<>$`\\!*?[\]{}#~=,]/.test(token)) {
      return { ...cmdToken, token: token.replace(/\\([ '"()&;|<>$`\\!*?[\]{}#~=,])/g, "$1") };
    }
    if (!isQuoted && token.includes(`${escapeChar} `)) {
      return { ...cmdToken, token: token.replaceAll(`${escapeChar} `, " ") };
    }
    return cmdToken;
  });
};

// need to unwrap tokens that are quoted with content after the quotes like `"hello"world`
const unwrapQuotedTokens = (cmdTokens: CommandToken[], shell: Shell): CommandToken[] => {
  const escapeChar = getShellWhitespaceEscapeChar(shell);
  return cmdTokens.map((cmdToken) => {
    const { token, isQuoteContinued } = cmdToken;
    if (isQuoteContinued) {
      const quoteChar = token[0];
      const unquotedToken = token.replaceAll(`${escapeChar}${quoteChar}`, "\u001B").replaceAll(quoteChar, "").replaceAll("\u001B", quoteChar);
      return { ...cmdToken, token: unquotedToken };
    }
    return cmdToken;
  });
};

const lex = (command: string, shell: Shell): CommandToken[] => {
  const tokens: CommandToken[] = [];
  const escapeChar = getShellWhitespaceEscapeChar(shell);
  let [readingQuotedString, readingQuoteContinuedString, readingFlag, readingCmd] = [false, false, false, false];
  let readingIdx = 0;
  let readingQuoteChar = "";

  let offset = 0;
  for (const char of command) {
    const idx = offset;
    offset += char.length;
    const reading = readingQuotedString || readingQuoteContinuedString || readingFlag || readingCmd;
    if (!reading && (char === `'` || char === `"` || char == "`")) {
      [readingQuotedString, readingIdx, readingQuoteChar] = [true, idx, char];
      continue;
    } else if (!reading && char === `-`) {
      [readingFlag, readingIdx] = [true, idx];
      continue;
    } else if (!reading && !spaceRegex.test(char)) {
      [readingCmd, readingIdx] = [true, idx];
      continue;
    }

    if (readingQuotedString && char === readingQuoteChar && command.at(idx - 1) !== escapeChar && !spaceRegex.test(command.at(offset) ?? " ")) {
      readingQuotedString = false;
      readingQuoteContinuedString = true;
    } else if (readingQuotedString && char === readingQuoteChar && command.at(idx - 1) !== escapeChar) {
      readingQuotedString = false;
      const complete = offset < command.length && spaceRegex.test(command[offset]);
      tokens.push({
        token: command.slice(readingIdx + 1, idx),
        tokenLength: wcswidth(command.slice(readingIdx + 1, idx)) + 2, // +2 for both quotes
        complete,
        isOption: false,
        isQuoted: true,
      });
    } else if (readingQuoteContinuedString && spaceRegex.test(char) && command.at(idx - 1) !== escapeChar) {
      readingQuoteContinuedString = false;
      tokens.push({
        token: command.slice(readingIdx, idx),
        tokenLength: wcswidth(command.slice(readingIdx, idx)),
        complete: true,
        isOption: false,
        isQuoted: true,
        isQuoteContinued: true,
      });
    } else if (readingFlag && (spaceRegex.test(char) || char === "=")) {
      readingFlag = false;
      tokens.push({
        token: command.slice(readingIdx, idx),
        tokenLength: wcswidth(command.slice(readingIdx, idx)),
        complete: true,
        isOption: true,
      });
    } else if (readingCmd && spaceRegex.test(char) && command.at(idx - 1) !== escapeChar) {
      readingCmd = false;
      tokens.push({
        token: command.slice(readingIdx, idx),
        tokenLength: wcswidth(command.slice(readingIdx, idx)),
        complete: true,
        isOption: false,
      });
    }
  }

  const reading = readingQuotedString || readingQuoteContinuedString || readingFlag || readingCmd;
  if (reading) {
    if (readingQuotedString) {
      tokens.push({
        token: command.slice(readingIdx + 1),
        tokenLength: wcswidth(command.slice(readingIdx + 1)) + 1, // +1 for the leading quote
        complete: false,
        isOption: false,
        isQuoted: true,
      });
    } else if (readingQuoteContinuedString) {
      tokens.push({
        token: command.slice(readingIdx),
        tokenLength: wcswidth(command.slice(readingIdx)),
        complete: false,
        isOption: false,
        isQuoted: true,
        isQuoteContinued: true,
      });
    } else {
      tokens.push({
        token: command.slice(readingIdx),
        tokenLength: wcswidth(command.slice(readingIdx)),
        complete: false,
        isOption: readingFlag,
      });
    }
  }

  return tokens;
};
