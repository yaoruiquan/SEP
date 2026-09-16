import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './avatar';

const asset = {
  id: 'silicon:engineer',
  version: 'v1',
  portraitUrl: 'https://images.example.com/person.webp?v=1',
  faceUrl: 'https://images.example.com/explicit-crop.webp?v=1',
};

describe('Avatar platform metadata', () => {
  it('uses explicit compositions instead of guessing URLs', () => {
    const { rerender } = render(<Avatar name="Engineer" src="/old.webp" asset={asset} portrait />);
    expect(screen.getByRole('img')).toHaveAttribute('src', asset.faceUrl);
    rerender(<Avatar name="Engineer" src="/old.webp" asset={asset} portrait fullBody />);
    expect(screen.getByRole('img')).toHaveAttribute('src', asset.portraitUrl);
  });

  it('falls back within the same identity and retries when the asset version changes', () => {
    const { rerender } = render(<Avatar name="Engineer" asset={asset} portrait />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img')).toHaveAttribute('src', asset.portraitUrl);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('E')).toBeInTheDocument();
    const updated = { ...asset, version: 'v2', faceUrl: 'https://images.example.com/explicit-crop.webp?v=2' };
    rerender(<Avatar name="Engineer" asset={updated} portrait />);
    expect(screen.getByRole('img')).toHaveAttribute('src', updated.faceUrl);
  });

  it('does not invent face variants for external custom images', () => {
    render(<Avatar name="Engineer" src="https://external.example.com/custom.webp" portrait />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://external.example.com/custom.webp');
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
  });
});
