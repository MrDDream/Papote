import zlib from 'node:zlib';
import { once } from 'node:events';

// A small .zip writer (no dependency): text is deflated, pictures and sounds are stored as they are.

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export function createZip(out) {
  const entries = [];
  let offset = 0;

  async function write(buf) {
    offset += buf.length;
    if (!out.write(buf)) await once(out, 'drain');
  }

  async function add(name, data, { date = new Date(), compress = true } = {}) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const body = compress ? zlib.deflateRawSync(data) : data;
    const method = compress ? 8 : 0;
    const { time, day } = dosTime(date);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(day, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    entries.push({ nameBuf, crc, size: data.length, csize: body.length, method, time, day, offset });
    await write(header);
    await write(nameBuf);
    await write(body);
  }

  async function end() {
    const start = offset;
    for (const e of entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.day, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.csize, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.nameBuf.length, 28);
      h.writeUInt32LE(e.offset, 42);
      await write(h);
      await write(e.nameBuf);
    }
    const tail = Buffer.alloc(22);
    tail.writeUInt32LE(0x06054b50, 0);
    tail.writeUInt16LE(entries.length, 8);
    tail.writeUInt16LE(entries.length, 10);
    tail.writeUInt32LE(offset - start, 12);
    tail.writeUInt32LE(start, 16);
    await write(tail);
    out.end();
  }

  return { add, end };
}
