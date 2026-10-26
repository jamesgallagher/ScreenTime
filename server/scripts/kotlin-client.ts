import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateKotlin, type OpenApiDoc } from './kotlin-gen.js';

const contract = fileURLToPath(new URL('../../contract/openapi.json', import.meta.url));
const dir = fileURLToPath(new URL('../../android/core-model/src/main/kotlin/au/screentime/core/model/api/', import.meta.url));
const { models, client } = generateKotlin(JSON.parse(readFileSync(contract, 'utf8')) as OpenApiDoc);
writeFileSync(`${dir}ApiModels.kt`, models);
writeFileSync(`${dir}ApiClient.kt`, client);
console.log(`wrote ${dir}ApiModels.kt and ApiClient.kt`);
