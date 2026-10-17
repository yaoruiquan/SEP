import { DocumentService } from './document.service';

describe('versioned document invariants', () => {
  it('requires an explicit revision rather than accepting an unguarded overwrite', () => {
    const service = new DocumentService({} as any, {} as any, {} as any, {} as any);
    expect(() => service.expectedRevision(undefined)).toThrow();
    const etag = `"kbdoc-${'a'.repeat(64)}"`;
    expect(service.expectedRevision(etag)).toBe(etag);
    expect(() => service.expectedRevision('"7"')).toThrow();
    expect(() => service.expectedRevision('W/"7"')).toThrow();
    expect(() => service.expectedRevision('7junk')).toThrow();
  });

  it('never exposes original storage paths, hashes or uploader account fields', () => {
    const service = new DocumentService({} as any, {} as any, {} as any, {} as any);
    const result = service.present({ id: 'doc', originalName: 'policy.txt', status: 'READY',
      revision: 2, version: 1, activeVersionId: 'v1', latestVersionId: 'v2',
      storagePath: '/private/path', uploadedBy: 'user-secret', uploader: { name: 'Admin', email: 'private' },
      versions: [
        { id: 'v1', version: 1, status: 'READY', published: true, storagePath: '/private/v1' },
        { id: 'v2', version: 2, status: 'FAILED', lastError: '安全错误', errorCode: 'EMBEDDING_UNAVAILABLE' },
      ],
    } as any);
    expect(result.searchable).toBe(true);
    expect(result.status).toBe('FAILED');
    expect(result.activeVersion?.id).toBe('v1');
    expect(JSON.stringify(result)).not.toMatch(/private|user-secret|storagePath/);
  });

  it('changes the strong ETag when processing progress changes without a revision update', () => {
    const service = new DocumentService({} as any, {} as any, {} as any, {} as any);
    const d = { id: 'doc', revision: 2, latestVersionId: 'v2', versions: [
      { id: 'v2', status: 'PROCESSING', stage: 'EMBEDDING', processedChunks: 1, totalChunks: 5 },
    ] } as any;
    const before = service.present(d).etag;
    d.versions[0].processedChunks++;
    expect(service.present(d).etag).not.toBe(before);
  });
});
