// Launch the shipped wizard in an isolated consumer of the unpublished PR packages.
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
const workspace = mkdtempSync(join(tmpdir(), 'stint-designer-demo-'));
const project = join(workspace, 'portfolio');
const packages = join(workspace, 'packages');
mkdirSync(project); mkdirSync(packages); mkdirSync(join(project, 'src'));
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'your-portfolio', private: true, type: 'module', scripts: { build: 'vite build' } }));
writeFileSync(join(project, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your timeline</title><div id="root"></div><script type="module" src="/src/main.tsx"></script></html>');
for (const name of ['stint', 'stint-cli']) execFileSync('npm', ['pack', '--workspace', `packages/${name}`, '--pack-destination', packages], { cwd: root, stdio: 'pipe' });
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...readdirSync(packages).map(f => join(packages, f)), 'react@19', 'react-dom@19', 'vite@8'], { cwd: project, stdio: 'pipe' });
console.log(JSON.stringify({ project }));
const child = spawn(process.execPath, [join(project, 'node_modules/@macworks/stint-cli/dist/cli.js'), 'setup', '--wizard', '--port', process.env.PORT ?? '4188', '--json'], { cwd: project, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
