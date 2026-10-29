/** Built-in avatar catalogs. Legacy cartoon:<style> IDs remain stable. */
import dicebearCatalog from './dicebear-catalog.json';
import openPeepsAssets from './open-peeps-assets.json';
import robohashAssets from './robohash-assets.json';

export type AvatarSourceId = 'platform' | 'dicebear' | 'boring-avatars' | 'open-peeps' | 'ui-avatars' | 'beanheads' | 'robohash';
export interface AvatarLicense {
  name: string;
  url: string;
  attribution: string;
  requiresAttribution: boolean;
}
export interface AvatarStyle {
  id: string;
  name: string;
  description: string;
  category: 'human' | 'robot' | 'abstract' | 'pixel';
  recommended: boolean;
  source?: AvatarSourceId;
  sourceName?: string;
  sourceUrl?: string;
  license?: AvatarLicense;
  delivery?: 'generated' | 'static' | 'binding';
  totalAssets?: number;
  styleId?: string;
}

export const AVATAR_SOURCES = [
  { id: 'platform', name: '平台素材', description: '职业人物与运营上传的自有素材，按员工独立绑定。', website: '' },
  { id: 'dicebear', name: 'DiceBear', description: '精选卡通人物与机器人形象，由平台本地生成。', website: 'https://www.dicebear.com/' },
  { id: 'boring-avatars', name: 'Boring Avatars', description: '8 种几何与色彩图案，使用官方开源组件本地生成。', website: 'https://boringavatars.com/' },
  { id: 'open-peeps', name: 'Open Peeps 原版', description: 'Pablo Stanley 的手绘人物原版素材，包含半身、站姿与坐姿。', website: 'https://www.openpeeps.com/' },
  { id: 'beanheads', name: 'Bean Heads', description: '穿职业装的半身人物，按员工固定生成发型、肤色、眼镜与表情。', website: 'https://beanheads.robertbroersma.com/' },
  { id: 'robohash', name: 'RoboHash', description: '完整机器人与机器人头像，本地保存并按员工固定分配。', website: 'https://robohash.org/' },
  { id: 'ui-avatars', name: 'UI Avatars', description: '兼容 UI Avatars 样式的本地姓名头像，支持中文，不请求公共 API。', website: 'https://ui-avatars.com/' },
] as const;

export const SILICON_3D_STYLE: AvatarStyle = {
  id: 'silicon-3d', name: '硅基 3D 人物',
  description: '平台统一维护的职业人物，Web 与客户端共享同一人物身份',
  category: 'human', recommended: true, source: 'platform', delivery: 'binding',
};
export const FOLLOW_DEFAULT_STYLE_ID = 'follow-default';
export const AVATAR_RENDER_VERSION = 'v1';
export const DICEBEAR_STYLES: AvatarStyle[] = dicebearCatalog.map((style) => ({
  ...style, category: style.category as AvatarStyle['category'], source: 'dicebear', delivery: 'generated',
}));

const boringDescriptions: Record<string, string> = {
  beam: '简洁表情头像，适合友好的数字助手', marble: '柔和流动的彩色图案',
  pixel: '像素格几何图案', sunset: '分层色块与日落渐变感', ring: '多色圆环图案',
  bauhaus: '包豪斯风格的几何色块', geometric: '几何切面与色彩组合', abstract: '抽象图形与品牌色组合',
};
const cc0: AvatarLicense = {
  name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  attribution: 'Open Peeps by Pablo Stanley. Head crops change the SVG viewBox only.', requiresAttribution: false,
};
export const ADDITIONAL_AVATAR_STYLES: AvatarStyle[] = [
  {
    id: 'beanheads-professional', styleId: 'professional', name: 'Bean Heads 职业人物',
    description: '半身职业人物，精选衬衫、领带、自然表情及不同发型，按员工固定生成',
    category: 'human', recommended: true, source: 'beanheads', delivery: 'generated',
    license: { name: 'MIT', url: 'https://github.com/RobertBroersma/beanheads/blob/main/LICENSE',
      attribution: 'Bean Heads by Robert Broersma. Copyright (c) 2020 Robert Broersma. MIT license notice retained. The author asks that the icons not be resold separately.',
      requiresAttribution: false },
  },
  ...Object.entries(robohashAssets).map(([pack, assets]): AvatarStyle => ({
    id: `robohash-${pack}`, styleId: pack,
    name: pack === 'set1' ? 'RoboHash 完整机器人' : 'RoboHash 机器人头像',
    description: `${assets.length} 个${pack === 'set1' ? '完整机械机器人' : '独立机器人头像'}，按员工固定分配，支持个人素材替换`,
    category: 'robot', recommended: pack === 'set1', source: 'robohash', delivery: 'static', totalAssets: assets.length,
    license: { name: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0/',
      attribution: 'Robots lovingly delivered by Robohash.org. Robot artwork by Zikri Kader (set1) and Julian Peter Arias (set3).',
      requiresAttribution: true },
  })),
  ...Object.entries(boringDescriptions).map(([variant, description]): AvatarStyle => ({
    id: `boring-${variant}`, styleId: variant, name: `Boring ${variant[0].toUpperCase()}${variant.slice(1)}`,
    description, category: variant === 'beam' ? 'human' : 'abstract', recommended: ['beam', 'bauhaus'].includes(variant),
    source: 'boring-avatars', delivery: 'generated',
    license: { name: 'MIT', url: 'https://github.com/boringdesigners/boring-avatars/blob/master/LICENSE',
      attribution: 'Boring Avatars by Boring Designers. Copyright notice retained in the distributed package and asset notices.', requiresAttribution: true },
  })),
  ...Object.entries(openPeepsAssets).map(([pack, assets]): AvatarStyle => ({
    id: `open-peeps-${pack}`, styleId: pack,
    name: `Open Peeps ${pack === 'busts' ? '半身人物' : pack === 'standing' ? '站姿人物' : '坐姿人物'}`,
    description: `${assets.length} 位原版手绘人物，配有主图与头肩裁切图；按员工固定分配，可覆盖个人绑定`,
    category: 'human', recommended: pack === 'busts', source: 'open-peeps', delivery: 'static', totalAssets: assets.length, license: cc0,
  })),
  ...[
    ['brand', '品牌色', '品牌紫色姓名头像'], ['colorful', '多彩', '按员工固定分配背景色的姓名头像'],
    ['neutral', '简约', '低饱和灰色姓名头像'],
  ].map(([variant, name, description]): AvatarStyle => ({
    id: `ui-avatars-${variant}`, styleId: variant, name: `UI Avatars ${name}`,
    description: `${description}，支持中文；平台本地兼容实现`,
    category: 'abstract', recommended: variant === 'brand', source: 'ui-avatars', delivery: 'generated',
    license: { name: '平台本地实现', url: 'https://ui-avatars.com/',
      attribution: 'Locally implemented initials avatars compatible with the UI Avatars appearance; no upstream code or hosted API is used.', requiresAttribution: false },
  })),
];
export const BUILTIN_AVATAR_STYLES: AvatarStyle[] = [
  SILICON_3D_STYLE,
  ...DICEBEAR_STYLES.map((style) => ({ ...style, id: `cartoon:${style.id}`, styleId: style.id })),
  ...ADDITIONAL_AVATAR_STYLES,
].map((style) => {
  const source = AVATAR_SOURCES.find((item) => item.id === style.source)!;
  return { ...style, sourceName: source.name, sourceUrl: source.website };
});

