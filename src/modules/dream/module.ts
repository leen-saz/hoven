import type { ModuleMeta } from '../types';

// «احلم»: the start page. A thinking chat that turns a campaign idea into a full draft (strategy, audience, budget,
// copy, designs, motion, voice-over), approved part by part, then created on the platforms as PAUSED.
export const meta: ModuleMeta = {
  key: 'dream', ar: 'احلم', en: 'Dream', group: 'today', status: 'live',
  icon: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2Z"/><path d="M19 3v4M17 5h4"/>',
  does: ['تكتب فكرة الحملة وتتناقش معه', 'يطلع الاستراتيجية والجمهور وتوزيع الميزانية والنصوص والتصاميم والموشن والفويس أوفر', 'تعدّل أي جزء وتعتمده', 'زر انشر ينشئ الحملة في المنصات موقوفة، وأنت تشغّلها'],
  doesEn: ['Write the campaign idea and think it through together', 'Get the strategy, audience, budget split, copy, designs, motion and voice-over', 'Edit and approve each part', 'Publish creates the campaign on the platforms paused; you switch it on'],
};
