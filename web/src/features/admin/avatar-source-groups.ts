import type { AvatarSource, ManagedAvatarStyle } from './admin-api';

const builtinSources: AvatarSource[] = [
  { id: 'platform', name: '平台素材', description: '职业人物与运营上传的自有素材', website: '' },
  { id: 'dicebear', name: 'DiceBear', description: '精选卡通人物与机器人形象', website: 'https://www.dicebear.com/' },
  { id: 'boring-avatars', name: 'Boring Avatars', description: '几何与色彩图案', website: 'https://boringavatars.com/' },
  { id: 'open-peeps', name: 'Open Peeps 原版', description: '原版手绘半身、站姿与坐姿人物', website: 'https://www.openpeeps.com/' },
  { id: 'beanheads', name: 'Bean Heads', description: '穿职业装的半身人物', website: 'https://beanheads.robertbroersma.com/' },
  { id: 'robohash', name: 'RoboHash', description: '完整机器人与机器人头像', website: 'https://robohash.org/' },
  { id: 'ui-avatars', name: 'UI Avatars', description: '支持中文的本地姓名头像', website: 'https://ui-avatars.com/' },
];
export interface AvatarSourceGroup extends AvatarSource { styles: ManagedAvatarStyle[] }

/** Keep unknown future sources distinct instead of silently labeling them platform assets. */
export function groupAvatarStyles(styles: ManagedAvatarStyle[], sources: AvatarSource[] = []): AvatarSourceGroup[] {
  const metadata = new Map(builtinSources.map((source) => [source.id, source]));
  for (const source of sources) metadata.set(source.id, source);
  const groups = new Map<string, AvatarSourceGroup>();
  for (const style of styles) {
    const id = style.source || 'platform';
    if (!groups.has(id)) {
      const source = metadata.get(id) ?? { id, name: style.sourceName || id, description: '', website: style.sourceUrl || '' };
      groups.set(id, { ...source, styles: [] });
    }
    groups.get(id)!.styles.push(style);
  }
  const order = [...metadata.keys()];
  return [...groups.values()].sort((a, b) => {
    const first = order.indexOf(a.id), second = order.indexOf(b.id);
    return (first < 0 ? order.length : first) - (second < 0 ? order.length : second);
  });
}
export function canBindAvatarStyle(style: ManagedAvatarStyle): boolean {
  return style.delivery === 'static' || style.delivery === 'binding' || (!style.delivery && style.source === 'platform');
}
