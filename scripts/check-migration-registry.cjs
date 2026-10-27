#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function parseSource(fileName, sourceText) {
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function getMigrationClasses(fileName) {
  const source = parseSource(fileName, fs.readFileSync(fileName, 'utf8'));
  const classes = [];

  source.forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return;
    const isExported = (node.modifiers || []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    const implementsMigration = (node.heritageClauses || [])
      .filter((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
      .some((clause) => clause.types.some((type) => type.expression.getText(source).split('.').at(-1) === 'MigrationInterface'));
    if (isExported && implementsMigration) {
      classes.push(node.name.text);
    }
  });

  return classes;
}

function getRegistry(serverPath) {
  const sourceText = fs.readFileSync(serverPath, 'utf8');
  const source = parseSource(serverPath, sourceText);
  const imports = new Map();
  const registered = new Set();

  source.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return;
    for (const element of bindings.elements) {
      imports.set(element.name.text, node.moduleSpecifier.text);
    }
  });

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(source) === 'builder'
      && node.expression.name.text === 'migrations'
      && node.arguments.length > 0
      && ts.isArrayLiteralExpression(node.arguments[0])
    ) {
      for (const element of node.arguments[0].elements) {
        if (ts.isIdentifier(element)) registered.add(element.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);

  return { imports, registered };
}

function checkMigrationRegistry(rootDir) {
  const migrationsDir = path.join(rootDir, 'src', 'migrations');
  const serverPath = path.join(rootDir, 'src', 'server.ts');
  const { imports, registered } = getRegistry(serverPath);
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => path.join(migrationsDir, name))
    .sort();
  const errors = [];

  for (const migrationFile of migrationFiles) {
    for (const className of getMigrationClasses(migrationFile)) {
      const importPath = imports.get(className);
      const expectedModulePath = path.relative(
        path.dirname(serverPath),
        migrationFile.replace(/\.ts$/, ''),
      ).split(path.sep).join('/');
      const expectedSpecifier = expectedModulePath.startsWith('.') ? expectedModulePath : `./${expectedModulePath}`;

      if (importPath !== expectedSpecifier) {
        errors.push(`${className} is not imported from ${expectedSpecifier}`);
      }
      if (!registered.has(className)) {
        errors.push(`${className} is not included in builder.migrations([...])`);
      }
    }
  }

  return errors;
}

function main() {
  const rootArgIndex = process.argv.indexOf('--root');
  const rootDir = rootArgIndex >= 0 ? path.resolve(process.argv[rootArgIndex + 1]) : path.resolve(__dirname, '..');
  const errors = checkMigrationRegistry(rootDir);

  if (errors.length > 0) {
    console.error('Migration registry check failed:');
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log('Migration registry check passed.');
}

if (require.main === module) {
  main();
}

module.exports = { checkMigrationRegistry };
