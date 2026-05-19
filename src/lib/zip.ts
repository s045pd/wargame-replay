// Minimal store-only (no compression) ZIP writer. No deps.
// Format reference: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    c = (CRC_TABLE[(c ^ data[i]!) & 0xFF]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Build a ZIP archive with no compression (method=0, "store"). */
export function createStoreZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centralEntries: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const size = e.data.length;
    const crc = crc32(e.data);

    // Local file header (30 bytes + filename)
    const lh = new ArrayBuffer(30);
    const lv = new DataView(lh);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true);          // version needed
    lv.setUint16(6, 0, true);           // flags
    lv.setUint16(8, 0, true);           // method (store)
    lv.setUint16(10, 0, true);          // mod time
    lv.setUint16(12, 0, true);          // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);       // compressed size
    lv.setUint32(22, size, true);       // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);          // extra length
    parts.push(new Uint8Array(lh));
    parts.push(nameBytes);
    parts.push(e.data);

    // Central directory header (46 bytes + filename)
    const cd = new ArrayBuffer(46);
    const cv = new DataView(cd);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true);          // version made by
    cv.setUint16(6, 20, true);          // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);          // extra length
    cv.setUint16(32, 0, true);          // comment length
    cv.setUint16(34, 0, true);          // disk #
    cv.setUint16(36, 0, true);          // internal attrs
    cv.setUint32(38, 0, true);          // external attrs
    cv.setUint32(42, offset, true);     // offset of local header
    const cdBuf = new Uint8Array(46 + nameBytes.length);
    cdBuf.set(new Uint8Array(cd), 0);
    cdBuf.set(nameBytes, 46);
    centralEntries.push(cdBuf);

    offset += 30 + nameBytes.length + size;
  }

  // Concatenate central directory
  let cdSize = 0;
  for (const c of centralEntries) cdSize += c.length;
  const cdOffset = offset;
  for (const c of centralEntries) parts.push(c);

  // End of Central Directory Record (22 bytes)
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, 0, true);
  parts.push(new Uint8Array(eocd));

  return new Blob(parts as BlobPart[], { type: 'application/zip' });
}
