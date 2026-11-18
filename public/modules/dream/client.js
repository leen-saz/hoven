// احلم: the start page. The chat and the draft arrive in the next change; for now the page explains the flow.
import { shell } from '/assets/common.js';

export default async function mount() {
  await shell({ active: 'dream', title: 'احلم' });
}
