import { serveAcpAgent } from '@aibo/acp-adapter/worker';
serveAcpAgent({ manifestUrl: new URL('./plugin.json', import.meta.url), configUrl: new URL('./acp.json', import.meta.url) });
