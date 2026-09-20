import { openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';
import { isAbsolute } from 'node:path';
const MAX_IMAGE = 10 * 1024 * 1024, MAX_TOTAL = 20 * 1024 * 1024;
const invalid = message => Object.assign(new Error(message), { kind:'invalid_input' });
/** Only host-expanded image descriptors contain paths; ordinary references stay in prompt text. */
export function imageInput(attachments = [], supported = false) {
  if (!Array.isArray(attachments)) throw invalid('Invalid Cursor attachments');
  const images = attachments.filter(item => {
    if (!item || typeof item.attachmentId !== 'string' || (item.type !== undefined && item.type !== 'image')) throw invalid('Invalid Cursor attachment descriptor');
    return item.type === 'image';
  });
  if (images.length && !supported) throw Object.assign(new Error('This Cursor CLI does not advertise image input'), { kind:'unsupported' });
  if (images.length > 8) throw invalid('At most 8 images can be sent together');
  let total = 0;
  return images.map(item => {
    if (typeof item.path !== 'string' || !isAbsolute(item.path) || !['image/png','image/jpeg','image/gif','image/webp'].includes(item.mimeType)) throw invalid('Invalid Cursor image descriptor');
    const fd = openSync(item.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || !stat.size || stat.size > MAX_IMAGE || (total += stat.size) > MAX_TOTAL) throw invalid('Image size limit exceeded (10 MiB per image, 20 MiB total)');
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length-offset, offset); if (!count) throw invalid('Image changed while reading'); offset += count; }
      if (fstatSync(fd).size !== stat.size) throw invalid('Image changed while reading');
      const valid = item.mimeType === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))
        : item.mimeType === 'image/jpeg' ? bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))
        : item.mimeType === 'image/gif' ? ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString())
        : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
      if (!valid) throw invalid('Image bytes do not match the declared media type');
      return { type:'image', mimeType:item.mimeType, data:bytes.toString('base64') };
    } finally { closeSync(fd); }
  });
}
