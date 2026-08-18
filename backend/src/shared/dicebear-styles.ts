/**
 * DiceBear 头像风格配置
 * @see https://www.dicebear.com/styles
 */

export interface AvatarStyle {
  id: string;
  name: string;
  description: string;
  category: 'human' | 'robot' | 'abstract' | 'pixel';
  recommended: boolean;
}

export const DICEBEAR_STYLES: AvatarStyle[] = [
  // 人物风格
  {
    id: 'avataaars',
    name: 'Avataaars',
    description: '经典卡通人物，类似 Slack 头像，适合办公场景',
    category: 'human',
    recommended: true,
  },
  {
    id: 'avataaars-neutral',
    name: 'Avataaars Neutral',
    description: 'Avataaars 的中性版本',
    category: 'human',
    recommended: false,
  },
  {
    id: 'lorelei',
    name: 'Lorelei',
    description: '优雅的扁平插画人物，色彩柔和',
    category: 'human',
    recommended: true,
  },
  {
    id: 'lorelei-neutral',
    name: 'Lorelei Neutral',
    description: 'Lorelei 的中性版本',
    category: 'human',
    recommended: false,
  },
  {
    id: 'micah',
    name: 'Micah',
    description: '现代简约人物头像',
    category: 'human',
    recommended: false,
  },
  {
    id: 'personas',
    name: 'Personas',
    description: '3D 风格人物头像，由 Draftbit 设计',
    category: 'human',
    recommended: true,
  },
  {
    id: 'adventurer',
    name: 'Adventurer',
    description: '冒险者风格人物',
    category: 'human',
    recommended: false,
  },
  {
    id: 'adventurer-neutral',
    name: 'Adventurer Neutral',
    description: 'Adventurer 的中性版本',
    category: 'human',
    recommended: false,
  },
  {
    id: 'big-ears',
    name: 'Big Ears',
    description: '大耳朵卡通人物',
    category: 'human',
    recommended: false,
  },
  {
    id: 'big-ears-neutral',
    name: 'Big Ears Neutral',
    description: 'Big Ears 的中性版本',
    category: 'human',
    recommended: false,
  },
  {
    id: 'open-peeps',
    name: 'Open Peeps',
    description: '扁平插画风格，表情丰富',
    category: 'human',
    recommended: false,
  },
  {
    id: 'notionists',
    name: 'Notionists',
    description: 'Notion 风格头像，简约现代',
    category: 'human',
    recommended: true,
  },
  {
    id: 'notionists-neutral',
    name: 'Notionists Neutral',
    description: 'Notionists 的中性版本',
    category: 'human',
    recommended: false,
  },
  {
    id: 'croodles',
    name: 'Croodles',
    description: '手绘涂鸦风格',
    category: 'human',
    recommended: false,
  },
  {
    id: 'croodles-neutral',
    name: 'Croodles Neutral',
    description: 'Croodles 的中性版本',
    category: 'human',
    recommended: false,
  },
  {
    id: 'miniavs',
    name: 'Miniavs',
    description: '迷你头像风格',
    category: 'human',
    recommended: false,
  },

  // 机器人风格
  {
    id: 'bottts',
    name: 'Bottts',
    description: '机器人头像，强调"数字员工"概念',
    category: 'robot',
    recommended: true,
  },
  {
    id: 'bottts-neutral',
    name: 'Bottts Neutral',
    description: 'Bottts 的中性版本',
    category: 'robot',
    recommended: false,
  },
  {
    id: 'big-smile',
    name: 'Big Smile',
    description: '可爱友好的机器人头像',
    category: 'robot',
    recommended: true,
  },

  // 像素风格
  {
    id: 'pixel-art',
    name: 'Pixel Art',
    description: '像素艺术风格',
    category: 'pixel',
    recommended: false,
  },
  {
    id: 'pixel-art-neutral',
    name: 'Pixel Art Neutral',
    description: 'Pixel Art 的中性版本',
    category: 'pixel',
    recommended: false,
  },

  // 抽象风格
  {
    id: 'initials',
    name: 'Initials',
    description: '首字母简约风，类似 GitHub 默认头像',
    category: 'abstract',
    recommended: true,
  },
  {
    id: 'identicon',
    name: 'Identicon',
    description: '几何图形标识',
    category: 'abstract',
    recommended: false,
  },
  {
    id: 'shapes',
    name: 'Shapes',
    description: '抽象几何形状',
    category: 'abstract',
    recommended: false,
  },
  {
    id: 'rings',
    name: 'Rings',
    description: '同心圆环图案',
    category: 'abstract',
    recommended: false,
  },
  {
    id: 'thumbs',
    name: 'Thumbs',
    description: '拇指图标风格',
    category: 'abstract',
    recommended: false,
  },
  {
    id: 'fun-emoji',
    name: 'Fun Emoji',
    description: '趣味表情符号',
    category: 'abstract',
    recommended: false,
  },
  {
    id: 'icons',
    name: 'Icons',
    description: '图标风格',
    category: 'abstract',
    recommended: false,
  },
];

/**
 * 生成 DiceBear 头像 URL
 */
export function generateAvatarUrl(styleId: string, seed: string): string {
  return `https://api.dicebear.com/9.x/${styleId}/svg?seed=${encodeURIComponent(seed)}`;
}

/**
 * 从数字员工名称生成 seed
 */
export function generateSeedFromName(name: string): string {
  // 移除空格和特殊字符，转为拼音或保持原样
  return name.replace(/\s+/g, '-').toLowerCase();
}
