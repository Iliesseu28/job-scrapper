#!/usr/bin/env node
// PreToolUse hook — keeps API keys out of the conversation.
// Blocks (exit 2) any attempt to read or print .env, and any write that would put
// a key-looking value into a tracked file. .env.example stays readable.
import fs from 'node:fs';

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
const tool = input.tool_name || '';
const t = input.tool_input || {};
const block = (why) => { process.stderr.write(why + '\n'); process.exit(2); };

const isEnvFile = (p) => /(^|[\\/])\.env(\.(?!example$)[^\\/]*)?$/.test(String(p || '')) && !/\.env\.example$/.test(String(p || ''));

if (['Read', 'Edit', 'Write', 'MultiEdit'].includes(tool) && isEnvFile(t.file_path)) {
  block('Blocked: .env holds your API keys and stays out of the conversation. Ask the user to edit it, or read .env.example for the variable names.');
}

if (tool === 'Bash') {
  const cmd = String(t.command || '');
  if (/(cat|type|more|less|head|tail|bat|nl|grep|rg|sed|awk|Get-Content|gc)\b[^|;&]*(^|[\s'"\\/])\.env(?!\.example)\b/i.test(cmd)) {
    block('Blocked: this command would print .env (API keys). Use `npm run check` to see which keys are set, without their values.');
  }
  if (/^\s*(env|printenv|set|Get-ChildItem\s+env:)\s*$/i.test(cmd)) block('Blocked: printing every environment variable would expose API keys.');
}

// Writes: no key-looking value in files that git tracks.
if (['Write', 'Edit', 'MultiEdit'].includes(tool)) {
  const text = [t.content, t.new_string, ...(Array.isArray(t.edits) ? t.edits.map((e) => e.new_string) : [])].filter(Boolean).join('\n');
  const patterns = [
    [/AIza[0-9A-Za-z_-]{35}/, 'a Google API key'],
    [/sk-ant-[0-9A-Za-z_-]{20,}/, 'an Anthropic key'],
    [/\bsk-(proj-)?[0-9A-Za-z_-]{32,}/, 'an OpenAI-style key'],
    [/\bgsk_[0-9A-Za-z]{30,}/, 'a Groq key'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  ];
  for (const [re, what] of patterns) if (re.test(text)) block(`Blocked: this edit contains what looks like ${what}. Keys belong in .env only (git-ignored).`);
}
process.exit(0);
