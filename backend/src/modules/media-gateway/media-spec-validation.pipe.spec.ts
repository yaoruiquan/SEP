import { z } from 'zod';
import { MediaVideoSpecV3Schema } from '../../shared/media-spec.dto';
import { MediaSpecValidationPipe } from './media-spec-validation.pipe';

const schema = z.object({ protocolVersion: z.literal(3), requestedSpec: MediaVideoSpecV3Schema }).strict();

describe('MediaSpecValidationPipe', () => {
  const pipe = new MediaSpecValidationPipe(schema);

  it('returns a safe field conflict before dispatch', () => {
    expect(() => pipe.transform({ protocolVersion: 3,
      requestedSpec: { width: 1920, height: 1080, aspectRatio: '9:16' } }))
      .toThrow(expect.objectContaining({ response: expect.objectContaining({ error: expect.objectContaining({
        code: 'SPEC_CONFLICT', field: 'requestedSpec.aspectRatio', source: 'request',
        submissionState: 'not_submitted', billingState: 'not_reserved',
      }) }) }));
  });

  it('never echoes a malicious provider extension or its value', () => {
    try {
      pipe.transform({ protocolVersion: 3, requestedSpec: { header: 'secret-value' } });
      throw new Error('Expected validation rejection');
    } catch (error) {
      expect(error).toMatchObject({ response: { error: { code: 'INVALID_PARAMETER' } } });
      expect(JSON.stringify(error)).not.toContain('secret-value');
    }
  });

  it('preserves old non-versioned validation responses', () => {
    expect(() => pipe.transform({ requestedSpec: {} }))
      .toThrow(expect.objectContaining({ response: expect.objectContaining({ errors: expect.any(Array) }) }));
  });
});
