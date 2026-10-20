import { MediaRealQuoteRequestSchema } from 'shared';
import fixture from '../../shared/fixtures/media-real-semantics.json';
import { mediaRealSemanticHash } from './media-real-semantics';

describe('real image semantic contract', () => {
  const { referenceHashes, ...input } = fixture.request;
  const request = () => MediaRealQuoteRequestSchema.parse({ ...input, referenceIds: ['ref-a', 'ref-b'] });

  it('matches the shared Electron UTF-8 fixture', () => {
    expect(mediaRealSemanticHash(request(), referenceHashes)).toBe(fixture.semanticSha256);
  });

  it('binds quality, defaults, model version and ordered references', () => {
    const dto = request();
    const hash = mediaRealSemanticHash(dto, referenceHashes);
    for (const changed of [
      { ...dto, configVersion: 'cfg-other' }, { ...dto, profileId: 'image-other' },
      { ...dto, parameters: { ...dto.parameters, quality: 'low' as const } },
      { ...dto, parameters: { ...dto.parameters, count: 1 } },
      { ...dto, creativeBrief: '另一张商品照片' },
    ]) expect(mediaRealSemanticHash(changed, referenceHashes)).not.toBe(hash);
    expect(mediaRealSemanticHash(dto, [...referenceHashes].reverse())).not.toBe(hash);
    const implicit = MediaRealQuoteRequestSchema.parse({ profileId: dto.profileId, configVersion: dto.configVersion,
      operation: 'generate', creativeBrief: 'test', parameters: {} });
    const explicit = MediaRealQuoteRequestSchema.parse({ ...implicit, parameters: { quality: 'medium', count: 1, size: '1024x1024' } });
    expect(mediaRealSemanticHash(implicit, [])).toBe(mediaRealSemanticHash(explicit, []));
  });
});
