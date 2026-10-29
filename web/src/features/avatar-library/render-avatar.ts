import { createRequire } from 'node:module';
import type BoringAvatarComponent from 'boring-avatars';
import type { BeanHead as BeanHeadComponent } from 'beanheads';
import { Avatar, Style } from '@dicebear/core';
import { avatarSeedHash } from 'shared/dicebear-styles';
import { dicebearDefinitions } from './dicebear-definitions';

const styles = new Map<string, Style>();
// Route handlers do not render RSC trees. Resolve the trusted SVG component and
// its SSR runtime together using Node, so Next does not substitute the RSC React runtime.
const requireFromWeb = createRequire(`${process.cwd()}/package.json`);
const { createElement } = requireFromWeb('react') as typeof import('react');
const { renderToStaticMarkup } = requireFromWeb('react-dom/server.node') as { renderToStaticMarkup: (element: import('react').ReactNode) => string };
const BoringAvatar = requireFromWeb('boring-avatars').default as typeof BoringAvatarComponent;
const { BeanHead } = requireFromWeb('beanheads') as { BeanHead: typeof BeanHeadComponent };
const palette = ['#6254E8', '#AAA3F2', '#EBE8FF', '#F1BE9B', '#26365B'];
const boringVariants = new Set(['beam', 'marble', 'pixel', 'sunset', 'ring', 'bauhaus', 'geometric', 'abstract']);
const initialsVariants = new Set(['brand', 'colorful', 'neutral']);
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[char]!));

/** All rendering uses installed libraries or a documented local initials implementation. */
export async function renderLibraryAvatar(source: string, variant: string, seed: string, name: string): Promise<string | null> {
  if (source === 'dicebear') {
    if (!Object.hasOwn(dicebearDefinitions, variant)) return null;
    let style = styles.get(variant);
    if (!style) {
      const { default: definition } = await dicebearDefinitions[variant as keyof typeof dicebearDefinitions]();
      style = new Style<unknown>(definition);
      styles.set(variant, style);
    }
    return new Avatar(style, { seed, size: 256, idRandomization: false }).toString();
  }
  if (source === 'boring-avatars') {
    if (!boringVariants.has(variant)) return null;
    return renderToStaticMarkup(createElement(BoringAvatar, {
      name: seed, size: 256, square: true, colors: palette,
      variant: variant as NonNullable<Parameters<typeof BoringAvatar>[0]['variant']>,
    }));
  }
  if (source === 'beanheads') {
    if (variant !== 'professional') return null;
    // Restrict the upstream combinations to dressed people and natural expressions.
    const choose = <T,>(part: string, options: readonly T[]): T => options[avatarSeedHash(`beanheads:${part}:${seed}`) % options.length];
    const svg = renderToStaticMarkup(createElement(BeanHead, {
      body: 'chest', clothing: 'dressShirt', clothingColor: choose('clothing', ['blue', 'white', 'black', 'green', 'red'] as const),
      hair: choose('hair', ['short', 'long', 'bun', 'pixie', 'bob', 'buzz', 'afro', 'balding'] as const),
      hairColor: choose('hair-color', ['black', 'brown', 'blonde', 'white', 'orange'] as const),
      skinTone: choose('skin', ['light', 'yellow', 'brown', 'dark', 'red', 'black'] as const),
      accessory: choose('glasses', ['none', 'none', 'roundGlasses', 'tinyGlasses'] as const),
      eyes: choose('eyes', ['normal', 'happy', 'content'] as const),
      eyebrows: choose('eyebrows', ['raised', 'serious'] as const),
      mouth: choose('mouth', ['grin', 'openSmile'] as const),
      facialHair: choose('facial-hair', ['none', 'none', 'stubble'] as const),
      lashes: false, hat: 'none', graphic: 'none', faceMask: false, mask: true, circleColor: 'blue',
    }));
    return svg.replace(/(<svg\b[^>]*>)/, '$1<metadata>Bean Heads by Robert Broersma. Copyright (c) 2020 Robert Broersma. MIT. License: /assets/avatar-libraries/BEANHEADS-LICENSE.txt</metadata>');
  }
  if (source !== 'ui-avatars' || !initialsVariants.has(variant)) return null;
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.length > 1 ? words.slice(0, 2).map((word) => [...word][0]).join('') : [...(words[0] ?? '?')].slice(0, 2).join('');
  const background = variant === 'neutral' ? '#F1F2F6' : variant === 'colorful'
    ? ['#5D55C8', '#237D78', '#98526C', '#A06531', '#42668F'][avatarSeedHash(seed) % 5] : '#6254E8';
  const foreground = variant === 'neutral' ? '#4B5261' : '#FFFFFF';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><title>${escapeXml(name)}</title><rect width="256" height="256" fill="${background}"/><text x="128" y="128" fill="${foreground}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-size="100" font-weight="600">${escapeXml(initials.toUpperCase())}</text></svg>`;
}
