// The upload store's S3 backend against a recording fake client, plus the URL and header rules.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createMediaStore, newFileName, parseUploadUrl, responseHeaders } from '../server/mediaStore.js';

function fakeS3() {
  const objects = new Map();
  return {
    objects,
    async send(command) {
      const { Bucket, Key, Body } = command.input;
      const name = command.constructor.name;
      if (name === 'PutObjectCommand') { objects.set(`${Bucket}/${Key}`, Buffer.from(Body)); return {}; }
      if (name === 'GetObjectCommand') {
        const body = objects.get(`${Bucket}/${Key}`);
        if (!body) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
        return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
      }
      throw new Error(`unexpected ${name}`);
    },
  };
}

describe('S3 backend', () => {
  test('saves under the configured prefix and reads back', async () => {
    const client = fakeS3();
    const store = createMediaStore({ s3Uri: 's3://prod-segment-model-store/ambassador/uploads/', s3Client: client });
    assert.equal(store.kind, 's3');
    const url = await store.save('posts', 'Shot.JPG', Buffer.from('jpg'));
    const { key } = parseUploadUrl(url);
    assert.ok(client.objects.has(`prod-segment-model-store/ambassador/uploads/${key}`));
    assert.deepEqual(await store.read(key), Buffer.from('jpg'));
    assert.equal(await store.read('posts/1-0123456789abcdef.jpg'), null);
  });
  test('a prefix without a trailing slash still lands in its folder', async () => {
    const client = fakeS3();
    const store = createMediaStore({ s3Uri: 's3://bucket/ambassador/uploads', s3Client: client });
    await store.save('contracts', 'a.pdf', Buffer.from('x'));
    assert.ok([...client.objects.keys()][0].startsWith('bucket/ambassador/uploads/contracts/'));
  });
  test('an unknown kind is refused', async () => {
    const store = createMediaStore({ s3Uri: 's3://bucket/p/', s3Client: fakeS3() });
    await assert.rejects(store.save('../etc', 'a.png', Buffer.from('x')), /unknown upload kind/);
  });
});

describe('names and headers', () => {
  test('file names are random and keep only a safe extension', () => {
    assert.match(newFileName('photo.PNG', 5), /^5-[0-9a-f]{16}\.png$/);
    assert.match(newFileName('no-extension', 5), /^5-[0-9a-f]{16}$/);
    assert.match(newFileName('x.<script>', 5), /^5-[0-9a-f]{16}$/);
    assert.notEqual(newFileName('a.png', 5), newFileName('a.png', 5));
  });
  test('parseUploadUrl accepts only our own names', () => {
    assert.deepEqual(parseUploadUrl('/uploads/posts/1-0123456789abcdef.png'), { kind: 'posts', key: 'posts/1-0123456789abcdef.png' });
    for (const bad of ['/uploads/posts/../x', '/uploads/posts/a/b', '/uploads/x/1-0123456789abcdef.png', '/elsewhere/posts/1-0123456789abcdef.png', null]) {
      assert.equal(parseUploadUrl(bad), null, String(bad));
    }
  });
  test('images and PDFs are inline; everything else downloads', () => {
    assert.equal(responseHeaders('posts/a.webp', { isPrivate: false })['Content-Type'], 'image/webp');
    const html = responseHeaders('posts/a.html', { isPrivate: false });
    assert.equal(html['Content-Type'], 'application/octet-stream');
    assert.match(html['Content-Disposition'], /^attachment/);
    assert.equal(responseHeaders('contracts/a.pdf', { isPrivate: true })['Cache-Control'], 'private, no-store');
  });
});
