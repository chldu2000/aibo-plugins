import { serveAcpAgent } from '@aibo/acp-adapter/worker';
import { additionalInstructionsFromSettings, cursorExtension } from './cursor-session.mjs';

// Routing, host tools and lifecycle come from the host SDK; Cursor supplies only its extension.
serveAcpAgent({ manifestUrl: new URL('./plugin.json', import.meta.url), extension: cursorExtension, additionalInstructions: additionalInstructionsFromSettings });
