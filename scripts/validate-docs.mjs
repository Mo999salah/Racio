import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const required = [
  'SPEC.md',
  'ARCHITECTURE.md',
  'DESIGN.md',
  'SECURITY.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'docs/money-and-currencies.md',
  'docs/import-pipeline.md',
  'docs/ai-boundaries.md',
  'docs/data-model.md',
  'docs/testing-strategy.md',
];

const missing = required.filter((file) => !existsSync(resolve(root, file)));
if (missing.length > 0) {
  console.error(`Missing required documentation: ${missing.join(', ')}`);
  process.exit(1);
}

const architecture = readFileSync(resolve(root, 'ARCHITECTURE.md'), 'utf8');
const design = readFileSync(resolve(root, 'DESIGN.md'), 'utf8');
const security = readFileSync(resolve(root, 'SECURITY.md'), 'utf8');

const requiredTerms = [
  ['ARCHITECTURE.md', architecture, 'PostgreSQL'],
  ['ARCHITECTURE.md', architecture, 'pg-boss'],
  ['ARCHITECTURE.md', architecture, 'PyMuPDF'],
  ['DESIGN.md', design, 'Explicitly banned patterns'],
  ['DESIGN.md', design, 'RTL'],
  ['SECURITY.md', security, 'AI-generated SQL'],
  ['SECURITY.md', security, 'prompt injection'],
];

const missingTerms = requiredTerms
  .filter(([, content, term]) => !content.toLowerCase().includes(term.toLowerCase()))
  .map(([file, , term]) => `${file}: ${term}`);

if (missingTerms.length > 0) {
  console.error(`Documentation terms missing: ${missingTerms.join(', ')}`);
  process.exit(1);
}

console.log(`Validated ${required.length} required documentation files.`);
