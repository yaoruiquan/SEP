import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MediaRealQuoteRequestV3Schema } from './media-real.dto';
import { MediaVideoGatewayQuoteRequestV3Schema } from './media-video.dto';
import { MediaImageSpecV3Schema, MediaVideoSpecV3Schema } from './media-spec.dto';

describe('shared media V3 client/server fixture', () => {
  const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../test/fixtures/media-v3-contract.json'), 'utf8'));

  it('parses image and video quote requests without changing execution fields', () => {
    expect(MediaRealQuoteRequestV3Schema.parse(fixture.imageQuoteRequest)).toEqual(fixture.imageQuoteRequest);
    expect(MediaVideoGatewayQuoteRequestV3Schema.parse(fixture.videoQuoteRequest)).toEqual(fixture.videoQuoteRequest);
  });

  it('keeps omitted specs and explicit false available for negotiation', () => {
    expect(MediaImageSpecV3Schema.parse(fixture.omittedImageSpec)).toEqual({});
    expect(MediaVideoSpecV3Schema.parse(fixture.omittedVideoSpec)).toEqual({ audio: false });
  });
});
