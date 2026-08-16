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
  'docs/xlsx-import.md',
  'docs/pdf-import.md',
  'docs/ai-boundaries.md',
  'docs/ai-advisor.md',
  'docs/data-model.md',
  'docs/testing-strategy.md',
  'docs/export.md',
  'docs/operations.md',
  'docs/deployment.md',
  'docs/disaster-recovery.md',
  'docs/release-checklist.md',
  'docs/security-audit.md',
  'CHANGELOG.md',
  'THIRD_PARTY_NOTICES.md',
  '.env.production.example',
  'scripts/backup/backup.sh',
  'scripts/backup/restore.sh',
];

const missing = required.filter((file) => !existsSync(resolve(root, file)));
if (missing.length > 0) {
  console.error(`Missing required documentation: ${missing.join(', ')}`);
  process.exit(1);
}

const architecture = readFileSync(resolve(root, 'ARCHITECTURE.md'), 'utf8');
const design = readFileSync(resolve(root, 'DESIGN.md'), 'utf8');
const security = readFileSync(resolve(root, 'SECURITY.md'), 'utf8');
const xlsx = readFileSync(resolve(root, 'docs/xlsx-import.md'), 'utf8');
const pdf = readFileSync(resolve(root, 'docs/pdf-import.md'), 'utf8');
const advisor = readFileSync(resolve(root, 'docs/ai-advisor.md'), 'utf8');
const exportDoc = readFileSync(resolve(root, 'docs/export.md'), 'utf8');
const operations = readFileSync(resolve(root, 'docs/operations.md'), 'utf8');
const deployment = readFileSync(resolve(root, 'docs/deployment.md'), 'utf8');
const recovery = readFileSync(resolve(root, 'docs/disaster-recovery.md'), 'utf8');
const checklist = readFileSync(resolve(root, 'docs/release-checklist.md'), 'utf8');
const audit = readFileSync(resolve(root, 'docs/security-audit.md'), 'utf8');

const requiredTerms = [
  ['ARCHITECTURE.md', architecture, 'PostgreSQL'],
  ['ARCHITECTURE.md', architecture, 'pg-boss'],
  ['ARCHITECTURE.md', architecture, 'PyMuPDF'],
  ['DESIGN.md', design, 'Explicitly banned patterns'],
  ['DESIGN.md', design, 'RTL'],
  ['SECURITY.md', security, 'AI-generated SQL'],
  ['SECURITY.md', security, 'prompt injection'],
  ['SECURITY.md', security, 'XLSX'],
  ['docs/xlsx-import.md', xlsx, 'compression ratio'],
  ['docs/xlsx-import.md', xlsx, 'formulas'],
  ['docs/pdf-import.md', pdf, 'pdfplumber'],
  ['docs/pdf-import.md', pdf, 'no usable text'],
  ['docs/ai-advisor.md', advisor, 'no SQL'],
  ['docs/ai-advisor.md', advisor, 'prompt injection'],
  ['docs/export.md', exportDoc, 'formula-injection'],
  ['docs/export.md', exportDoc, 'amount_exact'],
  ['docs/export.md', exportDoc, 'repeatable-read'],
  ['docs/operations.md', operations, 'pg-boss'],
  ['docs/operations.md', operations, 'backup'],
  ['docs/deployment.md', deployment, 'one web instance'],
  ['docs/deployment.md', deployment, 'migrations'],
  ['docs/disaster-recovery.md', recovery, 'restore'],
  ['docs/release-checklist.md', checklist, 'Playwright'],
  ['docs/security-audit.md', audit, 'threat'],
];

const missingTerms = requiredTerms
  .filter(([, content, term]) => !content.toLowerCase().includes(term.toLowerCase()))
  .map(([file, , term]) => `${file}: ${term}`);

if (missingTerms.length > 0) {
  console.error(`Documentation terms missing: ${missingTerms.join(', ')}`);
  process.exit(1);
}

console.log(`Validated ${required.length} required documentation files.`);
