import { generatePostImage } from './services/onDemandImageGeneration';

async function main() {
  const postId = '159829bb-a60a-4032-bd6c-5104307bec4d';
  console.log(`Triggering image generation for post: ${postId}`);
  const url = await generatePostImage(postId, false, true);
  console.log(`Successfully generated! Image URL: ${url}`);
}

main().catch(console.error);
