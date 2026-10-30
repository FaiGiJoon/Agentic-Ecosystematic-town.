import fs from 'node:fs/promises';
import path from 'node:path';

export function slug(title) {
  const s = String(title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return s || 'ticket';
}

function localDate(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function noteText(ticket, date = new Date()) {
  const day = localDate(date);
  return [
    '---',
    'type: note',
    'status: active',
    'tags: [agent-hq]',
    `created: ${day}`,
    `updated: ${day}`,
    `source: "agent-hq #${ticket.id}"`,
    '---',
    '',
    `# ${String(ticket.title).replace(/\s+/g, ' ').trim()}`,
    '',
    '## Request',
    '',
    ticket.body?.trim() ? ticket.body : '(no details)',
    '',
    '## Result',
    '',
    ticket.output ?? '',
    '',
  ].join('\n');
}

export async function writeNote(vaultDir, ticket, date = new Date()) {
  const inbox = path.join(vaultDir, '00-inbox');
  const stat = await fs.stat(inbox).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Vault inbox not found: ${inbox}`);
  const base = `agent-hq-${ticket.id}-${slug(ticket.title)}`;
  const text = noteText(ticket, date);
  for (let n = 1; ; n++) {
    const file = path.join(inbox, n === 1 ? `${base}.md` : `${base}-${n}.md`);
    try {
      await fs.writeFile(file, text, { flag: 'wx' });
      return file;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}
