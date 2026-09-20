import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,truncateSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {imageInput} from '../plugins/cursor/image-input.mjs';
test('image descriptors enforce types, limits, file identity and native capability before sending',()=>{
 const root=mkdtempSync(join(tmpdir(),'cursor-image-input-'));
 try{
  const path=join(root,'image.png');writeFileSync(path,Buffer.from('89504e470d0a1a0a','hex'));
  const image={attachmentId:'image',type:'image',path,mimeType:'image/png'};
  assert.deepEqual(imageInput([{attachmentId:'reference'}]),[]);
  assert.throws(()=>imageInput([image]),/does not advertise/);
  assert.throws(()=>imageInput(Array(9).fill(image),true),/8 images/);
  assert.throws(()=>imageInput([{...image,mimeType:'image/jpeg'}],true),/media type/);
  assert.throws(()=>imageInput([{...image,path:'relative.png'}],true),/descriptor/);
  symlinkSync(path,join(root,'link'));assert.throws(()=>imageInput([{...image,path:join(root,'link')}],true));
  truncateSync(path,10*1024*1024);assert.equal(imageInput([image],true)[0].data.length,Math.ceil(10*1024*1024/3)*4);
  assert.throws(()=>imageInput([image,image,image],true),/size limit/);
  truncateSync(path,10*1024*1024+1);assert.throws(()=>imageInput([image],true),/size limit/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
