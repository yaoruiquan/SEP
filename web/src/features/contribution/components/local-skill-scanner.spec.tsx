import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocalSkillScanner } from './local-skill-scanner';

function localFile(content: string, name: string, relativePath: string) {
  const file = new File([content], name, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

describe('LocalSkillScanner', () => {
  it('识别本地目录中的 SKILL.md 并展示 frontmatter', async () => {
    render(<LocalSkillScanner onPackaged={vi.fn()} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          localFile('---\nname: 竞品周报\ndescription: 汇总竞品动态\n---\n# 步骤', 'SKILL.md', 'skills/competitor/SKILL.md'),
          localFile('example input', 'example.txt', 'skills/competitor/examples/example.txt'),
        ],
      },
    });

    expect(await screen.findByText('竞品周报')).toBeInTheDocument();
    expect(screen.getByText('汇总竞品动态')).toBeInTheDocument();
    expect(screen.getByText(/2 个文件/)).toBeInTheDocument();
  });

  it('选择 Skill 后生成可读取的 ZIP，并保留根目录 SKILL.md', async () => {
    const onPackaged = vi.fn();
    render(<LocalSkillScanner onPackaged={onPackaged} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          localFile('---\nname: 本地技能\n---\n# 角色', 'SKILL.md', 'skills/local/SKILL.md'),
          localFile('reference', 'README.md', 'skills/local/README.md'),
        ],
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: '使用选中的 Skill' }));

    await waitFor(() => expect(onPackaged).toHaveBeenCalledTimes(1));
    const [zip] = onPackaged.mock.calls[0] as [File];
    expect(zip.name).toBe('本地技能.zip');
    expect(zip.type).toBe('application/zip');
    expect(new Uint8Array(await zip.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  });

  it('没有 SKILL.md 时显示提示', async () => {
    render(<LocalSkillScanner onPackaged={vi.fn()} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [localFile('readme', 'README.md', 'skills/empty/README.md')] },
    });

    expect(await screen.findByRole('status')).toHaveTextContent('没有识别到 Skill');
  });
});
