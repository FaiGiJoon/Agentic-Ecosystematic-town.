import { posix } from 'node:path';
import { describe } from '../public/town/hq-view.js';

export { describe };

const LABELS = {
  Read: 'READ',
  Glob: 'READ',
  Grep: 'SEARCH',
  WebSearch: 'WEB',
  WebFetch: 'WEB',
  Write: 'WRITE',
  Edit: 'WRITE',
};

const MAX_DETAIL = 40;

function detailOf(input) {
  if (!input || typeof input !== 'object') return '';
  let d = '';
  if (typeof input.file_path === 'string' && input.file_path) d = posix.basename(input.file_path);
  else d = [input.pattern, input.query, input.url].find((v) => typeof v === 'string' && v) || '';
  return d.slice(0, MAX_DETAIL);
}

export function stepsFrom(message) {
  if (!message || message.type !== 'assistant') return [];
  const content = message.message && message.message.content;
  if (!Array.isArray(content)) return [];
  const steps = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === 'tool_use') {
      steps.push({ label: LABELS[block.name] || 'THINK', detail: detailOf(block.input) });
    } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      steps.push({ label: 'THINK', detail: block.text.trim().slice(0, MAX_DETAIL) });
    }
  }
  return steps;
}
