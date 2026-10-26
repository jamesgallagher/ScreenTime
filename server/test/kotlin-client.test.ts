import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateKotlin, type OpenApiDoc } from '../scripts/kotlin-gen.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const doc = JSON.parse(read('../../contract/openapi.json')) as OpenApiDoc;
const api = '../../android/core-model/src/main/kotlin/au/screentime/core/model/api/';

describe('Kotlin API client', () => {
  const { models, client } = generateKotlin(doc);

  it('matches the committed ApiModels.kt and ApiClient.kt (run `pnpm contract` if this fails)', () => {
    expect(read(`${api}ApiModels.kt`)).toBe(models);
    expect(read(`${api}ApiClient.kt`)).toBe(client);
  });

  it('has one function for every operation in the contract', () => {
    const operations = Object.values(doc.paths).flatMap((methods) => Object.keys(methods));
    expect(client.match(/^ {4}suspend fun /gm)).toHaveLength(operations.length);
    expect(client).toContain('suspend fun getKidsById(');
    expect(client).toContain('suspend fun getDeviceState(\n        ifNoneMatch: String? = null,\n    ): Conditional<DeviceState> {');
  });

  it('maps optional and nullable fields the way docs/SPEC.md §4.1 says', () => {
    // Required, required and nullable, optional, optional and nullable.
    expect(models).toContain('data class ParentCreate(\n    val email: String,\n    val displayName: String,\n    val phoneE164: Opt<String> = Opt.Absent,\n)');
    expect(models).toContain('    val phoneE164: String?,\n');
    expect(models).toContain('data class FamilyPatch(\n    val name: String? = null,');
    expect(models).toContain('    @SerialName("tamper.clock") TAMPER_CLOCK("tamper.clock"),');
    expect(models).toContain('typealias NotificationPrefsPut = List<NotificationPrefsPutItem>');
  });

  it('refuses a schema it does not understand', () => {
    const bad = { paths: {}, components: { schemas: { Odd: { anyOf: [{ type: 'string' }, { type: 'integer' }] } } } } as OpenApiDoc;
    expect(() => generateKotlin(bad)).toThrow('Odd: unsupported schema');
    const clash = {
      paths: {},
      components: {
        schemas: {
          Kid: { type: 'object', properties: { pool: { type: 'string', enum: ['a'] } } },
          KidPool: { type: 'string', enum: ['b'] },
        },
      },
    } as OpenApiDoc;
    expect(() => generateKotlin(clash)).toThrow('two Kotlin types are named KidPool');
  });
});
