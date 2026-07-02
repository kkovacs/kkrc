#!/usr/bin/env bun
import * as readline from 'node:readline';

function displayKey(str, key) {
  if (!key) return str;
  const parts = [];
  if (key.ctrl) parts.push('CTRL');
  if (key.meta) parts.push('ALT');
  if (key.shift) parts.push('SHIFT');

  let name = key.name || str;
  if (name === 'return') name = 'enter';
  parts.push(name);
  return parts.join('+');
}

readline.emitKeypressEvents(process.stdin);

if (!process.stdin.isTTY) {
  console.error('This script needs an interactive terminal (TTY).');
  process.exit(1);
}

process.stdin.setRawMode(true);
process.stdin.resume();

// Try to enable enhanced key reporting (Kitty keyboard protocol) so
// terminals that support it send combos like SHIFT+ENTER as CSI u sequences.
process.stdout.write('\x1b[>31u');

function restore() {
  process.stdout.write('\x1b[<u');
}
process.on('exit', restore);

console.log('Listening for key events. Press CTRL+C to quit.\n');

process.stdin.on('keypress', (str, key) => {
  console.log(displayKey(str, key));
  if (key && key.ctrl && key.name === 'c') {
    restore();
    process.exit();
  }
});
