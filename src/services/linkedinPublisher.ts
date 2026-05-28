/**
 * LinkedIn Direct Publisher Service
 * 
 * Supports:
 * - Text-only posts
 * - Image posts (UGC registerUpload → binary PUT → publish)
 */

import axios from 'axios';

interface LinkedInPublishParams {
  accessToken: string;
  memberUrn: string;
  text: string;
  imageUrl?: string;
}

/**
 * Downloads an image from a URL as a Buffer
 */
async function downloadImage(url: string): Promise<Buffer> {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

/**
 * Registers an image asset with LinkedIn and uploads the binary data
 */
async function uploadImageToLinkedIn(
  accessToken: string,
  memberUrn: string,
  imageUrl: string
): Promise<string> {
  // 1. Register the upload
  const registerUrl = 'https://api.linkedin.com/v2/assets?action=registerUpload';
  const registerRes = await axios.post(
    registerUrl,
    {
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: memberUrn,
        serviceRelationships: [
          {
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent',
          },
        ],
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const uploadMechanism = registerRes.data.value.uploadMechanism[
    'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
  ];
  const uploadUrl = uploadMechanism.uploadUrl;
  const assetUrn = registerRes.data.value.asset;

  // 2. Download the source image
  const imageBuffer = await downloadImage(imageUrl);

  // 3. Upload the binary buffer via PUT
  await axios.put(uploadUrl, imageBuffer, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'image/jpeg',
    },
  });

  return assetUrn;
}

/**
 * Publishes a post directly to LinkedIn
 */
export async function publishToLinkedIn(
  params: LinkedInPublishParams
): Promise<string> {
  const { accessToken, memberUrn, text, imageUrl } = params;

  const assetUrns: string[] = [];

  if (imageUrl) {
    try {
      // Split comma-separated URLs for carousel / multi-image posts
      const urls = imageUrl.includes(',') ? imageUrl.split(',') : [imageUrl];
      console.log(`[LinkedIn] Registering and uploading ${urls.length} images: ${imageUrl}`);
      
      for (const url of urls) {
        const cleanUrl = url.trim();
        if (cleanUrl) {
          console.log(`[LinkedIn] Uploading image: ${cleanUrl}`);
          const assetUrn = await uploadImageToLinkedIn(accessToken, memberUrn, cleanUrl);
          console.log(`[LinkedIn] Image registered successfully: ${assetUrn}`);
          assetUrns.push(assetUrn);
        }
      }
    } catch (err: any) {
      console.warn(`[LinkedIn] Image upload failed, falling back to text-only: ${err.message}`);
    }
  }

  const hasMedia = assetUrns.length > 0;

  const publishPayload: Record<string, any> = {
    author: memberUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: hasMedia ? 'IMAGE' : 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  if (hasMedia) {
    publishPayload.specificContent['com.linkedin.ugc.ShareContent'].media = assetUrns.map((urn, index) => ({
      status: 'READY',
      media: urn,
      title: { text: `Aladdyn Generated Image ${index + 1}` },
    }));
  }

  const publishRes = await axios.post(
    'https://api.linkedin.com/v2/ugcPosts',
    publishPayload,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
    }
  );

  return publishRes.data.id;
}
