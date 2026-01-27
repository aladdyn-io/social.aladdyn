/**
 * Debug Script - Test Individual Components
 * 
 * Tests each part of the pipeline separately to identify where it fails
 */

import 'dotenv/config';
import { generateCaption } from './services/generateCaption';
import { generateImage } from './services/imageGenerator';
import { uploadImageToStorage } from './services/objectStorage';
import { CalendarItem, Strategy } from './types/content';
import { NormalizedInput } from './services/normalizeInput';

async function debugPipeline() {
  console.log('============================================================================');
  console.log('Debug: Testing Pipeline Components');
  console.log('============================================================================\n');

  // Mock data
  const mockCalendarItem: CalendarItem = {
    date: '2026-02-01',
    pillar: 'Coffee Culture',
    topic: 'Morning brew tips',
    content_type: 'image',
    is_festival: false,
  };

  const mockStrategy: Strategy = {
    content_pillars: ['Coffee Culture', 'Behind the Beans', 'Community'],
    tone: 'Warm and inviting',
    cta_style: 'Friendly invitation',
    content_mix: {
      education: 40,
      trust: 40,
      promotion: 20,
    },
  };

  const mockInput: NormalizedInput = {
    industry: 'Coffee Shop',
    total_days: 14,
    frequency_per_week: 3,
    festival_enabled: false,
    logo_url: 'https://example.com/logo.png',
    font_style: 'Roboto',
    accent_color: '#FF6B35',
    base_color: '#004E89',
    services: ['Coffee', 'Pastries'],
    geography: 'India',
    posting_days: 6,
    brand_stage: 'new',
    trust_weight: 50,
    education_weight: 30,
    promo_weight: 20,
    platform: 'instagram',
  };

  try {
    // ========================================================================
    // TEST 1: Caption Generation
    // ========================================================================
    console.log('TEST 1: Generating caption...');
    const startCaption = Date.now();
    
    try {
      const caption = await generateCaption(mockCalendarItem, mockStrategy, mockInput);
      const captionTime = Date.now() - startCaption;
      
      console.log(`✓ Caption generated in ${captionTime}ms`);
      console.log(`  Preview: ${caption.substring(0, 100)}...`);
      console.log('');
    } catch (error) {
      console.error('✗ Caption generation FAILED:');
      console.error('  Error:', error instanceof Error ? error.message : String(error));
      console.error('  API Key exists:', !!process.env.OPENAI_API_KEY);
      console.error('  API Key length:', process.env.OPENAI_API_KEY?.length || 0);
      throw error;
    }

    // ========================================================================
    // TEST 2: Image Generation
    // ========================================================================
    console.log('TEST 2: Generating image...');
    const startImage = Date.now();
    
    try {
      const imageResult = await generateImage(mockCalendarItem, mockInput);
      const imageTime = Date.now() - startImage;
      
      console.log(`✓ Image generated in ${imageTime}ms`);
      console.log(`  Model: ${imageResult.metadata.model}`);
      console.log(`  Size: ${imageResult.imageBuffer.length} bytes`);
      console.log(`  Dimensions: ${imageResult.metadata.dimensions.width}x${imageResult.metadata.dimensions.height}`);
      console.log('');
    } catch (error) {
      console.error('✗ Image generation FAILED:');
      console.error('  Error:', error instanceof Error ? error.message : String(error));
      console.error('  HF Token exists:', !!process.env.HUGGINGFACE_API_TOKEN);
      console.error('  HF Token length:', process.env.HUGGINGFACE_API_TOKEN?.length || 0);
      throw error;
    }

    // ========================================================================
    // TEST 3: Image Upload
    // ========================================================================
    console.log('TEST 3: Uploading image...');
    const startUpload = Date.now();
    
    try {
      const mockImageResult = {
        imageBuffer: Buffer.from('fake-image-data'),
        metadata: {
          model: 'test-model',
          dimensions: { width: 1024, height: 1024 },
          prompt: 'test prompt',
        },
      };
      
      const imageUrl = await uploadImageToStorage(mockImageResult);
      const uploadTime = Date.now() - startUpload;
      
      console.log(`✓ Image uploaded in ${uploadTime}ms`);
      console.log(`  URL: ${imageUrl}`);
      console.log('');
    } catch (error) {
      console.error('✗ Image upload FAILED:');
      console.error('  Error:', error instanceof Error ? error.message : String(error));
      throw error;
    }

    console.log('============================================================================');
    console.log('✅ All components working! Pipeline should succeed.');
    console.log('============================================================================');
  } catch (error) {
    console.error('\n============================================================================');
    console.error('❌ Component test failed!');
    console.error('============================================================================');
    process.exit(1);
  }

  process.exit(0);
}

// Run debug
debugPipeline();
