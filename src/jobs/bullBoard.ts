/**
 * Bull Board — queue monitoring UI
 *
 * Run: npm run queue:ui
 * Open: http://localhost:4001/ui
 */

import 'dotenv/config';
import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { publishQueue, imageGenQueue } from './queues';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/ui');

createBullBoard({
  queues: [new BullMQAdapter(publishQueue), new BullMQAdapter(imageGenQueue)],
  serverAdapter,
});

const app = express();
app.use('/ui', serverAdapter.getRouter());

const PORT = 4001;
app.listen(PORT, () => {
  console.log(`Bull Board running at http://localhost:${PORT}/ui`);
});
