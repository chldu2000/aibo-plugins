import { serveCapability } from '@aibo/capability-runtime/stdio';
import type { Snapshot } from '@aibo/plugin-protocol';

serveCapability({
  pluginId:'dev.aibo.starter.greeting',pluginVersion:'1.0.0',contributionId:'dev.aibo.starter.greeting.provider',
  operations:[{capability:'dev.aibo.starter.greeting.read',version:'1.0.0',operationId:'dev.aibo.starter.greeting.read'}],
  async invoke(request) {
    const output: Pick<Snapshot,'state'|'view'|'actions'> = {
      state:{status:'ready',message:'能力插件已就绪'},
      view:{kind:'detail',itemId:'greeting',properties:[{label:'Scope',value:request.scope.kind}],content:'你好，Aibo！',truncated:false},
      actions:[{id:'refresh',label:'刷新',intent:'refresh',enabled:true}],
    };
    return output;
  },
});
