// Test runner mínimo, sem dependências.
//
// API:
//   describe('grupo', () => { test('caso', () => assert(...)) })
//   assert(cond, msg)
//   assertEqual(actual, expected, msg)
//   assertClose(actual, expected, eps, msg)
//   loadTool(path)       → faz fetch + extrai inline <script> + eval em sandbox, devolve as funções/objetos expostos
//   loadFixture(path)    → fetch de um arquivo .txt do tests/fixtures/

(function (root) {
  var suites = [];
  var currentSuite = null;

  function describe(name, fn) {
    currentSuite = { name: name, tests: [], passed: 0, _queued: [] };
    suites.push(currentSuite);
    try { fn(); }
    catch (e) {
      currentSuite._queued.push({ name: '(erro fora de teste)', fn: function () { throw e; } });
    }
    currentSuite = null;
  }

  function test(name, fn) {
    var s = currentSuite || (function () {
      var fb = { name: '(sem suite)', tests: [], passed: 0, _queued: [] };
      suites.push(fb);
      return fb;
    })();
    s._queued.push({ name: name, fn: fn });
  }

  async function runQueued() {
    for (var i = 0; i < suites.length; i++) {
      var s = suites[i];
      for (var j = 0; j < s._queued.length; j++) {
        var q = s._queued[j];
        var r = { name: q.name, passed: false, error: '' };
        try {
          var p = q.fn();
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
  function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error((msg ? msg + ' — ' : '') + 'esperado ' + JSON.stringify(expected) + ', recebeu ' + JSON.stringify(actual));
    }
  }
  function assertClose(actual, expected, eps, msg) {
    eps = (eps == null) ? 0.005 : eps;
    if (Math.abs(actual - expected) > eps) {
      throw new Error((msg ? msg + ' — ' : '') + 'esperado ~' + expected + ' (±' + eps + '), recebeu ' + actual);
    }
  }

  function errStr(e) {
    if (!e) return '';
    if (e.stack) return e.stack;
    return String(e.message || e);
  }

  async function loadFixture(path) {
    var res = await fetch('fixtures/' + path);
    if (!res.ok) throw new Error('fixture ' + path + ': HTTP ' + res.status);
    return await res.text();
  }

  // Carrega um tool HTML, isola seu <script> inline e devolve as funções/variáveis expostas via globalThis.
  // O contexto recebe stubs de pdfjsLib/window/document/URL/Blob pra que o IIFE de setup não quebre.
  async function loadTool(toolFile) {
    var res = await fetch('../' + toolFile);
    if (!res.ok) throw new Error(toolFile + ': HTTP ' + res.status);
    var html = await res.text();

    var scripts = [];
    var re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      // Pula scripts com src (CDN)
      var openTag = html.slice(m.index, html.indexOf('>', m.index) + 1);
      if (/\bsrc\s*=/.test(openTag)) continue;
      scripts.push(m[1]);
    }
    if (!scripts.length) throw new Error(toolFile + ': nenhum <script> inline encontrado');

    // O último <script> inline é tipicamente o que contém as funções do tool
    var body = scripts[scripts.length - 1];

    var ns = {};
    var sandbox = {
      pdfjsLib: { GlobalWorkerOptions: {} },
      window:   { addEventListener: function() {}, jspdf: { jsPDF: function() {} } },
      document: { getElementById: function() { return null; }, querySelectorAll: function() { return []; } },
      URL:      { createObjectURL: function() { return ''; }, revokeObjectURL: function() {} },
      Blob:     function() {},
      __ns:     ns
    };

    var exposeNames = [
      'parseBalancete', 'parseContasPagar', 'parseContaCorrente',
      'normalizeName', 'parseBRL', 'formatBRL', 'formatSigned', 'round2'
    ];
    var expose = '\n;' + exposeNames.map(function (n) {
      return 'try { __ns[' + JSON.stringify(n) + '] = ' + n + '; } catch(e) {}';
    }).join('\n');

    // Função encapsulada que recebe os stubs como parâmetros nomeados
    var keys = Object.keys(sandbox);
    var args = keys.map(function (k) { return sandbox[k]; });
    var fn   = new Function(keys.join(','), body + expose);
    fn.apply(null, args);

    return ns;
  }

  async function run() {
    await runQueued();
    var total = 0, passed = 0, failed = 0;
    for (var k = 0; k < suites.length; k++) {
      total += suites[k].tests.length;
      passed += suites[k].tests.filter(function (t) { return t.passed; }).length;
      failed += suites[k].tests.filter(function (t) { return !t.passed; }).length;
    }
    return { suites: suites, total: total, passed: passed, failed: failed };
  }

  root.TestRunner = {
    describe: describe,
    test: test,
    assert: assert,
    assertEqual: assertEqual,
    assertClose: assertClose,
    loadTool: loadTool,
    loadFixture: loadFixture,
    run: run
  };
  // Atalhos globais pra arquivos de suite ficarem limpos
  root.describe    = describe;
  root.test        = test;
  root.assert      = assert;
  root.assertEqual = assertEqual;
  root.assertClose = assertClose;
  root.loadTool    = loadTool;
  root.loadFixture = loadFixture;
})(window);
