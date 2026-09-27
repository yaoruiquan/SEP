#!/usr/bin/env node

/**
 * 纯 Node、无依赖的 ZIP stored（不压缩）打包器。
 *
 * 浏览器端本地 Skill 导入使用同一份 ZIP 结构：UTF-8 文件名、CRC32、local
 * header、central directory 和 EOCD。服务端的 AdmZip 可直接读取该格式。
 */

export function createStoredZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('ZIP 至少需要一个文件');
  }

  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const names = new Set();

  for (const entry of entries) {
    const name = normalizeArchivePath(entry.name);
    if (names.has(name)) throw new Error(`ZIP 中存在重复路径: ${name}`);
    names.add(name);
    const data = toBytes(entry.data);
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > 0xffff) throw new Error(`ZIP 文件名过长: ${name}`);
    if (data.length > 0xffffffff) throw new Error(`ZIP 文件过大: ${name}`);

    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x800, true); // UTF-8 filename
    localView.setUint16(8, 0, true); // stored
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x800, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  if (offset > 0xffffffff || centralSize > 0xffffffff || entries.length > 0xffff) {
    throw new Error('ZIP 超过经典 ZIP 格式限制');
  }
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return concatBytes([...localParts, ...centralParts, end]);
}

export function normalizeArchivePath(value) {
  const path = String(value).replaceAll('\\', '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || /^[A-Za-z]:\//.test(path)) {
    throw new Error(`ZIP 路径非法: ${value}`);
  }
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '..')) {
    throw new Error(`ZIP 路径越界: ${value}`);
  }
  return parts.join('/');
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  throw new TypeError('ZIP entry data 必须是 string、Uint8Array 或 ArrayBuffer');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
