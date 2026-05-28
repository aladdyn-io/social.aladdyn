import express from 'express';

const app = express();
const PORT = 4002;

app.use(express.json());

app.post('/internal/posts/create-from-social', (req, res) => {
  const { funnelId, text, imageUrls, scheduledAt } = req.body;
  const internalSecret = req.headers['x-internal-secret'];

  console.log('\n======================================================');
  console.log('📬 [MOCK LINKEDIN SERVICE] Received Share Request');
  console.log('======================================================');
  console.log(`🔑 Internal Secret:   ${internalSecret}`);
  console.log(`🎯 Funnel ID:         ${funnelId}`);
  console.log(`📅 Scheduled At:      ${scheduledAt}`);
  console.log('📝 Content:');
  console.log('------------------------------------------------------');
  console.log(text);
  console.log('------------------------------------------------------');
  console.log('🖼️  Images:', imageUrls);
  console.log('======================================================\n');

  res.status(200).json({
    success: true,
    data: {
      postId: `mock-linkedin-post-${Date.now()}`
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Mock LinkedIn Service is running on http://localhost:${PORT}`);
});
