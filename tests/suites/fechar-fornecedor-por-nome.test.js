// Testes do tool "fechar fornecedor por nome.html"
//
// Carrega o código real do tool e roda contra fixtures de texto extraídos
// pelo pdf.js (snapshots determinísticos dos PDFs do Prosoft).
//
// Para adicionar um novo fixture:
//   1. Carrega o PDF no tool no browser
//   2. Clica "↓ texto extraído" no card e baixa o .txt
//   3. Salva em tests/fixtures/
//   4. Adiciona o assert correspondente aqui

describe('fechar fornecedor por nome — parseBalancete', function () {
  var tool, balText, parsed;

  test('carrega tool + fixture do balancete', async function () {
    tool    = await loadTool('fechar fornecedor por nome.html');
    balText = await loadFixture('balancete-andrade-lessa.txt');
    assert(typeof tool.parseBalancete === 'function', 'parseBalancete não exposto');
    parsed  = tool.parseBalancete(balText);
  });

  test('extrai metadados da empresa', function () {
    assertEqual(parsed.codigo, '0199');
    assertEqual(parsed.cnpj,   '04.998.754/0001-33');
    assert(parsed.empresa.indexOf('ANDRADE LESSA') === 0, 'empresa: ' + parsed.empresa);
    assert(parsed.periodo.toLowerCase().indexOf('março') >= 0, 'periodo: ' + parsed.periodo);
  });

  test('extrai 19 fornecedores (18 com saldo + 1 com 0,00)', function () {
    assertEqual(parsed.fornecedores.length, 19);
  });

  test('OCEANO CONFECÇÃO SUR tem saldo 3065.56', function () {
    var f = parsed.fornecedores.find(function (x) { return x.codigo === '170608'; });
    assert(f, 'OCEANO não encontrado');
    assertEqual(f.nome, 'OCEANO CONFECÇÃO SUR');
    assertClose(f.saldo, 3065.56);
  });

  test('DELIZ INDUSTRIA (truncado curto, 15 chars) tem saldo 139285.08', function () {
    var f = parsed.fornecedores.find(function (x) { return x.codigo === '048703'; });
    assert(f, 'DELIZ não encontrado');
    assertEqual(f.nome, 'DELIZ INDUSTRIA');
    assertClose(f.saldo, 139285.08);
  });

  test('AMANDA COSTA DA SILV (saldo 0,00, sem marcador C/D) é capturada', function () {
    var f = parsed.fornecedores.find(function (x) { return x.codigo === '216188'; });
    assert(f, 'AMANDA não encontrada (regex deve permitir [CD] opcional para saldo zero)');
    assertClose(f.saldo, 0);
  });

  test('não pega contas fora do grupo 2101010100', function () {
    var foras = parsed.fornecedores.filter(function (f) {
      return /Altamira|Maria Eunice|Zig Confec|FGTS|INSS|Simples|Capital/i.test(f.nome);
    });
    assertEqual(foras.length, 0, 'vazaram contas de outros grupos: ' + foras.map(function (f) { return f.nome; }).join(', '));
  });
});

describe('fechar fornecedor por nome — parseContasPagar', function () {
  var tool, cprText, parsed;

  test('carrega tool + fixture do contas a pagar', async function () {
    tool    = await loadTool('fechar fornecedor por nome.html');
    cprText = await loadFixture('contas-pagar-andrade-lessa.txt');
    assert(typeof tool.parseContasPagar === 'function', 'parseContasPagar não exposto');
    parsed  = tool.parseContasPagar(cprText);
  });

  test('extrai metadados da empresa', function () {
    assertEqual(parsed.codigo, '0199');
    assertEqual(parsed.cnpj,   '04.998.754/0001-33');
    assert(parsed.empresa.indexOf('ANDRADE LESSA') === 0, 'empresa: ' + parsed.empresa);
  });

  test('extrai 18 fornecedores (ordem dos itens no pdf.js é fora de leitura)', function () {
    // REGRESSION GUARD: antes do fix retornava 0 porque rótulos vinham
    // após o valor e o nome vinha 3 linhas depois da label.
    assertEqual(parsed.fornecedores.length, 18);
  });

  test('SALLO CONF.E COM.DE ROUPAS LTDA tem total 10542.26', function () {
    var f = parsed.fornecedores.find(function (x) { return x.nome.indexOf('SALLO') === 0; });
    assert(f, 'SALLO não encontrado');
    assertEqual(f.cnpj, '01.968.595/0002-17');
    assertClose(f.total, 10542.26);
  });

  test('OCEANO CONFECÇÃO SURFWEAR LTDA tem total 3065.56', function () {
    var f = parsed.fornecedores.find(function (x) { return x.nome.indexOf('OCEANO') === 0; });
    assert(f, 'OCEANO não encontrado');
    assertEqual(f.cnpj, '02.241.105/0002-49');
    assertClose(f.total, 3065.56);
  });

  test('todos os fornecedores têm nome, cnpj e total > 0', function () {
    parsed.fornecedores.forEach(function (f) {
      assert(f.nome && f.nome.length > 3,  'nome inválido: ' + JSON.stringify(f));
      assert(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(f.cnpj) || /\d{3}\.\d{3}\.\d{3}-\d{2}/.test(f.cnpj),
        'cnpj inválido: ' + JSON.stringify(f));
      assert(f.total > 0, 'total <= 0: ' + JSON.stringify(f));
    });
  });

  test('nome do fornecedor não vaza rótulos ("Entrada", "Nome do Fornecedor:", header de coluna, CNPJ da empresa)', function () {
    var ruins = parsed.fornecedores.filter(function (f) {
      var n = f.nome;
      return n === 'Entrada'
        || /^Nome do Fornecedor/.test(n)
        || /Valor da Fatura/.test(n)
        || /^04\.998\.754/.test(n)
        || /^0199\s*-/.test(n)
        || /LIVROS FISCAIS|CONTAS A PAGAR/.test(n);
    });
    assertEqual(ruins.length, 0, 'nomes contaminados: ' + ruins.map(function (f) { return f.nome; }).join(' | '));
  });
});

