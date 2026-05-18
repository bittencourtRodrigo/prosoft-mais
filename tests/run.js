#!/usr/bin/env node
// Runner Node — mesma API do tests/index.html (describe/test/assert/loadTool/loadFixture)
// mas sem servidor HTTP. Útil pra rodar testes de regressão direto no terminal,
// inclusive a partir de hooks do Claude Code.
//
//   node tests/run.js
//
// Sai com 0 se todos os testes passarem, 1 caso contrário. Saída compacta:
// só lista falhas, com summary `N/M pass` no final.

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const FIXT_DIR  = path.join(__dirname, 'fixtures');
const SUITE_DIR = path.join(__dirname, 'suites');

const suites = [];
let currentSuite = null;

function describe(name, fn) {
  currentSuite = { name: name, tests: [], passed: 0, _queued: [] };
  suites.push(currentSuite);
  try { fn(); }
  catch (e) {
    currentSuite._queued.push({ name: '(erro fora de teste)', fn: () => { throw e; } });
  }
  currentSuite = null;
}

function test(name, fn) {
  currentSuite._queued.push({ name: name, fn: fn });
}

async function runQueued() {
  for (const s of suites) {
    for (const q of s._queued) {
      const r = { name: q.name, passed: false, error: '' };
      try {
        const p = q.fn();
        if (p && typeof p.then === 'function') await p;
        r.passed = true;
        s.passed++;
      } catch (e) {
        r.error = errStr(e);
      }
      s.tests.push(r);
    }
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}
function assertEqual(a, e, msg) {
  if (a !== e) throw new Error((msg ? msg + ' — ' : '') + 'esperado ' + JSON.stringify(e) + ', recebeu ' + JSON.stringify(a));
}
function assertClose(a, e, eps, msg) {
  eps = (eps == null) ? 0.005 : eps;
  if (Math.abs(a - e) > eps) throw new Error((msg ? msg + ' — ' : '') + 'esperado ~' + e + ' (±' + eps + '), recebeu ' + a);
}

async function loadFixture(name) {
  return fs.readFileSync(path.join(FIXT_DIR, name), 'utf8');
}

async function loadTool(file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const scripts = [];
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const openTag = html.slice(m.index, html.indexOf('>', m.index) + 1);
    if (/\bsrc\s*=/.test(openTag)) continue;
    scripts.push(m[1]);
  }
  if (!scripts.length) throw new Error(file + ': nenhum <script> inline');
  const body = scripts[scripts.length - 1];

  const ns = {};
  const sandbox = {
    pdfjsLib: { GlobalWorkerOptions: {} },
    window:   { addEventListener: () => {}, jspdf: { jsPDF: function() {} } },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    URL:      { createObjectURL: () => '', revokeObjectURL: () => {} },
    Blob:     function() {},
    __ns:     ns
  };
  const exposeNames = [
    'parseBalancete', 'parseContasPagar', 'parseContaCorrente',
    'normalizeName', 'parseBRL', 'formatBRL', 'formatSigned', 'round2'
  ];
  const expose = '\n;' + exposeNames.map(n =>
    `try { __ns[${JSON.stringify(n)}] = ${n}; } catch(e) {}`
  ).join('\n');

  const keys = Object.keys(sandbox);
  const args = keys.map(k => sandbox[k]);
  const fn   = new Function(keys.join(','), body + expose);
  fn.apply(null, args);
  return ns;
}

function errStr(e) {
  if (!e) return '';
  return e.stack || String(e.message || e);
}

// Globais pros arquivos de suite ficarem idênticos no browser e no node
global.describe    = describe;
global.test        = test;
global.assert      = assert;
global.assertEqual = assertEqual;
global.assertClose = assertClose;
global.loadTool    = loadTool;
global.loadFixture = loadFixture;

// Carrega todas as suites
const files = fs.readdirSync(SUITE_DIR).filter(f => f.endsWith('.test.js')).sort();
for (const f of files) {
  require(path.join(SUITE_DIR, f));
}

(async () => {
  await runQueued();

  let total = 0, passed = 0, failed = 0;
  for (const s of suites) {
    total  += s.tests.length;
    passed += s.tests.filter(t => t.passed).length;
    failed += s.tests.filter(t => !t.passed).length;
  }

  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const RED = useColor ? '\x1b[31m' : '';
  const GRN = useColor ? '\x1b[32m' : '';
  const DIM = useColor ? '\x1b[2m'  : '';
  const RST = useColor ? '\x1b[0m'  : '';

  // Modo hook: usado pelo Stop hook em .claude/settings.json.
  // Em sucesso: silencioso, exit 0.
  // Em falha: imprime JSON {decision:"block", reason:...}, exit 0 (CC vê o decision e bloqueia).
  if (process.env.CLAUDE_HOOK === '1') {
    if (failed === 0) { process.exit(0); }

    let reason = '';
    for (const s of suites) {
      const sFails = s.tests.filter(t => !t.passed);
      if (sFails.length === 0) continue;
      reason += s.name + '\n';
      for (const t of sFails) {
        reason += '  ✗ ' + t.name + '\n';
        if (t.error) {
          const firstLine = String(t.error).split('\n')[0];
          reason += '      ' + firstLine + '\n';
        }
      }
    }
    reason += `\n${failed}/${total} teste(s) falhando. Conserte antes de finalizar.`;
    process.stdout.write(JSON.stringify({ decision: 'block', reason: reason }));
    process.exit(0);
  }

  // Modo manual
  if (failed > 0) {
    for (const s of suites) {
      const sFails = s.tests.filter(t => !t.passed);
      if (sFails.length === 0) continue;
      console.log(s.name);
      for (const t of sFails) {
        console.log('  ' + RED + '✗' + RST + ' ' + t.name);
        if (t.error) {
          const indented = String(t.error).split('\n').map(l => '    ' + l).join('\n');
          console.log(DIM + indented + RST);
        }
      }
      console.log('');
    }
  }

  const summary = `${passed}/${total} pass` + (failed ? `, ${failed} fail` : '');
  console.log(failed === 0 ? GRN + '✓ ' + summary + RST : RED + '✗ ' + summary + RST);
  process.exit(failed === 0 ? 0 : 1);
})();
