// Extension entry point: composition only, every behaviour lives in src/.

import { LOG_PREFIX } from './src/shared/constants.js';
import { whenHostReady } from './src/host/st.js';
import { repairStreamingFlag } from './src/host/send.js';
import { getSettings } from './src/settings/store.js';
import { mountSettingsPanel } from './src/settings/panel.js';
import { initSendWithImage } from './src/flow/send-with-image.js';
import { generateTestImage } from './src/flow/generate-image.js';
import { addWandEntry } from './src/wand/entry.js';

async function init() {
    await whenHostReady();
    // Runs before anything else so a run that died with streaming switched off is repaired first.
    repairStreamingFlag();
    getSettings();
    const flow = initSendWithImage();
    await mountSettingsPanel({ onTestImage: generateTestImage });
    const added = await addWandEntry({ onClick: () => flow.start() });
    if (!added) console.warn(`${LOG_PREFIX} wand menu not found, "Senden + Bild" is unavailable`);
}

// A broken extension must never break the host app's startup.
init().catch((error) => {
    console.error(`${LOG_PREFIX} init failed:`, error);
});
