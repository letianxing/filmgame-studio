import { readFile } from 'node:fs/promises';

import { Ajv2020, type AnySchema } from 'ajv/dist/2020.js';
import addFormatsModule, { type FormatsPlugin } from 'ajv-formats';

const schemaPaths = [
  'packages/story-schema/screenplay.schema.json',
  'packages/story-schema/directed-drama.schema.json',
  'packages/story-schema/drama.schema.json',
  'packages/story-schema/story.schema.json',
  'packages/production-schema/production.schema.json',
  'packages/runtime-schema/runtime.schema.json',
  'packages/asset-manifest-schema/asset-manifest.schema.json',
] as const;

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
(addFormatsModule as unknown as FormatsPlugin)(ajv);

const schemas = new Map<string, AnySchema>();
for (const schemaPath of schemaPaths) {
  const schema = JSON.parse(
    await readFile(new URL(`../${schemaPath}`, import.meta.url), 'utf8'),
  ) as AnySchema;
  if (!ajv.validateSchema(schema)) {
    throw new Error(`${schemaPath} is not a valid JSON Schema:\n${ajv.errorsText(ajv.errors)}`);
  }
  ajv.addSchema(schema);
  schemas.set(schemaPath, schema);
}

const storySchema = schemas.get('packages/story-schema/story.schema.json');
if (!storySchema) throw new Error('Story schema was not loaded');
const validateStory = ajv.compile(storySchema);
const story = JSON.parse(
  await readFile(new URL('../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
) as unknown;

if (!validateStory(story)) {
  throw new Error(
    `Snowbound Hotel story is invalid:\n${ajv.errorsText(validateStory.errors, { separator: '\n' })}`,
  );
}

const fixturePairs = [
  ['packages/production-schema/production.schema.json', '../examples/snowbound-hotel/production.json'],
  ['packages/runtime-schema/runtime.schema.json', '../examples/snowbound-hotel/runtime-package.json'],
  ['packages/asset-manifest-schema/asset-manifest.schema.json', '../examples/snowbound-hotel/asset-manifest.json'],
] as const;
for (const [schemaPath, fixturePath] of fixturePairs) {
  const schema = schemas.get(schemaPath);
  if (!schema) throw new Error(`${schemaPath} was not loaded`);
  const validate = ajv.compile(schema);
  const fixture = JSON.parse(await readFile(new URL(fixturePath, import.meta.url), 'utf8')) as unknown;
  if (!validate(fixture)) {
    throw new Error(`${fixturePath} is invalid:\n${ajv.errorsText(validate.errors, { separator: '\n' })}`);
  }
}

console.log(
  `Validated ${schemaPaths.length} schemas plus Story, Production, Runtime Package and Asset Manifest fixtures.`,
);
