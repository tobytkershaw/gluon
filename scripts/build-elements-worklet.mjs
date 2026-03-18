import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const sourcePath = path.join(repoRoot, 'src/audio/elements-worklet.ts');
const outputDir = path.join(repoRoot, 'public/audio');
const outputPath = path.join(outputDir, 'elements-worklet.js');

const source = await fs.readFile(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.None,
    removeComments: false,
  },
});

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, transpiled.outputText, 'utf8');
