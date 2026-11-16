import type { ModuleMeta } from '../types';

// «الميديا باير»: Claude (through OpenRouter) reads the numbers, Salla sales, goals, rules, knowledge and lessons, and
// proposes changes; nothing runs without approval on the decision board. Ad accounts stay read-only here.
export const meta: ModuleMeta = {
  key: 'buyer', ar: 'الميديا باير', en: 'Media buyer', group: 'performance', status: 'soon',
  icon: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/><circle cx="19" cy="8" r="2"/>',
  does: ['يقرا أرقام الإعلانات ومبيعات سلة كل ساعة', 'يقارنها بأهدافك وقواعدك ويقترح وش تزيد ووش توقف', 'تتناقش معه، وتحفظ اللي يعجبك كدرس يتعلم منه', 'ما ينفّذ شي إلا بموافقتك'],
  doesEn: ['Reads ad numbers and Salla sales every hour', 'Compares them with your goals and rules and suggests what to scale or stop', 'Discuss with it and save what you like as a lesson it learns from', 'Nothing runs without your approval'],
};