// Only recognizable characters are offered to operators. The full catalog stays
// available for resolving previously saved bindings and rendering their images.
const characterStyleIds = [
  'silicon-3d',
  'cartoon:toon-head', 'cartoon:avataaars', 'cartoon:lorelei', 'cartoon:micah',
  'cartoon:personas', 'cartoon:notionists', 'cartoon:open-peeps', 'cartoon:adventurer',
  'cartoon:big-ears', 'cartoon:miniavs', 'cartoon:dylan', 'cartoon:big-smile',
  'cartoon:croodles', 'cartoon:pixel-art', 'cartoon:voxel-art',
  'cartoon:bottts', 'cartoon:voxel-bot', 'cartoon:critters',
  'open-peeps-busts', 'open-peeps-standing', 'open-peeps-sitting',
  'beanheads-professional', 'robohash-set1', 'robohash-set3',
];
export const SELECTABLE_AVATAR_STYLES: AvatarStyle[] = characterStyleIds.map((id) =>
  BUILTIN_AVATAR_STYLES.find((style) => style.id === id)!,
);

export function canonicalAvatarStyleId(styleId: string): string {
  return DICEBEAR_STYLES.some((style) => style.id === styleId) ? `cartoon:${styleId}` : styleId;
}
export function dicebearStyleId(styleId: string): string {
  return styleId.startsWith('cartoon:') ? styleId.slice('cartoon:'.length) : styleId;
}
export function builtinAvatarStyle(styleId: string): AvatarStyle | undefined {
  return BUILTIN_AVATAR_STYLES.find((style) => style.id === canonicalAvatarStyleId(styleId));
}
/** Same seed and frozen asset manifest always select the same original character. */
export function avatarSeedHash(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) { hash ^= char.codePointAt(0)!; hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
export function libraryAvatarBinding(styleId: string, seed: string, name = seed): { portraitUrl: string; faceUrl?: string; version?: string } | null {
  const style = builtinAvatarStyle(styleId);
  if (!style || style.delivery === 'binding') return null;
  if (style.source === 'open-peeps') {
    const assets = openPeepsAssets[style.styleId as keyof typeof openPeepsAssets];
    if (!assets?.length) return null;
    const asset = assets[avatarSeedHash(`${style.id}:${seed}`) % assets.length];
    return { portraitUrl: asset.portraitUrl, faceUrl: asset.faceUrl, version: asset.version };
  }
  if (style.source === 'robohash') {
    const assets = robohashAssets[style.styleId as keyof typeof robohashAssets];
    if (!assets?.length) return null;
    const asset = assets[avatarSeedHash(`${style.id}:${seed}`) % assets.length];
    return { portraitUrl: asset.portraitUrl, faceUrl: asset.faceUrl, version: asset.version };
  }
  const params = new URLSearchParams({ seed });
  if (style.source === 'ui-avatars') params.set('name', name);
  return { portraitUrl: `/avatar-library/${AVATAR_RENDER_VERSION}/${style.source}/${style.styleId}?${params}`, version: AVATAR_RENDER_VERSION };
}
export function generateAvatarUrl(styleId: string, seed: string): string {
  return libraryAvatarBinding(styleId, seed)?.portraitUrl ?? '';
}
export function generateSeedFromName(name: string): string {
  return name.replace(/\s+/g, '-').toLowerCase();
}
