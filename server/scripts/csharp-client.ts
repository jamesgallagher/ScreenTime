import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateCSharp, type OpenApiDoc } from './csharp-gen.js';

const contract = fileURLToPath(new URL('../../contract/openapi.json', import.meta.url));
const dir = fileURLToPath(new URL('../../windows/src/ScreenTime.Core/Api/', import.meta.url));
const { models, client } = generateCSharp(JSON.parse(readFileSync(contract, 'utf8')) as OpenApiDoc);
writeFileSync(`${dir}ApiModels.g.cs`, models);
writeFileSync(`${dir}ApiClient.g.cs`, client);
console.log(`wrote ${dir}ApiModels.g.cs and ApiClient.g.cs`);
