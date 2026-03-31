import cron from 'node-cron';
import { runAutomations } from './automation';
import { runIntelligence } from './intelligence';

export function startCrons() {
  cron.schedule('*/15 * * * *', () => {
    runAutomations().catch(err => console.error('automation error:', err));
  });
  cron.schedule('0 2 * * *', () => {
    runIntelligence().catch(err => console.error('intelligence error:', err));
  });
  console.log('Cron jobs started');
}