describe('fechar fornecedor por nome — normalizeName', function () {
  var tool;
  test('carrega tool', async function () { tool = await loadTool('fechar fornecedor por nome.html'); });

  test('uppercase + strip acentos', function () {
    assertEqual(tool.normalizeName('Confecção'),  'CONFECCAO');
    assertEqual(tool.normalizeName('São Paulo'),  'SAO PAULO');
    assertEqual(tool.normalizeName('Indústria'),  'INDUSTRIA');
  });

  test('pontuação vira espaço, espaços colapsam', function () {
    assertEqual(tool.normalizeName('SALLO CONF.E COM.DE'), 'SALLO CONF E COM DE');
    assertEqual(tool.normalizeName('GARRA JEANS IND. COM.'), 'GARRA JEANS IND COM');
    assertEqual(tool.normalizeName('A   B    C'),         'A B C');
  });

  test('vazio/null retorna string vazia', function () {
    assertEqual(tool.normalizeName(''),        '');
    assertEqual(tool.normalizeName(null),      '');
    assertEqual(tool.normalizeName(undefined), '');
  });
});

describe('fechar fornecedor por nome — matching fim-a-fim', function () {
  var tool, bal, cpr;

  test('carrega tudo', async function () {
    tool = await loadTool('fechar fornecedor por nome.html');
    bal  = tool.parseBalancete(await loadFixture('balancete-andrade-lessa.txt'));
    cpr  = tool.parseContasPagar(await loadFixture('contas-pagar-andrade-lessa.txt'));
  });

  test('matching prefix: cada fornecedor com saldo no balancete tem exatamente 1 match no contas a pagar', function () {
    var problemas = [];
    bal.fornecedores.forEach(function (b) {
      if (!b.normName || Math.abs(b.saldo) < 0.005) return; // ignora AMANDA (saldo 0)
      var hits = cpr.fornecedores.filter(function (c) {
        return c.normName === b.normName || c.normName.indexOf(b.normName) === 0;
      });
      if (hits.length !== 1) {
        problemas.push(b.nome + ' → ' + hits.length + ' matches');
      }
    });
    assertEqual(problemas.length, 0, 'falhas: ' + problemas.join(' | '));
  });

  test('saldo bate em todos os 18 fornecedores (igualdade estrita)', function () {
    var problemas = [];
    bal.fornecedores.forEach(function (b) {
      if (!b.normName || Math.abs(b.saldo) < 0.005) return;
      var c = cpr.fornecedores.find(function (x) {
        return x.normName === b.normName || x.normName.indexOf(b.normName) === 0;
      });
      if (!c) { problemas.push(b.nome + ': sem par no contas a pagar'); return; }
      var diff = Math.round(b.saldo * 100) - Math.round(c.total * 100);
      if (diff !== 0) {
        problemas.push(b.nome + ': bal=' + b.saldo.toFixed(2) + ' cpr=' + c.total.toFixed(2));
      }
    });
    assertEqual(problemas.length, 0, problemas.join(' | '));
  });

  test('todo fornecedor do contas a pagar é casado por algum do balancete', function () {
    var orfaos = cpr.fornecedores.filter(function (c) {
      return !bal.fornecedores.some(function (b) {
        return b.normName && (c.normName === b.normName || c.normName.indexOf(b.normName) === 0);
      });
    });
    assertEqual(orfaos.length, 0, 'sem par no balancete: ' + orfaos.map(function (f) { return f.nome; }).join(' | '));
  });
});
